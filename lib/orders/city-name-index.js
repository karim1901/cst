/**
 * Server-only: builds the `cityId -> cityName` lookup one merchant+provider
 * needs to resolve `Order.city` display names (see
 * lib/orders/city-display-name.js's own comment for the full picture) — ONE
 * query per request/list, never once per order, and NEVER a live call to
 * the provider (Finance/Orders must stay fast — item 22). Reads the SAME
 * already-synchronized dataset Finance's shipping-cost resolution already
 * depends on (models/ProviderCityPricing.js, populated by
 * lib/finance/sync-city-pricing.js) — no second/duplicate city store.
 */

if (typeof window !== "undefined") {
  throw new Error("lib/orders/city-name-index.js is server-only and must not be imported in client code");
}

import ProviderCityPricing from "@/models/ProviderCityPricing";

export { resolveOrderCityDisplayName } from "@/lib/orders/city-display-name";

/**
 * @param {string} merchantId
 * @param {string} provider
 * @returns {Promise<Map<string,string>>} cityId -> cityName (only entries
 *   that actually have a synchronized name — a pricing row with no name yet
 *   contributes nothing rather than mapping to an empty string).
 */
export async function buildCityNameIndex(merchantId, provider) {
  const docs = await ProviderCityPricing.find({ merchantId, provider })
    .select("cityId cityName")
    .lean();
  return new Map(docs.filter((doc) => doc.cityName).map((doc) => [doc.cityId, doc.cityName]));
}
