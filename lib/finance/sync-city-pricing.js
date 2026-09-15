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
 *
 * `preserveManual` (added for the automatic-daily-sync use case — see
 * lib/ozon/auto-reconcile.js): that same PATCH handler also lets a merchant
 * hand-correct ONE specific Ozon city's price (`source: "manual"`) when
 * they know it differs from what Ozon's API reports. That was always safe
 * as a one-off action a merchant explicitly chose to run again later, but
 * became a real risk once this sync started running automatically, once a
 * day, without anyone asking for it — a manual correction could be silently
 * clobbered back to the provider's value the very next night. When true, a
 * city whose CURRENT stored `source` is `"manual"` is left untouched;
 * every other city (never configured, or already `"provider_api"`) still
 * refreshes normally. The merchant-triggered "Sync now" button keeps the
 * original full-overwrite behavior (`preserveManual` defaults to `false`)
 * — an explicit click is still allowed to intentionally overwrite a manual
 * correction, since that is a deliberate action, not a silent nightly one.
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
 * @param {AbortSignal} [signal]
 * @param {{preserveManual?: boolean}} [options] see module comment.
 * @returns {Promise<{synced: number, preserved: number}>}
 */
export async function syncOzonCityPricing(merchantId, signal, options = {}) {
  const { preserveManual = false } = options;
  const data = await fetchCities(signal);
  const raw = data?.CITIES ?? {};

  const now = new Date();
  let preserved = 0;

  // Only fetched once, up front, when preserveManual is requested — a
  // single indexed query for this merchant's manually-sourced city rows,
  // never a per-city lookup (no N+1 here).
  const manualCityIds = preserveManual
    ? new Set(
        (
          await ProviderCityPricing.find({
            merchantId,
            provider: SHIPPING_PROVIDERS.OZON_EXPRESS,
            source: "manual",
          })
            .select("cityId")
            .lean()
        ).map((doc) => doc.cityId)
      )
    : null;

  // PERFORMANCE (measured live: Ozon's real `/cities` response has 800+
  // entries — one `updateOne` per city, awaited sequentially, was the
  // single largest contributor to this daily job's real measured runtime.
  // A real Ozon city list changes rarely and arrives as one response
  // already, so there is no reason to write it one round-trip at a time —
  // batched into ONE `bulkWrite` instead, same upsert semantics, same
  // per-document filter/update shape, just issued together.
  const ops = [];
  for (const key of Object.keys(raw)) {
    const entry = raw[key];
    const cityId = String(entry?.ID ?? "").trim();
    const cityName = String(entry?.NAME ?? "").trim();
    if (!cityId || !cityName) continue;

    if (manualCityIds?.has(cityId)) {
      preserved += 1;
      continue;
    }

    // Prices are already plain DH numbers in Ozon's response (e.g. 35, not
    // "35.00") — dhToCents handles both. A genuinely missing/unparseable
    // price is stored as `null` (see the model's own comment), never 0.
    ops.push({
      updateOne: {
        filter: { merchantId, provider: SHIPPING_PROVIDERS.OZON_EXPRESS, cityId },
        update: {
          $set: {
            cityName,
            deliveredPriceCents: dhToCents(entry?.["DELIVERED-PRICE"]),
            returnedPriceCents: dhToCents(entry?.["RETURNED-PRICE"]),
            refusedPriceCents: dhToCents(entry?.["REFUSED-PRICE"]),
            source: "provider_api",
            lastSyncedAt: now,
          },
        },
        upsert: true,
      },
    });
  }

  if (ops.length > 0) {
    // `ordered: false` — one malformed entry must never abort every other
    // city's otherwise-valid upsert; each operation is independent.
    await ProviderCityPricing.bulkWrite(ops, { ordered: false });
  }

  return { synced: ops.length, preserved };
}
