/**
 * Retry-aware Ozon Express parcel existence check — the ONE place that
 * decides, for a single tracking number, whether it "exists" / is
 * confirmed "not_found" / is genuinely "unknown" (an API/network failure,
 * never to be treated as absence). Uses Ozon's OWN already-established
 * signal, unchanged — `TRACKING.RESULT === "ERROR"` — which every existing
 * piece of this integration (lib/ozon/fetch-orders.js,
 * lib/ozon/discover-counter.js, lib/ozon/client.js#fetchMergedOrder) has
 * always treated as "this tracking number is not a real/valid parcel", not
 * an invented new response shape.
 *
 * ROOT CAUSE this module exists to fix: `fetchMergedOrder` returns `null`
 * for BOTH "Ozon confirms this tracking number does not exist" AND, if it
 * were ever called from a context that swallowed a thrown network/HTTP
 * error the same way, would be indistinguishable from a genuine absence —
 * every EXISTING caller of `fetchMergedOrder` only ever uses that `null`
 * for discovery/display (a false negative there just means one order is
 * temporarily not shown — never destructive), so this was harmless before.
 * It becomes destructive the moment a caller uses "not confirmed" to
 * DELETE a local record — see lib/ozon/reconcile-current-month.js, the
 * ONE place that does. This module is what makes that distinction safe:
 * a THROWN exception (network error, non-2xx HTTP status, malformed JSON —
 * see lib/ozon/client.js#postForm) is `"unknown"`, never `"not_found"`.
 */

if (typeof window !== "undefined") {
  throw new Error("lib/ozon/lookup.js is server-only and must not be imported in client code");
}

import { fetchMergedOrder } from "@/lib/ozon/client";

// Extra attempts beyond the first, only for a genuine API/network failure —
// never retried for a normal "exists"/"not_found" resolution, which Ozon's
// tracking endpoint answers unambiguously in one call.
const DEFAULT_RETRY_ATTEMPTS = 2;
const DEFAULT_RETRY_DELAY_MS = 300;

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * @param {{ozonId:string, apiKey:string}} credentials
 * @param {string} trackingNumber full tracking number
 * @param {AbortSignal} [signal]
 * @param {{retryAttempts?:number, retryDelayMs?:number}} [options]
 * @returns {Promise<{classification:"exists"|"not_found"|"unknown", merged:object|null}>}
 */
export async function lookupOzonParcel(credentials, trackingNumber, signal, options = {}) {
  const { retryAttempts = DEFAULT_RETRY_ATTEMPTS, retryDelayMs = DEFAULT_RETRY_DELAY_MS } = options;

  for (let attempt = 0; attempt <= retryAttempts; attempt++) {
    try {
      const merged = await fetchMergedOrder(credentials, trackingNumber, signal);
      // `fetchMergedOrder` already resolves Ozon's own established signal
      // (TRACKING.RESULT === "ERROR" -> null) — a genuine, confirmed
      // absence, not ambiguity. No retry needed for this outcome.
      return { classification: merged ? "exists" : "not_found", merged };
    } catch (err) {
      if (err?.name === "AbortError") throw err;
      if (attempt < retryAttempts) {
        await delay(retryDelayMs);
        continue;
      }
      // Exhausted retries on a genuine network/HTTP/parse failure — this is
      // the ONE case that must never be treated as "does not exist".
      return { classification: "unknown", merged: null };
    }
  }

  return { classification: "unknown", merged: null };
}
