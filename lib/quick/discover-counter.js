/**
 * Discovers the highest Quick Livraison tracking-number counter that
 * genuinely exists for one (prefix, period), by probing forward from the
 * fixed monthly floor (`MONTH_BOUNDARY_COUNTER`, 1000) until a run of
 * consecutive "not found" results — mirrors lib/ozon/discover-counter.js
 * exactly (same gap-tolerant probing idea, same bounds). The only
 * difference is which provider's client/parse functions decide "does this
 * tracking number exist": `fetchParcelDetails` + `quickParcelExists`
 * (Quick's own `getParcelDetails` endpoint) instead of Ozon's
 * `tracking`/`parcel-info` pair.
 *
 * This is possible for Quick even though its own API gives no way to
 * enumerate an owner's orders directly, because Quick tracking numbers use
 * the EXACT same `prefix + period + "01" + counter` format as Ozon (see
 * lib/quick/tracking-number.js) — every candidate number is fully
 * deterministic, so it can be probed for.
 *
 * Deliberately NEVER used for tracking-number GENERATION or order CREATION
 * (see lib/quick/reserve-tracking-number.js, untouched) — this is read-only
 * discovery of what already exists at the provider.
 *
 * See lib/commission/sync-historical-orders.js#syncHistoricalQuickOrders,
 * the one caller.
 */

if (typeof window !== "undefined") {
  throw new Error("lib/quick/discover-counter.js is server-only and must not be imported in client code");
}

import { lookupQuickParcel } from "@/lib/quick/lookup";
import { buildFullQuickTrackingNumber } from "@/lib/quick/tracking-number";
import { MONTH_BOUNDARY_COUNTER } from "@/lib/tracking/counter";

const DEFAULT_MAX_CONSECUTIVE_MISSES = 12;
const DEFAULT_MAX_PROBES = 3000;

/**
 * @param {{apiKey:string}} credentials
 * @param {string} prefix employee/merchant tracking-number prefix
 * @param {string} period "YYYYMM"
 * @param {object} [options]
 * @param {AbortSignal} [options.signal]
 * @param {number} [options.maxConsecutiveMisses]
 * @param {number} [options.maxProbes]
 * @returns {Promise<number|null>} the highest counter found to genuinely
 *   exist, or `null` if nothing was found at all this month.
 */
export async function discoverHighestQuickCounter(credentials, prefix, period, options = {}) {
  const {
    signal,
    maxConsecutiveMisses = DEFAULT_MAX_CONSECUTIVE_MISSES,
    maxProbes = DEFAULT_MAX_PROBES,
  } = options;

  let highest = null;
  let consecutiveMisses = 0;
  let probes = 0;
  let counter = MONTH_BOUNDARY_COUNTER;

  while (consecutiveMisses < maxConsecutiveMisses && probes < maxProbes) {
    const trackingNumber = buildFullQuickTrackingNumber(prefix, period, counter);
    probes++;

    let exists = false;
    try {
      // Retry-aware — an ambiguous ("unknown") response is retried before
      // being counted as a miss, so it never prematurely ends the scan for
      // a month that genuinely still has more real orders below it. See
      // lib/quick/lookup.js's own comment.
      const { classification } = await lookupQuickParcel(credentials, trackingNumber, signal);
      exists = classification === "exists";
    } catch (err) {
      if (err?.name === "AbortError") throw err;
      // A single flaky request is treated as a miss for discovery purposes
      // only — never lets one transient failure abort the whole scan.
    }

    if (exists) {
      highest = counter;
      consecutiveMisses = 0;
    } else {
      consecutiveMisses++;
    }
    counter++;
  }

  return highest;
}
