import mongoose from "mongoose";

import { SHIPPING_PROVIDER_VALUES } from "../lib/shipping/providers.js";

const { Schema } = mongoose;

// A daily advertising-spend entry can be scoped to one provider or to "all"
// (spend not attributable to a single provider — e.g. a shared brand
// campaign) — see lib/finance/calculate.js#resolveDailyAdSpend for the
// documented, non-duplicating allocation rule an "all"-scoped entry is
// split by when a provider-specific view is requested.
export const AD_SCOPE_VALUES = Object.freeze(["all", ...SHIPPING_PROVIDER_VALUES]);

/**
 * One merchant's manually-entered daily advertising spend — the only input
 * this app cannot derive from a provider API (Ozon/Quick have no concept of
 * "how much you spent on ads"). Read by
 * lib/finance/calculate.js#resolveDailyAdSpend, the ONE place that turns
 * this into a per-order/per-day/per-month advertising cost — see that
 * module's own comment for the full allocation rule (never double-counted).
 *
 * One entry per (merchantId, provider, date) — re-saving the same day
 * updates the existing entry rather than creating a second, ambiguous one
 * for that day (enforced by the unique index below, and by
 * app/api/finance/advertising/route.js's upsert-by-date behavior).
 */
const advertisingExpenseSchema = new Schema(
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
        values: [...AD_SCOPE_VALUES],
        message: "`{VALUE}` is not a valid advertising scope.",
      },
      default: "all",
    },
    // "YYYY-MM-DD" — a plain calendar date, deliberately a string (not a
    // Date) so "which day" is never ambiguous across timezones; matches the
    // same local-date convention already used for delivery-date filtering
    // (see lib/returns/delivery-date.js).
    date: {
      type: String,
      required: [true, "date is required."],
      match: [/^\d{4}-\d{2}-\d{2}$/, "date must be in YYYY-MM-DD format."],
    },
    // Stored in centimes (integer) to avoid floating-point rounding error
    // in a financial system — see lib/finance/money.js, the one place that
    // converts to/from the DH amount a human enters/sees. Never store a raw
    // float DH amount directly.
    amountCents: {
      type: Number,
      required: [true, "amountCents is required."],
      min: [0, "amountCents must be 0 or greater."],
    },
  },
  { timestamps: true }
);

advertisingExpenseSchema.index({ merchantId: 1, provider: 1, date: 1 }, { unique: true });
advertisingExpenseSchema.index({ merchantId: 1, date: -1 });

const AdvertisingExpense =
  mongoose.models.AdvertisingExpense || mongoose.model("AdvertisingExpense", advertisingExpenseSchema);

export default AdvertisingExpense;
