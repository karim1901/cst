/**
 * Server-only: fetch a user's Ozon orders for one calendar month, newest
 * first.
 *
 * The range is now fully deterministic — [MONTH_BOUNDARY_COUNTER,
 * startCounter] — instead of an open-ended descending scan with a
 * "consecutive misses" stop heuristic: since counters reset to
 * MONTH_BOUNDARY_COUNTER (1000) every month and `startCounter` is the
 * latest counter actually reached in that month (see
 * lib/tracking/reserve-counter.js), every value in between is a real
 * tracking number that was (almost always) successfully used. An individual
 * miss within the range is still tolerated — never fatal, never a stop
 * condition — because a release-on-failure race can rarely leave a small
 * gap (see lib/tracking/reserve-counter.js's module comment) — but the walk
 * always continues down to and including the boundary itself, then stops.
 * Never below it.
 */

import { fetchMergedOrder } from "@/lib/ozon/client";
import { MONTH_BOUNDARY_COUNTER } from "@/lib/tracking/counter";

if (typeof window !== "undefined") {
  throw new Error("lib/ozon/fetch-orders.js is server-only and must not be imported in client code");
}

// Each order costs 2 Ozon HTTP calls (tracking + parcel-info) — this bounds
// how many are in flight at once, not how many orders are in progress.
const DEFAULT_BATCH_SIZE = 5;
// A generous sanity ceiling (not a normal-operation limit): a single month
// realistically has nowhere near this many orders for one employee. Only
// guards against a corrupted/absurd stored counter value.
const DEFAULT_MAX_REQUESTS = 5000;

/**
 * @param {{ozonId:string, apiKey:string}} credentials
 * @param {string} prefix                employee.username or the merchant's derived prefix
 * @param {string} period                "YYYYMM" — the month being fetched
 * @param {number|null} startCounter     the counter to start from — from
 *                                        `peekNextOzonCounter` for the current month, or
 *                                        `peekOzonCounterForPeriod` for a past one (see
 *                                        lib/ozon/reserve-tracking-number.js) — or null if
 *                                        there is nothing to fetch
 * @param {object} [options]
 * @param {AbortSignal} [options.signal]
 * @param {number} [options.batchSize]   how many orders to fetch concurrently per round
 * @param {number} [options.maxRequests] sanity ceiling — see module comment
 * @param {(order: object) => void} [options.onOrder]  called the moment EACH
 *   individual order resolves (i.e. as soon as its own request finishes, not
 *   when the whole batch does) — this is what enables progressive delivery.
 * @returns {Promise<object[]>} merged orders, newest first
 */
export async function fetchOzonOrdersForMonth(credentials, prefix, period, startCounter, options = {}) {
  const { signal, batchSize = DEFAULT_BATCH_SIZE, maxRequests = DEFAULT_MAX_REQUESTS, onOrder } = options;

  if (startCounter == null) return []; // no orders this month yet
  let counter = Number(startCounter);
  if (!Number.isFinite(counter) || counter < MONTH_BOUNDARY_COUNTER) return [];

  const orders = [];
  let requests = 0;

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

    // Fire the whole batch concurrently; `onOrder` fires per-item as soon as
    // THAT item's own fetch resolves, not when the whole batch does — same
    // progressive-delivery mechanism as before.
    await Promise.all(
      batchCounters.map(async (c) => {
        const trackingNumber = `${prefix}${period}01${c}`;
        try {
          const merged = await fetchMergedOrder(credentials, trackingNumber, signal);
          if (merged) {
            merged._numericTrackingNumber = String(c);
            // Threaded through explicitly (not regex-recovered from a
            // display field) for the same reason as `_numericTrackingNumber`
            // above — see lib/commission/sync-status.js, the one consumer.
            merged._fullTrackingNumber = trackingNumber;
            orders.push(merged);
            onOrder?.(merged);
          } else {
            // A single missing number within the range is a tolerated gap,
            // not a stop condition — see module comment.
            console.warn(
              `Ozon order ${trackingNumber} not found within its expected monthly range (${MONTH_BOUNDARY_COUNTER}-${startCounter}) — treated as a harmless gap.`
            );
          }
        } catch (err) {
          if (err?.name === "AbortError") throw err;
          console.error("Ozon order fetch failed for", trackingNumber, "-", err?.message);
        }
      })
    );
  }

  return orders;
}
