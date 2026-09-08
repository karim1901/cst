import mongoose from "mongoose";

import { SHIPPING_PROVIDER_VALUES } from "../lib/shipping/providers.js";

const { Schema } = mongoose;

/**
 * Follow-up — a merchant's own personal/business reminder list,
 * layered on top of Orders. NOT shipping-company tracking (Ozon/Quick
 * tracking numbers and their status sync are untouched — see models/Order.js
 * and lib/commission/sync-status.js) — this is "the merchant wants to
 * remember to call this customer back", independent of the order's actual
 * delivery status. Named `OrderFollowUp` deliberately, not `Tracking`, to
 * never be confused with that.
 *
 * The Order it references stays the sole source of truth for order
 * information (customer, price, status, ...) — this record does NOT copy
 * that data. Orders in this app are immutable once created and never
 * deleted, so there is no resilience reason to snapshot descriptive fields
 * here; every read joins back to the live Order (see
 * app/api/order-followups/route.js). Only true foreign keys are kept
 * directly on this document — `employeeId`/`provider` are copied from the
 * order at creation time so the merchant's own follow-up list can be
 * scoped/filtered without a populate, exactly the "at minimum" fields the
 * feature spec asked for; they are references, not a duplicated order.
 */
const orderFollowUpSchema = new Schema(
  {
    merchantId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: [true, "merchantId is required."],
    },

    orderId: {
      type: Schema.Types.ObjectId,
      ref: "Order",
      required: [true, "orderId is required."],
    },

    // Copied from the order at creation time — the employee who created it
    // (or null for a merchant-created order). Not re-derived on every read
    // since it never changes once an order exists.
    employeeId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },

    provider: {
      type: String,
      required: [true, "provider is required."],
      enum: {
        values: [...SHIPPING_PROVIDER_VALUES],
        message: "`{VALUE}` is not a supported shipping provider.",
      },
    },

    // Free text — "the customer said they'll contact the courier", etc.
    // Never predefined/limited to fixed options. Separate from (and never
    // written back to) the order's own `note` field.
    note: {
      type: String,
      trim: true,
      default: "",
      maxlength: [2000, "Note must be at most 2000 characters long."],
    },
  },
  { timestamps: true }
);

// One follow-up per (merchant, order) — the duplicate-prevention rule the
// feature spec requires, enforced at the database level so even a race
// between two concurrent "add to follow-up" requests can't create two.
orderFollowUpSchema.index({ merchantId: 1, orderId: 1 }, { unique: true });
// The Follow-up page's own listing access pattern: this merchant's items,
// newest first.
orderFollowUpSchema.index({ merchantId: 1, createdAt: -1 });

/**
 * Guard against "OverwriteModelError" when the module is re-evaluated during
 * development hot reloads.
 */
const OrderFollowUp =
  mongoose.models.OrderFollowUp || mongoose.model("OrderFollowUp", orderFollowUpSchema);

export default OrderFollowUp;
