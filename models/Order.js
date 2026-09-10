import mongoose from "mongoose";

import { SHIPPING_PROVIDER_VALUES } from "./ShippingCompany.js";
import { USER_ROLE_VALUES, USER_ROLES } from "./User.js";
import { RETURN_VALIDATION_STATUS_VALUES } from "../lib/returns/constants.js";

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

    // Where `price` came from — so an incomplete provider response can never
    // silently overwrite a real amount, and so "price is 0 because we don't
    // know it" is distinguishable from "price is genuinely 0".
    //
    //  - "order_creation" : entered by the user at creation
    //                       (app/api/orders/{quick,ozon}) — the canonical,
    //                       trustworthy source. NEVER overwritten by sync.
    //  - "provider_sync"  : recovered from a provider response that actually
    //                       carried an amount (Ozon's fetch does; Quick's
    //                       getParcelDetails does NOT — verified live).
    //  - "manual"         : set by a maintenance/repair script.
    //  - "unknown"        : no trustworthy amount available (a Quick parcel
    //                       discovered by historical sync — Quick's API
    //                       exposes no amount for it). `price` is stored as
    //                       0 as a placeholder; lib/commission/calculate.js
    //                       counts it as 0 commission units, never 1.
    //
    // Historical/legacy rows created before this field existed have it
    // unset; readers treat `unset + price > 0` as trustworthy (see
    // lib/quick/amount.js#resolveSyncedQuickPrice), and the one-off
    // scripts/repair-quick-order-prices.mjs backfills it explicitly.
    priceSource: {
      type: String,
      enum: ["order_creation", "provider_sync", "manual", "unknown"],
    },

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

    // ---- Returns management (app/dashboard/returns) -------------------
    // The MERCHANT's own internal "did I physically get this package back?"
    // confirmation — completely independent from `lastKnownStatus` above.
    // The shipping provider reporting "Retourné"/"Refusé"/"Annulé" only
    // means the shipment is returning/returned/refused/cancelled at the
    // PROVIDER; it does NOT mean the merchant has the physical package in
    // hand. Every order — new or pre-existing — defaults to "pending";
    // nothing ever sets this to "validated" automatically (see
    // app/api/returns/[id]/validate/route.js, the only writer of these 3
    // fields, and lib/returns/sync.js, which explicitly never touches
    // them).
    returnValidationStatus: {
      type: String,
      enum: {
        values: [...RETURN_VALIDATION_STATUS_VALUES],
        message: "`{VALUE}` is not a valid return validation status.",
      },
      default: "pending",
    },
    // When the merchant clicked "Validate Return" (null while pending, or
    // after "Mark as Pending" reverts it — see the unvalidate route).
    returnValidatedAt: { type: Date, default: null },
    // Who validated it — audit info per the feature's own requirement.
    returnValidatedBy: {
      type: Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
  },
  { timestamps: true }
);

orderSchema.index({ merchantId: 1, createdAt: -1 });
orderSchema.index({ employeeId: 1, createdAt: -1 });
// A tracking number is unique per provider (not globally — two different
// providers could coincidentally format one the same way).
orderSchema.index({ provider: 1, trackingNumber: 1 }, { unique: true });
// Orders-page server-side search (app/api/orders/search/route.js): within
// ONE merchant + ONE provider, look an order up by an anchored
// tracking-number prefix (exact "user202609011014" or partial
// "user20260901") or by phone. Both are highly selective inside a single
// merchant+provider; the employee-scoped variant of each query adds
// `employeeId` as a residual match on the already-tiny result, so a
// separate {merchantId, provider, employeeId, …} index is not warranted.
orderSchema.index({ merchantId: 1, provider: 1, trackingNumber: 1 });
orderSchema.index({ merchantId: 1, provider: 1, phone: 1 });
// Dashboard statistics (lib/orders/dashboard-stats.js#
// computeOrderDeliveryStats, via app/api/dashboard/stats): this merchant's
// orders for ONE provider whose tracking-number month matches the selected
// period — an anchored `numericTrackingNumber` prefix, the same month rule
// Commission/Finance already use. The employee-scoped variant adds
// `employeeId` as a residual match on the already-small per-month result.
orderSchema.index({ merchantId: 1, provider: 1, numericTrackingNumber: 1 });
// Commission calculation's own access pattern — see lib/commission/report.js:
// "this employee's orders whose tracking number encodes the selected month
// (an anchored regex on `numericTrackingNumber`, which this index serves)
// AND were ever delivered (`deliveredAt` not null)".
orderSchema.index({ employeeId: 1, numericTrackingNumber: 1 });
orderSchema.index({ employeeId: 1, deliveredAt: 1 });
orderSchema.index({ merchantId: 1, deliveredAt: 1 });
// The order-lifecycle page's Delivered section (lib/returns/list.js), which
// combines an optional employee filter with an optional delivery-date
// range — serves both together, not just `merchantId` alone.
orderSchema.index({ merchantId: 1, employeeId: 1, deliveredAt: -1 });
// The Returns page's own access pattern (lib/returns/list.js): this
// merchant's cancelled/refused/returned orders, optionally narrowed by
// internal validation state, newest first. Declares the same
// case/accent-insensitive collation that module's queries use on
// `lastKnownStatus` so Mongo can actually use this index for that filter,
// not just for `merchantId`/`returnValidationStatus`.
orderSchema.index(
  { merchantId: 1, returnValidationStatus: 1, lastKnownStatus: 1, createdAt: -1 },
  { collation: { locale: "en", strength: 1 } }
);

/**
 * Guard against "OverwriteModelError" when the module is re-evaluated during
 * development hot reloads.
 */
const Order = mongoose.models.Order || mongoose.model("Order", orderSchema);

export default Order;
