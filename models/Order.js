import mongoose from "mongoose";

import { SHIPPING_PROVIDER_VALUES } from "./ShippingCompany.js";
import { USER_ROLE_VALUES, USER_ROLES } from "./User.js";

const { Schema } = mongoose;

/**
 * Local mirror of an order created through a shipping provider (currently
 * only Ozon Express — see app/api/orders/ozon/route.js). This is NOT the
 * source of truth for an order's live status: the provider's own API always
 * is (that is why the Orders list re-fetches tracking/parcel-info from Ozon
 * live rather than reading it back from here — see lib/ozon/fetch-orders.js).
 * This collection exists only for local audit/history (who created what,
 * when, for which merchant) and is written ONCE, only after the provider
 * confirms the order was created successfully — never on a failed attempt,
 * so it can never show an order that does not actually exist at the
 * provider.
 */
const orderSchema = new Schema(
  {
    merchantId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: [true, "merchantId is required."],
    },

    // The employee who created the order, or null when the merchant created
    // it directly (a merchant is not an employee and has no merchantId of
    // its own to record here).
    employeeId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },

    createdByRole: {
      type: String,
      required: [true, "createdByRole is required."],
      enum: {
        values: [...USER_ROLE_VALUES].filter((role) => role !== USER_ROLES.SUPER_ADMIN),
        message: "`{VALUE}` cannot create orders.",
      },
    },

    provider: {
      type: String,
      required: [true, "provider is required."],
      enum: {
        values: [...SHIPPING_PROVIDER_VALUES],
        message: "`{VALUE}` is not a supported shipping provider.",
      },
    },

    // Full provider tracking number, e.g. "oussama202608011200"
    // (prefix + period "202608" + fixed "01" + counter "1200").
    trackingNumber: {
      type: String,
      required: [true, "trackingNumber is required."],
      trim: true,
    },

    // Everything after the prefix (period + "01" + counter), e.g.
    // "202608011200" — kept alongside the full tracking number since the
    // prefix (username/derived merchant prefix) is not itself unique forever
    // (a username could theoretically be freed and reused) while this pair
    // always is.
    numericTrackingNumber: {
      type: String,
      required: [true, "numericTrackingNumber is required."],
      trim: true,
    },

    receiverName: { type: String, required: [true, "receiverName is required."], trim: true },
    phone: { type: String, required: [true, "phone is required."], trim: true },
    city: { type: String, required: [true, "city is required."], trim: true },
    address: { type: String, required: [true, "address is required."], trim: true },
    productNature: { type: String, required: [true, "productNature is required."], trim: true },
    price: { type: Number, required: [true, "price is required."], min: 0 },

    // Quick Livraison-only fields — optional/unset for Ozon Express orders.
    // Kept on the shared model rather than a second one (see the module
    // comment) since every other field already applies to both providers.
    quantity: { type: Number, min: 1 },
    note: { type: String, trim: true },
    // The provider's own district/city identifier actually sent on creation
    // (Quick's `district_id`, Ozon's numeric city id) — kept for audit since
    // `city` above stores the human-readable name shown in the UI.
    providerLocationId: { type: String, trim: true },

    // The provider's own RESULT for this creation call ("SUCCESS" or similar
    // — we only ever persist when it was not "ERROR"). Kept verbatim, not
    // reinterpreted, for audit purposes.
    providerResult: { type: String },

    // Best-effort cache of the last *live* status successfully read back
    // from the provider (see app/api/orders/quick/route.js's GET handler,
    // and lib/commission/sync-status.js which now also feeds this for Ozon).
    // Mongo is the source of truth for customer/order info, but never for
    // status — this field exists only as a fallback to show SOMETHING when
    // the provider is temporarily unreachable, not as an authoritative value
    // to trust over a fresh call.
    lastKnownStatus: { type: String, default: null },

    // The moment this order was FIRST observed as delivered ("Livré" at
    // Ozon, "DELIVERED" at Quick — see lib/commission/status.js), set once,
    // opportunistically, by lib/commission/sync-status.js whenever a status
    // check happens to run across it (an Orders-list page view, currently —
    // see app/api/orders/{ozon,quick}/route.js's GET handlers). Never
    // overwritten once set, even if a later read somehow reports a different
    // status — a delivery is a fact, not a live value like `lastKnownStatus`.
    // Used by the commission system (lib/commission/*) ONLY to decide
    // whether an order counts at all (delivered vs. not) — NOT to decide
    // which month it counts toward. That's `numericTrackingNumber`'s job
    // (its leading "YYYYMM" — see lib/commission/resolve-commission-period.js
    // and the README's "Commission" section): an order tracking-numbered
    // for August that happens to be delivered in September still belongs to
    // AUGUST's commission.
    deliveredAt: { type: Date, default: null },
  },
  { timestamps: true }
);

orderSchema.index({ merchantId: 1, createdAt: -1 });
orderSchema.index({ employeeId: 1, createdAt: -1 });
// A tracking number is unique per provider (not globally — two different
// providers could coincidentally format one the same way).
orderSchema.index({ provider: 1, trackingNumber: 1 }, { unique: true });
// Commission calculation's own access pattern — see lib/commission/report.js:
// "this employee's orders whose tracking number encodes the selected month
// (an anchored regex on `numericTrackingNumber`, which this index serves)
// AND were ever delivered (`deliveredAt` not null)".
orderSchema.index({ employeeId: 1, numericTrackingNumber: 1 });
orderSchema.index({ employeeId: 1, deliveredAt: 1 });
orderSchema.index({ merchantId: 1, deliveredAt: 1 });

/**
 * Guard against "OverwriteModelError" when the module is re-evaluated during
 * development hot reloads.
 */
const Order = mongoose.models.Order || mongoose.model("Order", orderSchema);

export default Order;
