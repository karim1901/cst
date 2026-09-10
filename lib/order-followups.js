import { connectToDatabase } from "@/lib/mongodb";
import OrderFollowUp from "@/models/OrderFollowUp";

/**
 * Shape returned for one Follow-up item — used by both
 * GET /api/order-followups and the create/update routes' responses.
 * `order` is populated live from the referenced Order document (the sole
 * source of truth for order info — see models/OrderFollowUp.js's module
 * comment); this never stores or re-derives those fields itself.
 */
export function toFollowUpSummary(doc) {
  const order = doc.orderId; // populated Order document (or null if somehow missing)
  return {
    id: String(doc._id),
    note: doc.note ?? "",
    provider: doc.provider,
    // Who owns this record — a merchant's list vs. one employee's list.
    ownerType: doc.createdByType ?? null,
    employee: doc.employeeId
      ? { id: String(doc.employeeId._id ?? doc.employeeId), name: doc.employeeId.name ?? null }
      : null,
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
    order: order
      ? {
          id: String(order._id),
          trackingNumber: order.trackingNumber,
          receiverName: order.receiverName,
          phone: order.phone,
          city: order.city,
          address: order.address,
          productNature: order.productNature,
          price: order.price,
          status: order.lastKnownStatus,
          deliveredAt: order.deliveredAt,
        }
      : null,
  };
}

const ORDER_POPULATE_FIELDS =
  "trackingNumber receiverName phone city address productNature price lastKnownStatus deliveredAt";

/**
 * Every follow-up belonging to ONE owner, newest first. Server-side only.
 *
 * `owner` is `{ merchantId, createdByType, createdById }` — all three
 * derived from the authenticated session by the caller
 * (app/api/order-followups/*), NEVER from the request. A merchant passes
 * `{ merchantId: self, createdByType: "merchant", createdById: self }`; an
 * employee passes `{ merchantId: theirMerchant, createdByType: "employee",
 * createdById: self }`. The query is scoped by all three, so a merchant
 * can never see an employee's records and vice versa, and no one sees
 * another tenant's.
 *
 * `provider` (optional — "ozon_express" | "quick_livraison") narrows to one
 * provider's follow-ups, enforced here at the MongoDB query level (never a
 * frontend-only filter); omitted means every provider.
 */
export async function listFollowUpsForOwner({ merchantId, createdByType, createdById }, provider = null) {
  await connectToDatabase();
  const filter = { merchantId, createdByType, createdById };
  if (provider) filter.provider = provider;
  const docs = await OrderFollowUp.find(filter)
    .sort({ createdAt: -1 })
    .populate({ path: "orderId", select: ORDER_POPULATE_FIELDS })
    .populate({ path: "employeeId", select: "name" })
    .lean();
  return docs.map(toFollowUpSummary);
}
