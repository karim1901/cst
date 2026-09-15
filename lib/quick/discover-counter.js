/**
 * Discovers the highest Quick Livraison tracking-number counter that
 * genuinely exists for one (prefix, period), by probing forward from the
 * fixed monthly floor (`MONTH_BOUNDARY_COUNTER`, 1000) until a run of
 * consecutive "not found" results — mirrors lib/ozon/discover-counter.js
 * exactly (same gap-tolerant probing idea, same bounds, same controlled
 * concurrency). The only difference is which provider's client/parse
 * functions decide "does this tracking number exist": Quick's own
 * `getParcelDetails` endpoint (via lib/quick/lookup.js) instead of Ozon's
 * `tracking`/`parcel-info` pair.
 *
 * This is possible for Quick even though its own API gives no way to
 * enumerate an owner's orders directly, because Quick tracking numbers use
 * the EXACT same `prefix + period + "01" + counter` format as Ozon (see
 * lib/quick/tracking-number.js) — every candidate number is fully
 * deterministic, so it can be probed for.
 *
 * PERFORMANCE (root cause of "Sync now" being slow with real historical
 * volume — see this fix's own investigation): the previous version probed
 * ONE counter at a time, fully sequentially — a real month with ~100+
 * orders meant 100+ sequential round trips just to find the range, before
 * even fetching a single order. This now probes `batchSize` counters
 * CONCURRENTLY per round (same 5-at-a-time convention
 * lib/quick/fetch-orders.js already uses), while still applying the
 * "consecutive misses" stop rule strictly in ascending counter order (not
 * arrival order) — so the exact same stop condition as the sequential
 * version is preserved, just ~5x fewer round trips.
 *
 * Deliberately NEVER used for tracking-number GENERATION or order CREATION
 * (see lib/quick/reserve-tracking-number.js, untouched) — this is read-only
 * discovery of what already exists at the provider.
 *
 * See lib/commission/sync-historical-orders.js#syncHistoricalQuickOrders,
 * the one caller — for HISTORICAL (non-current) months (mirrors Ozon's own
 * lib/ozon/discover-counter.js exactly, including this same fix); ALSO now
 * used for the CURRENT month, via the `startCounter` option, to VERIFY the
 * live `quickTrackingCounter` before trusting it as a hard ceiling — root
 * cause of a real investigated case: an order was genuinely created
 * through this app (`priceSource: "order_creation"`, a real Quick success
 * response) while `quickTrackingCounter` never advanced to reflect it
 * (still `undefined`/at the floor afterward), so the current-month sync
 * believed "zero orders exist yet" and skipped that actor's period
 * entirely — never even reaching the stale-order reconciliation step, let
 * alone refreshing status/backfilling `orderDate`. See that module's own
 * "VERIFY + SELF-HEAL" step.
 */

if (typeof window !== "undefined") {
  throw new Error("lib/quick/discover-counter.js is server-only and must not be imported in client code");
}

import { lookupQuickParcel } from "@/lib/quick/lookup";
import { buildFullQuickTrackingNumber } from "@/lib/quick/tracking-number";
import { MONTH_BOUNDARY_COUNTER } from "@/lib/tracking/counter";

// Raised from 12 (matches the identical fix in lib/ozon/discover-counter.js
// — see that file's own comment for the full reasoning): a generous margin
// before concluding "this is genuinely the end of the range", cutting the
// false-stop risk on a legitimate long gap substantially while staying
// bounded by DEFAULT_MAX_PROBES.
const DEFAULT_MAX_CONSECUTIVE_MISSES = 30;
const DEFAULT_MAX_PROBES = 3000;
// Same concurrency level as lib/quick/fetch-orders.js's own
// DEFAULT_BATCH_SIZE — one consistent controlled-concurrency convention
// across the whole Quick integration, not a second, differently-tuned one.
const DEFAULT_BATCH_SIZE = 5;

/**
 * @param {{apiKey:string}} credentials
 * @param {string} prefix employee/merchant tracking-number prefix
 * @param {string} period "YYYYMM"
 * @param {object} [options]
 * @param {AbortSignal} [options.signal]
 * @param {number} [options.maxConsecutiveMisses]
 * @param {number} [options.maxProbes]
 * @param {number} [options.batchSize]
 * @param {number} [options.startCounter] probe forward from THIS counter
 *   instead of `MONTH_BOUNDARY_COUNTER` — used to verify/extend a value
 *   already believed to be the ceiling (see module comment's "current
 *   month counter verification" paragraph). Defaults to
 *   `MONTH_BOUNDARY_COUNTER` (the original "discover from scratch"
 *   behavior, unchanged).
 * @returns {Promise<number|null>} the highest counter found to genuinely
 *   exist at or above the starting point, or `null` if nothing was found.
 */
export async function discoverHighestQuickCounter(credentials, prefix, period, options = {}) {
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
        const trackingNumber = buildFullQuickTrackingNumber(prefix, period, c);
        try {
          // Retry-aware — an ambiguous ("unknown") response is retried
          // before being counted as a miss, so it never prematurely ends
          // the scan for a month that genuinely still has more real
          // orders below it. See lib/quick/lookup.js's own comment.
          const { classification } = await lookupQuickParcel(credentials, trackingNumber, signal);
          return classification === "exists";
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
