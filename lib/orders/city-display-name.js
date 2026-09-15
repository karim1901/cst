/**
 * Resolve the human-readable city name to DISPLAY for one order — pure,
 * zero imports (client-safe, and testable with plain `node`).
 *
 * Root cause this exists to fix: `app/api/orders/ozon/route.js`'s POST
 * handler used to store the raw Ozon city ID (the value
 * `OzonCitySelect.jsx` submits — Ozon's `add-parcel` API needs the numeric
 * ID, never a name) directly into `Order.city`, the field every other part
 * of the app treats as the human-readable name. That write path is now
 * fixed (the real name is resolved server-side and `providerLocationId`
 * stores the ID separately — see that route's own comment), but an order
 * created BEFORE the fix still has `city` holding a raw numeric string.
 * Re-creating those orders is not an option (item 6), so every surface
 * that DISPLAYS `Order.city` calls this resolver instead of reading the
 * field directly, so a historical bad row self-heals the moment the
 * merchant's Ozon city dataset is synchronized (models/ProviderCityPricing.js
 * — see lib/orders/city-name-index.js, which builds the `cityNameById` map
 * this function reads from, ONCE per request/list — never a live provider
 * call per order, per item 22).
 *
 * @param {{city:string|null|undefined, providerLocationId:string|null|undefined}} order
 * @param {Map<string,string>|null|undefined} cityNameById  this order's own
 *   (merchantId, provider)-scoped `cityId -> cityName` index — see
 *   lib/orders/city-name-index.js#buildCityNameIndex. `null`/`undefined`
 *   (index unavailable) degrades gracefully to step 2/4 below.
 * @returns {string|null} the best available display name — the raw stored
 *   `city` value as a last resort (NEVER fabricated/guessed), `null` only
 *   when `order.city` itself has no value at all.
 */
export function resolveOrderCityDisplayName(order, cityNameById) {
  const rawCity = String(order?.city ?? "").trim();
  const locationId = order?.providerLocationId ? String(order.providerLocationId).trim() : "";

  // 1) The reliable id -> name path: this order's own real provider city id
  // (never the possibly-wrong `city` field) resolved against the
  // synchronized dataset — authoritative whenever both are available,
  // regardless of what `city` itself currently holds.
  if (locationId && cityNameById?.has(locationId)) {
    return cityNameById.get(locationId);
  }

  // 2) `city` is already a real name — the normal, non-buggy case: every
  // order created after the fix, and every historically-synced order
  // (lib/commission/sync-historical-orders.js always stored Ozon's own
  // CITY_NAME, never the id).
  if (rawCity && !/^\d+$/.test(rawCity)) {
    return rawCity;
  }

  // 3) `city` itself IS a raw numeric provider id — the exact bug this
  // resolver exists for (a pre-fix order created through our own form).
  // Resolve it the same way, using the numeric string itself as the id key.
  if (rawCity && cityNameById?.has(rawCity)) {
    return cityNameById.get(rawCity);
  }

  // 4) Nothing better available (dataset not synchronized yet, or a
  // genuinely unknown id) — never fabricate a name; fall back to whatever
  // is stored so nothing renders as a hard blank.
  return rawCity || null;
}
