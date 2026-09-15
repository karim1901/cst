/**
 * Resolve the `ProviderCityPricing` document that applies to ONE order —
 * pure, zero imports (client-safe, testable with plain `node`). The single
 * shared algorithm `lib/finance/calculate.js`'s shipping-cost resolution
 * uses, so it can never drift from lib/orders/city-display-name.js's
 * equivalent "which city does this order really belong to" reasoning.
 *
 * ROOT CAUSE this exists to fix: `app/api/orders/ozon/route.js`'s POST
 * handler used to store the raw Ozon city ID directly into `Order.city`
 * (see that route's own comment) and never set `providerLocationId` at
 * all. For every such pre-fix order, Finance's OLD resolution —
 * `cityPricingMap.get(order.providerLocationId) ??
 * cityPricingByName.get(normalizeName(order.city))` — failed BOTH lookups:
 * `providerLocationId` was `null`, and `order.city` held a bare number
 * ("1363"), which can never match a real `cityName` like "Agadir". The
 * shipping cost silently fell through to "not configured"
 * (`shippingCostMissing`), even though the exact Ozon city (by ID) was
 * already synchronized locally in `ProviderCityPricing` all along.
 *
 * Preferred resolution order (never fuzzy/guessed — item 16):
 *   1. exact `providerLocationId` -> `byId` match (the reliable case, and
 *      every order created after the POST-handler fix).
 *   2. `order.city` is already a real name -> `byName` match (historical-
 *      sync orders, which always stored Ozon's own CITY_NAME).
 *   3. `order.city` ITSELF is a raw numeric provider id (the exact bug
 *      above) -> `byId` match using that numeric string as the key. This
 *      is what lets a historical bad row resolve correctly WITHOUT
 *      re-creating the order or backfilling `providerLocationId` — see
 *      item 17.
 *   4. Nothing matches -> `null` (genuinely unresolved; never fabricated,
 *      never defaulted to 0 — see lib/finance/calculate.js's own "missing
 *      vs real zero" rule).
 *
 * @param {{city:string|null|undefined, providerLocationId:string|null|undefined}} order
 * @param {Map<string,object>} byId    cityId -> ProviderCityPricing doc
 * @param {Map<string,object>} byName  normalized cityName -> ProviderCityPricing doc
 * @returns {object|null} the matched ProviderCityPricing-shaped doc, or `null`.
 */
export function resolveOrderCityPricingDoc(order, byId, byName) {
  const locationId = order?.providerLocationId ? String(order.providerLocationId).trim() : "";
  if (locationId && byId?.has(locationId)) {
    return byId.get(locationId);
  }

  const rawCity = String(order?.city ?? "").trim();
  const looksNumeric = /^\d+$/.test(rawCity);

  if (rawCity && !looksNumeric) {
    const match = byName?.get(rawCity.toLowerCase());
    if (match) return match;
  }

  if (rawCity && looksNumeric && byId?.has(rawCity)) {
    return byId.get(rawCity);
  }

  return null;
}
