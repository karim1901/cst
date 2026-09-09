/**
 * Shared, retry-aware Quick Livraison parcel lookup — the ONE place
 * lib/quick/fetch-orders.js and lib/quick/discover-counter.js both call to
 * decide whether one candidate tracking number exists at Quick.
 *
 * ROOT CAUSE this exists to fix: a single ambiguous/inconclusive
 * `getParcelDetails` response (a generic `{success:false}` wrapper flag
 * unrelated to whether THAT specific parcel was found, a malformed/empty
 * body, a transient rate-limit/server hiccup during a burst of many
 * requests, ...) was previously treated EXACTLY the same as a confirmed
 * "this tracking number does not exist" (see the old `quickParcelExists`),
 * silently losing real, existing orders during a historical-month
 * discovery walk and logging them as "harmless gap" — indistinguishable
 * from a genuinely nonexistent number. See
 * lib/quick/parse.js#classifyQuickParcelLookup, the 3-way classification
 * this relies on.
 *
 * A handful of quick retries (short delay, bounded) resolve the vast
 * majority of transient ambiguity without meaningfully slowing down a
 * month's worth of lookups. A result that is STILL ambiguous after
 * retrying is reported as such — NEVER silently folded into "confirmed
 * absent" — so a genuine parsing/shape problem stays diagnosable instead
 * of masquerading as a normal, expected gap.
 */

if (typeof window !== "undefined") {
  throw new Error("lib/quick/lookup.js is server-only and must not be imported in client code");
}

import { fetchParcelDetails } from "@/lib/quick/client";
import { classifyQuickParcelLookup } from "@/lib/quick/parse";

// Extra attempts beyond the first, only when a response is genuinely
// ambiguous (never retried for a confirmed "exists" or "not_found" — those
// resolve on the first try).
const DEFAULT_RETRY_ATTEMPTS = 2;
const DEFAULT_RETRY_DELAY_MS = 300;

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * @param {{apiKey:string}} credentials
 * @param {string} trackingNumber
 * @param {AbortSignal} [signal]
 * @param {{retryAttempts?:number, retryDelayMs?:number}} [options]
 * @returns {Promise<{classification:"exists"|"not_found"|"unknown", body:object|null, httpStatus:number|null, attempts:number}>}
 */
export async function lookupQuickParcel(credentials, trackingNumber, signal, options = {}) {
  const { retryAttempts = DEFAULT_RETRY_ATTEMPTS, retryDelayMs = DEFAULT_RETRY_DELAY_MS } = options;

  let lastBody = null;
  let lastHttpStatus = null;

  for (let attempt = 0; attempt <= retryAttempts; attempt++) {
    const { httpStatus, body } = await fetchParcelDetails(credentials, trackingNumber, signal);
    const classification = classifyQuickParcelLookup(body, httpStatus);
    if (classification !== "unknown") {
      return { classification, body, httpStatus, attempts: attempt + 1 };
    }
    lastBody = body;
    lastHttpStatus = httpStatus;
    if (attempt < retryAttempts) {
      await delay(retryDelayMs);
    }
  }

  return { classification: "unknown", body: lastBody, httpStatus: lastHttpStatus, attempts: retryAttempts + 1 };
}
