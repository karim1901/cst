import { NextResponse } from "next/server";

import { connectToDatabase } from "@/lib/mongodb";
import { getCurrentUser } from "@/lib/auth/current-user";
import { USER_ROLES } from "@/models/User";
import Order from "@/models/Order";
import { toReturnSummary } from "@/lib/returns/list";
import { RETURN_VALIDATION_STATUSES } from "@/lib/returns/constants";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * "Validate Return" — the merchant confirming they physically received a
 * returned/cancelled/refused package back. Deliberately independent of the
 * shipping provider's own status (see models/Order.js's
 * `returnValidationStatus` comment): this write touches ONLY
 * `returnValidationStatus`/`returnValidatedAt`/`returnValidatedBy`, never
 * `lastKnownStatus`, `trackingNumber`, `price`, `employeeId`, or anything
 * else about the order — commission, tracking numbers and provider data are
 * completely untouched by this route.
 *
 * Merchant-only + ownership-scoped: the `{_id, merchantId: currentUser.id}`
 * filter means an order id belonging to another merchant 404s exactly like
 * one that doesn't exist, never revealing which case it is — same IDOR-safe
 * pattern as app/api/order-followups/[id]/route.js.
 */
export async function POST(request, { params }) {
  const currentUser = await getCurrentUser();
  if (!currentUser) {
    return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  }
  if (currentUser.role !== USER_ROLES.MERCHANT) {
    return NextResponse.json({ error: "Only merchants can validate returns." }, { status: 403 });
  }

  const { id } = await params;
  if (!/^[0-9a-fA-F]{24}$/.test(id)) {
    return NextResponse.json({ error: "Order not found." }, { status: 404 });
  }

  await connectToDatabase();

  const order = await Order.findOneAndUpdate(
    { _id: id, merchantId: currentUser.id },
    {
      $set: {
        returnValidationStatus: RETURN_VALIDATION_STATUSES.VALIDATED,
        returnValidatedAt: new Date(),
        returnValidatedBy: currentUser.id,
      },
    },
    { new: true }
  )
    .populate({ path: "employeeId", select: "name" })
    .populate({ path: "returnValidatedBy", select: "name" })
    .lean();

  if (!order) {
    return NextResponse.json({ error: "Order not found." }, { status: 404 });
  }

  return NextResponse.json({ order: toReturnSummary(order) });
}
