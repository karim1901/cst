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

/** Every follow-up belonging to one merchant, newest first. Server-side only. */
export async function listFollowUpsForMerchant(merchantId) {
  await connectToDatabase();
  const docs = await OrderFollowUp.find({ merchantId })
    .sort({ createdAt: -1 })
    .populate({ path: "orderId", select: ORDER_POPULATE_FIELDS })
    .populate({ path: "employeeId", select: "name" })
    .lean();
  return docs.map(toFollowUpSummary);
}
