/**
 * Server-only: fetch a user's Quick Livraison orders for one calendar
 * month, newest first — mirrors lib/ozon/fetch-orders.js exactly (same
 * deterministic `[MONTH_BOUNDARY_COUNTER, startCounter]` range walk, same
 * gap-tolerant/batched/progressive design), bound to Quick's own
 * `getParcelDetails` client call instead of Ozon's tracking/parcel-info
 * pair.
 *
 * See lib/commission/sync-historical-orders.js#syncHistoricalQuickOrders,
 * the one caller.
 */

if (typeof window !== "undefined") {
  throw new Error("lib/quick/fetch-orders.js is server-only and must not be imported in client code");
}

import { lookupQuickParcel } from "@/lib/quick/lookup";
import { MONTH_BOUNDARY_COUNTER } from "@/lib/tracking/counter";

// Each order costs 1 Quick HTTP call (getParcelDetails) — this bounds how
// many are in flight at once, not how many orders are in progress.
const DEFAULT_BATCH_SIZE = 5;
// A generous sanity ceiling (not a normal-operation limit) — same rationale
// as lib/ozon/fetch-orders.js's own constant.
const DEFAULT_MAX_REQUESTS = 5000;

/**
 * @param {{apiKey:string}} credentials
 * @param {string} prefix                employee.username or the merchant's derived prefix
 * @param {string} period                "YYYYMM" — the month being fetched
 * @param {number|null} startCounter     the highest counter known to exist this month
 *                                        (from `discoverHighestQuickCounter`), or null
 * @param {object} [options]
 * @param {AbortSignal} [options.signal]
 * @param {number} [options.batchSize]   how many orders to fetch concurrently per round
 * @param {number} [options.maxRequests] sanity ceiling — see module comment
 * @param {(order: {_fullTrackingNumber:string, _numericCounter:number, body:object}) => (void|Promise<void>)} [options.onOrder]
 *   called — and AWAITED — the moment EACH individual order resolves, so a
 *   caller can do async work (e.g. mirror it into MongoDB, or write it to
 *   an HTTP response stream) before the next batch starts. This is what
 *   enables true progressive delivery: the caller sees/persists order N
 *   the instant it's confirmed, not after the whole month finishes.
 * @param {(progress: {checked:number, total:number, found:number}) => void} [options.onProgress]
 *   called after EVERY candidate resolves (found, confirmed absent, or
 *   still ambiguous) — lets a caller show a live "X / Y checked, Z found"
 *   indicator without waiting for the whole walk.
 * @param {Set<number>} [options.skipCounters]
 *   counters to skip WITHOUT calling Quick at all — used when the caller
 *   already has a locally-known, trusted answer for that specific number
 *   (e.g. app/api/orders/quick/route.js's current-month path already
 *   refreshed these via its own local-order status loop). Still counted in
 *   `checked`/`onProgress` so the total stays accurate, but costs zero
 *   Quick API calls. Never used to skip a number this function has no other
 *   source of truth for — only ever numbers the caller has ALREADY
 *   confirmed exist locally.
 * @returns {Promise<Array<{_fullTrackingNumber:string, _numericCounter:number, body:object}>>}
 */
export async function fetchQuickOrdersForMonth(credentials, prefix, period, startCounter, options = {}) {
  const {
    signal,
    batchSize = DEFAULT_BATCH_SIZE,
    maxRequests = DEFAULT_MAX_REQUESTS,
    onOrder,
    onProgress,
    skipCounters,
  } = options;

  if (startCounter == null) return []; // no orders this month yet
  let counter = Number(startCounter);
  if (!Number.isFinite(counter) || counter < MONTH_BOUNDARY_COUNTER) return [];

  const total = counter - MONTH_BOUNDARY_COUNTER + 1;
  const orders = [];
  let requests = 0;
  let checked = 0;

  while (counter >= MONTH_BOUNDARY_COUNTER && requests < maxRequests) {
    const batchCounters = [];
    while (
      batchCounters.length < batchSize &&
      counter >= MONTH_BOUNDARY_COUNTER &&
      requests < maxRequests
    ) {
      batchCounters.push(counter);
      counter -= 1;
      requests += 1;
    }
    if (batchCounters.length === 0) break;

    await Promise.all(
      batchCounters.map(async (c) => {
        const trackingNumber = `${prefix}${period}01${c}`;
        if (skipCounters?.has(c)) {
          // Caller already has a trusted, locally-confirmed answer for this
          // exact number — skip the Quick call entirely (see this
          // function's own `skipCounters` doc comment). Still counted, so
          // progress reporting stays accurate.
          checked += 1;
          onProgress?.({ checked, total, found: orders.length });
          return;
        }
        try {
          // Retry-aware: an "unknown" (ambiguous) response is retried a few
          // times before being reported as such — it is NEVER treated as a
          // confirmed absence. See lib/quick/lookup.js's own comment for
          // the exact bug class this fixes (a real order being silently
          // lost because its response merely didn't match the fields this
          // app happened to check for, not because it doesn't exist).
          const { classification, body, httpStatus } = await lookupQuickParcel(credentials, trackingNumber, signal);
          if (classification === "exists") {
            const order = { _fullTrackingNumber: trackingNumber, _numericCounter: c, body };
            orders.push(order);
            await onOrder?.(order);
          } else if (classification === "not_found") {
            // A single missing number within the range is a tolerated gap,
            // not a stop condition — see module comment. Never logged for
            // an "unknown" result (see the branch below) — only a
            // CONFIRMED absence (404, or an explicit not-found phrase).
            console.warn(
              `Quick order ${trackingNumber} not found within its expected monthly range (${MONTH_BOUNDARY_COUNTER}-${startCounter}) — treated as a harmless gap.`
            );
          } else {
            // Still ambiguous after retrying — deliberately NOT logged as a
            // "harmless gap" (it is not a confirmed absence) so this stays
            // diagnosable rather than silently masquerading as a normal
            // gap. Never logs the API key; `httpStatus` and a bounded
            // preview of the response shape (keys only, not values, since
            // a value could in principle carry customer data) are safe.
            console.warn(
              `Quick order ${trackingNumber} could not be confirmed after retrying (ambiguous response, httpStatus=${httpStatus}, responseKeys=${
                body && typeof body === "object" ? Object.keys(body).join(",") : String(body)
              }) — skipped this run, NOT treated as a confirmed gap.`
            );
          }
        } catch (err) {
          if (err?.name === "AbortError") throw err;
          console.error("Quick order fetch failed for", trackingNumber, "-", err?.message);
        } finally {
          checked += 1;
          onProgress?.({ checked, total, found: orders.length });
        }
      })
    );
  }

  return orders;
}
