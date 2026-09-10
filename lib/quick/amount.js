/**
 * Parse a provider-supplied "amount" string/number into a non-negative
 * number safe to store in `Order.price`. Pure, zero-import — so both
 * lib/quick/sync-order.js (server) and scripts/verify-commission-units.mjs
 * (plain Node) can use it.
 *
 * WHY THIS EXISTS: a bare `Number(info.price)` is not safe here.
 * `Number(null)` and `Number("")` are both `0` and both pass
 * `Number.isFinite`, so a MISSING amount silently became a real stored
 * `0` — which the commission layer then counted as a "< 350 DH -> 1 unit"
 * order (one phantom unit per unpriced synced order). This parser is
 * explicit:
 *
 *   - a finite number `> 0`                                  -> that number
 *   - a string with a positive numeric value
 *     ("400", "400.00", "1,250.5", "400 DH", "MAD 400")      -> that number
 *   - anything else (null, undefined, "", "  ", 0, negative,
 *     NaN, "abc")                                            -> 0
 *
 * `0` is the sentinel for "the provider did not give a usable amount" —
 * never a real free order. lib/commission/calculate.js#isUsableCommissionPrice
 * treats it (and every other non-positive value) as "price unknown -> 0
 * commission units".
 *
 * @param {unknown} raw
 * @returns {number} a finite number >= 0
 */
export function parseProviderAmount(raw) {
  if (typeof raw === "number") {
    return Number.isFinite(raw) && raw > 0 ? raw : 0;
  }
  // Keep only digits and dots, then drop all but the first dot so
  // "1,250.50 DH" -> "1250.50" and "12.34.56" -> "12.3456" (still a
  // deterministic number, never NaN).
  const cleaned = String(raw ?? "").replace(/[^\d.]/g, "");
  const firstDot = cleaned.indexOf(".");
  const normalized =
    firstDot === -1
      ? cleaned
      : cleaned.slice(0, firstDot + 1) + cleaned.slice(firstDot + 1).replace(/\./g, "");
  const value = Number(normalized);
  return Number.isFinite(value) && value > 0 ? value : 0;
}

const TRUSTWORTHY_PRICE_SOURCES = new Set(["order_creation", "manual", "provider_sync"]);

/**
 * Decide what `price` / `priceSource` a Quick historical-sync touch should
 * write — the guard that makes it STRUCTURALLY IMPOSSIBLE for an
 * incomplete provider response (Quick's getParcelDetails carries no
 * amount) to wipe a real local price.
 *
 * @param {{price?: number, priceSource?: string}|null} existing
 *   the local Order as it stands now, or `null` for a brand-new one.
 * @param {unknown} incomingRawAmount
 *   whatever the provider response gave for the amount (`quickOrderSummary(body).price`
 *   — almost always `null`).
 * @returns {{price:number, priceSource:string}|null}
 *   the fields to write, or `null` meaning "leave the existing price
 *   exactly as it is".
 *
 * Rules:
 *  - brand-new order:            a real incoming amount -> {price, "provider_sync"};
 *                                nothing usable -> {0, "unknown"}.
 *  - existing TRUSTWORTHY price  (priceSource order_creation/manual/provider_sync,
 *                                OR a positive price with no recorded source —
 *                                legacy rows): NEVER touched -> null.
 *  - existing UNKNOWN price + a real incoming amount now available:
 *                                upgrade -> {price, "provider_sync"}.
 *  - existing UNKNOWN price + still nothing: leave as unknown -> null.
 */
export function resolveSyncedQuickPrice(existing, incomingRawAmount) {
  const incoming = parseProviderAmount(incomingRawAmount);

  if (!existing) {
    return incoming > 0
      ? { price: incoming, priceSource: "provider_sync" }
      : { price: 0, priceSource: "unknown" };
  }

  const hasTrustworthySource = TRUSTWORTHY_PRICE_SOURCES.has(existing.priceSource);
  const legacyValidPrice = existing.priceSource == null && Number(existing.price) > 0;
  if (hasTrustworthySource || legacyValidPrice) {
    return null; // a real price — never overwritten by sync
  }

  // Price is unknown/placeholder. Fill it in only if the provider now
  // actually gave us a real amount.
  return incoming > 0 ? { price: incoming, priceSource: "provider_sync" } : null;
}
