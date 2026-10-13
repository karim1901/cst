/**
 * Resolve which of an EXISTING Ozon Order's mutable, provider-owned fields
 * should be updated from a fresh `PARCEL-INFO.INFOS` response.
 *
 * ROOT CAUSE this fixes: lib/commission/sync-historical-orders.js's
 * existing-order branch previously only ever refreshed `lastKnownStatus` /
 * `deliveredAt` for an already-known order — never its receiver, phone,
 * city, address, price, or note — even though the SAME fetch
 * (lib/ozon/fetch-orders.js -> lib/ozon/client.js#fetchMergedOrder, which
 * already calls BOTH `tracking` AND `parcel-info`) already carries the
 * current INFOS every single time a sync walk passes over that order. An
 * edit made directly in the Ozon dashboard (price, receiver, phone,
 * address, city) therefore never reached this app's local mirror, no
 * matter how many times it was synced.
 *
 * REAL, LIVE-VERIFIED response shape (api.ozonexpress.ma's `parcel-info`,
 * confirmed against this project's own test merchant/order — not guessed):
 *   PARCEL-INFO.INFOS = {
 *     "TRACKING-NUMBER", "RECEIVER", "PHONE", "CITY_ID", "CITY_NAME",
 *     "ADDRESS", "PRICE", "NOTE",
 *     "DELIVERED-PRICE", "RETURNED-PRICE", "REFUSED-PRICE"
 *   }
 * The last three are Ozon's own per-OUTCOME shipping-fee figures for this
 * parcel's city — informational, and already covered by the EXISTING,
 * SEPARATE per-city pricing mechanism this app already has
 * (lib/finance/sync-city-pricing.js / models/ProviderCityPricing.js, keyed
 * by city, not by order) — intentionally NOT mapped onto the Order document
 * here, to avoid a second, competing source for the same shipping-cost
 * figures. Ozon's parcel-info does NOT expose a quantity field for a
 * parcel at all (confirmed against the same real response) — `Order.quantity`
 * stays Quick-only, exactly as before; nothing here ever touches it.
 *
 * SAFEGUARDS — deliberately NOT identical to
 * lib/quick/amount.js#resolveSyncedQuickPrice, which only ever FILLS IN a
 * still-unknown Quick price once, because Quick's own API never reports a
 * price for an order it didn't carry one for in the first place. Ozon's
 * parcel-info IS reliably authoritative for every existing Ozon order on
 * every check, and a genuine provider-side price EDIT is exactly what this
 * task asks to flow through — so an already-known, already-trustworthy
 * Ozon price is still replaced by a new valid one, unlike Quick's:
 *
 *  - PRICE: adopted only when the response gives a finite, POSITIVE number
 *    that differs from the stored one. A missing/non-numeric/zero/negative
 *    PRICE never touches the existing value — there is no real scenario
 *    where a genuine parcel has no price, so a response like that is
 *    treated as thin/partial, never as "the price is now 0".
 *  - RECEIVER / PHONE / CITY_NAME: adopted only when the response's value is
 *    a non-empty string that differs from the stored one — mirrors the
 *    EXISTING creation-time rule in the same file (a response missing any
 *    of these three is not trusted enough to even CREATE a new order from,
 *    see sync-historical-orders.js's own `skipped` branch), applied the
 *    same way here: never downgrade a real value to empty.
 *  - CITY_ID -> `providerLocationId`: adopted whenever the response's id is
 *    present and differs from what's stored — including backfilling a
 *    REAL, PRE-EXISTING gap, where an order discovered by historical sync
 *    (as opposed to one created directly through this app) never had this
 *    field set at all, leaving city-pricing resolution
 *    (lib/orders/resolve-city-pricing-doc.js) to fall back to a city-NAME
 *    match only.
 *  - ADDRESS / NOTE (-> productNature): Ozon can legitimately report these
 *    as genuinely empty (e.g. a field was cleared) — adopted whenever the
 *    INFOS key is actually PRESENT in the response (even as `""`), using
 *    the SAME `"" -> "N/A"` placeholder convention this file's
 *    order-CREATION path already uses, so "explicitly empty" and
 *    "genuinely absent from a thin response" are told apart exactly the
 *    way the rest of this app already does. `Order.address` / `.productNature`
 *    are both required non-empty strings on the schema — "N/A" is the
 *    existing, deliberate placeholder for "no value provided", never a raw
 *    empty string.
 *
 * Every comparison is against the CURRENT stored value, and the returned
 * object only ever contains fields that actually changed — an
 * already-correct order produces `null` (no write, no `updatedAt` bump) —
 * so a healthy, unedited order costs nothing extra on every sync pass.
 */

const EMPTY_TO_NA = (value) => (value === "" || value == null ? "N/A" : value);

/**
 * @param {{receiverName, phone, city, providerLocationId, address, productNature, price}} existing
 *   the current local Order's own mutable fields (NOT the Mongoose
 *   document — a plain object is enough, e.g. from `.lean()`).
 * @param {object} infos raw `PARCEL-INFO.INFOS` from a fresh fetch.
 * @returns {object|null} the `$set` fields to write, or `null` if nothing
 *   needs to change.
 */
export function resolveOzonMutableFieldUpdates(existing, infos) {
  if (!existing || !infos) return null;
  const updates = {};

  if (typeof infos.RECEIVER === "string" && infos.RECEIVER.trim() && infos.RECEIVER !== existing.receiverName) {
    updates.receiverName = infos.RECEIVER;
  }
  if (typeof infos.PHONE === "string" && infos.PHONE.trim() && infos.PHONE !== existing.phone) {
    updates.phone = infos.PHONE;
  }
  if (typeof infos.CITY_NAME === "string" && infos.CITY_NAME.trim() && infos.CITY_NAME !== existing.city) {
    updates.city = infos.CITY_NAME;
  }
  if (infos.CITY_ID != null && String(infos.CITY_ID).trim()) {
    const newCityId = String(infos.CITY_ID).trim();
    if (newCityId !== String(existing.providerLocationId ?? "")) {
      updates.providerLocationId = newCityId;
    }
  }
  if ("ADDRESS" in infos) {
    const next = EMPTY_TO_NA(infos.ADDRESS);
    if (next !== existing.address) updates.address = next;
  }
  if ("NOTE" in infos) {
    const next = EMPTY_TO_NA(infos.NOTE);
    if (next !== existing.productNature) updates.productNature = next;
  }

  const incomingPrice = Number(infos.PRICE);
  if (Number.isFinite(incomingPrice) && incomingPrice > 0 && incomingPrice !== Number(existing.price)) {
    updates.price = incomingPrice;
    // Ozon is the authoritative live source for its own orders — a genuine
    // provider-side price edit must win over whatever this order's price
    // was previously sourced from (including "manual"), matching this
    // task's own explicit requirement. See this module's own comment for
    // why that is a deliberate difference from Quick's price-fill rule.
    updates.priceSource = "provider_sync";
  }

  return Object.keys(updates).length > 0 ? updates : null;
}
