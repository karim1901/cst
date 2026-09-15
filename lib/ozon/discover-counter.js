/**
 * Discovers the highest Ozon tracking-number counter that genuinely exists
 * for one (prefix, period), by probing forward from the fixed monthly
 * floor (`MONTH_BOUNDARY_COUNTER`, 1000) until a run of consecutive
 * "not found" results — the same gap-tolerant idea lib/ozon/fetch-orders.js
 * already uses when WALKING a known range, applied here to FIND the range
 * in the first place.
 *
 * This exists for exactly one situation: an owner (almost always a newly
 * added employee) whose real Ozon activity predates being added to this
 * app, so neither `User.ozonTrackingCounter` (current month) nor
 * `TrackingCounter` (past months — see lib/tracking/reserve-counter.js)
 * has ever heard of them; both stay silent/empty forever since they are
 * only ever written by an order actually being CREATED through this app.
 * See lib/commission/sync-historical-orders.js, the one caller — only for
 * HISTORICAL (non-current) months; the current month uses the live
 * `ozonTrackingCounter` instead (never blind probing) — see that module's
 * own comment.
 *
 * PERFORMANCE (root cause of "Sync now" being slow with real historical
 * volume — see this fix's own investigation): the previous version probed
 * ONE counter at a time, fully sequentially, each probe itself 2 Ozon HTTP
 * calls (`fetchMergedOrder` — tracking + parcel-info) — a real month with
 * ~100+ orders meant 100+ sequential round trips (200+ HTTP calls) just to
 * find the range, before even fetching a single order's own details. This
 * now probes `batchSize` counters CONCURRENTLY per round (same 5-at-a-time
 * convention lib/ozon/fetch-orders.js already uses), while still applying
 * the "consecutive misses" stop rule strictly in ascending counter order
 * (not arrival order) — so the exact same stop condition as the sequential
 * version is preserved, just ~5x fewer round trips.
 *
 * Deliberately NEVER used for tracking-number GENERATION or order
 * CREATION (see lib/ozon/reserve-tracking-number.js, untouched) — this is
 * read-only discovery of what already exists at the provider.
 *
 * ALSO used (via the optional `startCounter` option, added for this fix) to
 * VERIFY the CURRENT month's own live counter is not stale — root cause of
 * a real reported case: `User.ozonTrackingCounter` can be corrected
 * downward by a merchant (see app/api/employees/[id]/route.js's
 * administrative override — a genuine, legitimate feature, not a bug in
 * itself), and if it is ever set LOWER than the true highest counter Ozon
 * actually has, `syncHistoricalOzonOrders`'s current-month branch (which
 * otherwise trusts that live counter completely, never blind-probing for
 * the current month) would silently stop short of real, already-delivered
 * orders forever — no amount of re-running reconciliation would ever find
 * them, since our own bookkeeping believed the range already ended. See
 * that module's own "verify + self-heal" step, which calls this function
 * with `startCounter: (live counter)` to probe a bounded margin PAST what
 * we currently believe is the ceiling.
 */

if (typeof window !== "undefined") {
  throw new Error("lib/ozon/discover-counter.js is server-only and must not be imported in client code");
}

import { fetchMergedOrder } from "@/lib/ozon/client";
import { buildFullOzonTrackingNumber } from "@/lib/ozon/tracking-number";
import { MONTH_BOUNDARY_COUNTER } from "@/lib/tracking/counter";

// A real, densely-used range rarely has more than a handful of consecutive
// gaps (individual missing/cancelled numbers) — see fetch-orders.js's own
// module comment on the same phenomenon. 30 in a row is a generous margin
// before concluding "this is genuinely the end of the range", without
// wastefully probing far past it. (Raised from 12 — a real investigation
// found this stop condition is the kind of boundary that can silently hide
// trailing real orders past an unusually long but legitimate gap; 30 cuts
// that false-stop risk substantially while staying bounded by
// DEFAULT_MAX_PROBES below.)
const DEFAULT_MAX_CONSECUTIVE_MISSES = 30;
// A sanity ceiling only — guards against pathological/corrupted input, not
// a normal-operation limit. Matches the spirit of fetch-orders.js's own
// DEFAULT_MAX_REQUESTS.
const DEFAULT_MAX_PROBES = 3000;
// Same concurrency level as lib/ozon/fetch-orders.js's own
// DEFAULT_BATCH_SIZE — one consistent controlled-concurrency convention
// across the whole Ozon integration, not a second, differently-tuned one.
const DEFAULT_BATCH_SIZE = 5;

/**
 * @param {{ozonId:string, apiKey:string}} credentials
 * @param {string} prefix employee/merchant tracking-number prefix
 * @param {string} period "YYYYMM"
 * @param {object} [options]
 * @param {AbortSignal} [options.signal]
 * @param {number} [options.maxConsecutiveMisses]
 * @param {number} [options.maxProbes]
 * @param {number} [options.batchSize]
 * @param {number} [options.startCounter] probe forward from THIS counter
 *   (exclusive of anything below it) instead of `MONTH_BOUNDARY_COUNTER` —
 *   used to verify/extend a value already believed to be the ceiling (see
 *   module comment's "current month counter verification" paragraph).
 *   Defaults to `MONTH_BOUNDARY_COUNTER` (the original "discover from
 *   scratch" behavior, unchanged).
 * @returns {Promise<number|null>} the highest counter found to genuinely
 *   exist at or above the starting point, or `null` if nothing was found.
 */
export async function discoverHighestOzonCounter(credentials, prefix, period, options = {}) {
  const {
    signal,
    maxConsecutiveMisses = DEFAULT_MAX_CONSECUTIVE_MISSES,
    maxProbes = DEFAULT_MAX_PROBES,
    batchSize = DEFAULT_BATCH_SIZE,
    startCounter = MONTH_BOUNDARY_COUNTER,
  } = options;

  let highest = null;
  let consecutiveMisses = 0;
  let probes = 0;
  let counter = startCounter;

  while (consecutiveMisses < maxConsecutiveMisses && probes < maxProbes) {
    const batchCounters = [];
    while (batchCounters.length < batchSize && probes < maxProbes) {
      batchCounters.push(counter);
      counter++;
      probes++;
    }
    if (batchCounters.length === 0) break;

    // Checked concurrently; results are applied strictly in ascending
    // counter order below (not arrival order) so "consecutive misses" is
    // computed identically to the old fully-sequential version.
    const existsFlags = await Promise.all(
      batchCounters.map(async (c) => {
        const trackingNumber = buildFullOzonTrackingNumber(prefix, period, c);
        try {
          return (await fetchMergedOrder(credentials, trackingNumber, signal)) != null;
        } catch (err) {
          if (err?.name === "AbortError") throw err;
          // A single flaky request is treated as a miss for discovery
          // purposes only — never lets one transient failure abort the
          // whole scan.
          return false;
        }
      })
    );

    for (let i = 0; i < batchCounters.length; i++) {
      if (existsFlags[i]) {
        highest = batchCounters[i];
        consecutiveMisses = 0;
      } else {
        consecutiveMisses++;
        if (consecutiveMisses >= maxConsecutiveMisses) break;
      }
    }
  }

  return highest;
}
