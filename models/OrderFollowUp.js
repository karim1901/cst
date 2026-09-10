import mongoose from "mongoose";

import { SHIPPING_PROVIDER_VALUES } from "../lib/shipping/providers.js";

const { Schema } = mongoose;

/**
 * Follow-up — a user's OWN personal/business reminder list, layered on top
 * of Orders. NOT shipping-company tracking (Ozon/Quick tracking numbers and
 * their status sync are untouched — see models/Order.js and
 * lib/commission/sync-status.js) — this is "I want to remember to call this
 * customer back", independent of the order's actual delivery status. Named
 * `OrderFollowUp` deliberately, not `Tracking`, to never be confused with
 * that.
 *
 * PER-USER, NOT MERCHANT-WIDE. A merchant and each of their employees keep
 * SEPARATE, INDEPENDENT follow-up lists — the owner is `(createdByType,
 * createdById)`:
 *   - "merchant" + the merchant's own user id, or
 *   - "employee" + that employee's user id.
 * `merchantId` is still stored (it scopes every query and is the tenant
 * boundary), but it is NOT the owner: the same order can legitimately be in
 * the merchant's list AND in an employee's list at the same time, as two
 * independent records. Deleting one never touches the other.
 *
 * The Order it references stays the sole source of truth for order
 * information (customer, price, status, ...) — this record does NOT copy
 * that data. Every read joins back to the live Order (see
 * app/api/order-followups/route.js). Only true foreign keys are kept
 * directly here; `employeeId`/`provider` are copied from the order at
 * creation time so a list can be scoped/filtered/displayed without a
 * second populate — they are references, not a duplicated order.
 */
const orderFollowUpSchema = new Schema(
  {
    // Tenant boundary — the merchant this order (and therefore this
    // follow-up) belongs to. For a merchant-owned record this equals
    // `createdById`; for an employee-owned one it is the employee's
    // owning merchant. Scopes every query; never the OWNER on its own.
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

    // WHO owns this follow-up record — the scope it belongs to.
    //   "merchant" -> `createdById` is the merchant's user id
    //   "employee" -> `createdById` is that one employee's user id
    // A merchant never sees "employee" records; an employee only ever sees
    // their own ("employee" + their own id). Derived server-side from the
    // authenticated session, NEVER from the request body.
    createdByType: {
      type: String,
      required: [true, "createdByType is required."],
      enum: {
        values: ["merchant", "employee"],
        message: "`{VALUE}` is not a valid follow-up owner type.",
      },
    },
    createdById: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: [true, "createdById is required."],
    },

    // Copied from the order at creation time — the employee who created the
    // ORDER (or null for a merchant-created order). Kept for
    // scoping/display; distinct from `createdById` (who created this
    // FOLLOW-UP). Never re-derived on read since it never changes.
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

// One follow-up per (owner, order) — the duplicate-prevention rule, at the
// database level so even a race between two concurrent "add to follow-up"
// requests can't create two. The owner is (createdByType, createdById), so
// a merchant record and an employee record for the SAME order coexist
// (different owner) — intentional. `merchantId` leads the key for tenant
// locality.
orderFollowUpSchema.index(
  { merchantId: 1, createdByType: 1, createdById: 1, orderId: 1 },
  { unique: true }
);
// The Follow-up page's own listing access pattern: one owner's items,
// newest first.
orderFollowUpSchema.index({ merchantId: 1, createdByType: 1, createdById: 1, createdAt: -1 });

/**
 * Guard against "OverwriteModelError" when the module is re-evaluated during
 * development hot reloads.
 */
const OrderFollowUp =
  mongoose.models.OrderFollowUp || mongoose.model("OrderFollowUp", orderFollowUpSchema);

export default OrderFollowUp;
