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
 * "Mark as Pending" — reverses a validated return back to pending (this
 * app's chosen, safest default for reversibility: a merchant can correct an
 * accidental validation). Same scope/security rules as
 * app/api/returns/[id]/validate/route.js — only the 3 internal fields
 * change, `returnValidatedAt`/`returnValidatedBy` are cleared (not kept as
 * history), the shipping provider status is never touched.
 */
export async function POST(request, { params }) {
  const currentUser = await getCurrentUser();
  if (!currentUser) {
    return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  }
  if (currentUser.role !== USER_ROLES.MERCHANT) {
    return NextResponse.json({ error: "Only merchants can update returns." }, { status: 403 });
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
        returnValidationStatus: RETURN_VALIDATION_STATUSES.PENDING,
        returnValidatedAt: null,
        returnValidatedBy: null,
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
