/**
 * Server-only: syncs Ozon Express's real per-city shipping prices (its
 * public `/cities` endpoint — no credentials involved, same one
 * app/api/orders/ozon/cities/route.js already proxies for the order-
 * creation city picker) into the local `ProviderCityPricing` cache, so
 * Finance's statistics never need a live provider call per request.
 *
 * Verified live response shape (see this feature's own investigation):
 *   { "CITIES": { "<id>": { "ID":37, "NAME":"Agadir",
 *       "DELIVERED-PRICE":35, "RETURNED-PRICE":0, "REFUSED-PRICE":10 }, ... } }
 *
 * Quick Livraison has NO per-city pricing API at all — verified live
 * against its real `getCityIDs` response, which returns only
 * `{city_id, city_name}`, nothing price-related. There is deliberately no
 * `syncQuickCityPricing` here: Quick's shipping cost is a merchant-entered
 * FLAT rate instead — see models/ProviderCityPricing.js's own comment
 * (`FLAT_RATE_CITY_ID`) and app/api/finance/city-pricing/route.js's PATCH
 * handler, the one place that flat rate is set.
 */

if (typeof window !== "undefined") {
  throw new Error("lib/finance/sync-city-pricing.js is server-only and must not be imported in client code");
}

import { fetchCities } from "@/lib/ozon/client";
import ProviderCityPricing from "@/models/ProviderCityPricing";
import { SHIPPING_PROVIDERS } from "@/lib/shipping/providers";
import { dhToCents } from "@/lib/finance/money";

/**
 * @param {string} merchantId
 * @returns {Promise<{synced: number}>}
 */
export async function syncOzonCityPricing(merchantId, signal) {
  const data = await fetchCities(signal);
  const raw = data?.CITIES ?? {};

  const now = new Date();
  let synced = 0;

  for (const key of Object.keys(raw)) {
    const entry = raw[key];
    const cityId = String(entry?.ID ?? "").trim();
    const cityName = String(entry?.NAME ?? "").trim();
    if (!cityId || !cityName) continue;

    // Prices are already plain DH numbers in Ozon's response (e.g. 35, not
    // "35.00") — dhToCents handles both. A genuinely missing/unparseable
    // price is stored as `null` (see the model's own comment), never 0.
    const deliveredPriceCents = dhToCents(entry?.["DELIVERED-PRICE"]);
    const returnedPriceCents = dhToCents(entry?.["RETURNED-PRICE"]);
    const refusedPriceCents = dhToCents(entry?.["REFUSED-PRICE"]);

    await ProviderCityPricing.updateOne(
      { merchantId, provider: SHIPPING_PROVIDERS.OZON_EXPRESS, cityId },
      {
        $set: {
          cityName,
          deliveredPriceCents,
          returnedPriceCents,
          refusedPriceCents,
          source: "provider_api",
          lastSyncedAt: now,
        },
      },
      { upsert: true }
    );
    synced += 1;
  }

  return { synced };
}
