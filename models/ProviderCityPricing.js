import mongoose from "mongoose";

import { SHIPPING_PROVIDER_VALUES } from "../lib/shipping/providers.js";

const { Schema } = mongoose;

// The sentinel `cityId` for a provider that has no per-city pricing API at
// all (Quick Livraison's `getCityIDs` returns only {city_id, city_name} —
// verified live against the real API; no price fields exist) — one
// merchant-configured FLAT rate applies to every Quick order regardless of
// city. Ozon Express never uses this sentinel: it has real per-city
// pricing (`DELIVERED-PRICE`/`RETURNED-PRICE`/`REFUSED-PRICE` — verified
// live against /api/orders/ozon/cities), synced per real city id.
export const FLAT_RATE_CITY_ID = "_flat";

export const PRICING_SOURCE_VALUES = Object.freeze(["provider_api", "manual"]);

/**
 * One (merchant, provider, city) shipping price entry — the data
 * lib/finance/calculate.js needs to turn "this order shipped via Ozon to
 * Agadir and was delivered" into an actual shipping cost, WITHOUT calling
 * the provider's cities API on every financial calculation (that endpoint
 * is proxied live for order CREATION's city picker — see
 * app/api/orders/ozon/cities/route.js — but Finance needs a stable,
 * queryable local cache instead of one live call per statistics request).
 *
 * `source: "provider_api"` — Ozon: synced from the real
 * DELIVERED-PRICE/RETURNED-PRICE/REFUSED-PRICE fields (see
 * lib/finance/sync-city-pricing.js), one document per real city id,
 * refreshed on demand (`lastSyncedAt`).
 * `source: "manual"` — Quick: no such API exists, so this is the
 * merchant's own entered flat rate, ONE document per (merchant, provider)
 * at `cityId: FLAT_RATE_CITY_ID`.
 */
const providerCityPricingSchema = new Schema(
  {
    merchantId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: [true, "merchantId is required."],
    },
    provider: {
      type: String,
      required: [true, "provider is required."],
      enum: {
        values: [...SHIPPING_PROVIDER_VALUES],
        message: "`{VALUE}` is not a supported shipping provider.",
      },
    },
    // The provider's own city id (matches Order.providerLocationId), or
    // FLAT_RATE_CITY_ID for a provider with no per-city pricing API.
    cityId: {
      type: String,
      required: [true, "cityId is required."],
      trim: true,
    },
    cityName: {
      type: String,
      trim: true,
      default: "",
    },
    // Integer centimes — see lib/finance/money.js. `null` means "this
    // provider/status combination has no known price yet" — never
    // defaulted to 0 (that would silently under-count shipping cost).
    deliveredPriceCents: { type: Number, default: null, min: 0 },
    returnedPriceCents: { type: Number, default: null, min: 0 },
    refusedPriceCents: { type: Number, default: null, min: 0 },
    source: {
      type: String,
      enum: { values: [...PRICING_SOURCE_VALUES], message: "`{VALUE}` is not a valid pricing source." },
      required: [true, "source is required."],
    },
    lastSyncedAt: { type: Date, default: null },
  },
  { timestamps: true }
);

providerCityPricingSchema.index({ merchantId: 1, provider: 1, cityId: 1 }, { unique: true });

const ProviderCityPricing =
  mongoose.models.ProviderCityPricing || mongoose.model("ProviderCityPricing", providerCityPricingSchema);

export default ProviderCityPricing;
