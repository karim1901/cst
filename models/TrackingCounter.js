import mongoose from "mongoose";

import { SHIPPING_PROVIDER_VALUES } from "./ShippingCompany.js";

const { Schema } = mongoose;

/**
 * The monthly tracking-number counter for one (owner, provider, period).
 *
 * `owner` is a merchant or an employee (see lib/tracking/counter.js —
 * whoever `lib/tracking/reserve-counter.js` reserves a number for). Each
 * owner has a COMPLETELY INDEPENDENT counter per shipping provider, and a
 * fresh one every calendar month — this is the whole point of this model
 * existing separately from a single scalar field: `models/User.js` used to
 * hold one continuous, never-resetting counter per provider
 * (`ozonTrackingCounter` / `quickTrackingCounter`, still there, now
 * dormant/historical — see its comment) before the monthly-reset business
 * rule was introduced. Those old fields are deliberately left untouched
 * (existing counters/orders are never migrated or reset).
 *
 * `counter` holds the LATEST successfully used number for this
 * (owner, provider, period) — NOT the next-unused one (a deliberate
 * convention flip from the old per-provider field): the very first order of
 * a month uses 1000, and the document is only created once that first
 * order actually succeeds. Reading "no document" therefore means
 * "no orders yet this month" — see lib/tracking/reserve-counter.js.
 */
const trackingCounterSchema = new Schema(
  {
    ownerId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: [true, "ownerId is required."],
    },

    provider: {
      type: String,
      required: [true, "provider is required."],
      enum: {
        values: [...SHIPPING_PROVIDER_VALUES],
        message: "`{VALUE}` is not a supported shipping provider.",
      },
    },

    // "YYYYMM", e.g. "202608". Deliberately includes the year (the task's
    // own illustrative pseudo-code only showed "month": "08", which would
    // collide August 2026 with August 2027) — this is the one deliberate
    // adaptation from the literal spec, made specifically so the required
    // December -> January (and any year) rollover is unambiguous.
    period: {
      type: String,
      required: [true, "period is required."],
      match: [/^\d{6}$/, "period must be in YYYYMM form."],
    },

    // The latest successfully-used counter this (owner, provider, period)
    // has reached. Always >= 1000 (the fixed monthly boundary/floor).
    counter: {
      type: Number,
      required: [true, "counter is required."],
      min: [1000, "counter cannot be below the monthly boundary (1000)."],
    },
  },
  { timestamps: true }
);

// Exactly one counter document per (owner, provider, period) — the whole
// concurrency-safety story (lib/tracking/reserve-counter.js) depends on
// this being enforced at the database level, not just in application code.
trackingCounterSchema.index({ ownerId: 1, provider: 1, period: 1 }, { unique: true });

/**
 * Guard against "OverwriteModelError" when the module is re-evaluated during
 * development hot reloads.
 */
const TrackingCounter =
  mongoose.models.TrackingCounter || mongoose.model("TrackingCounter", trackingCounterSchema);

export default TrackingCounter;
