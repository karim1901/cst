import { NextResponse } from "next/server";

import { connectToDatabase } from "@/lib/mongodb";
import { getCurrentUser } from "@/lib/auth/current-user";
import { USER_ROLES } from "@/models/User";
import OrderFollowUp from "@/models/OrderFollowUp";
import { toFollowUpSummary } from "@/lib/order-followups";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function requireMerchant() {
  const currentUser = await getCurrentUser();
  if (!currentUser) {
    return { error: NextResponse.json({ error: "Authentication required." }, { status: 401 }) };
  }
  if (currentUser.role !== USER_ROLES.MERCHANT) {
    return {
      error: NextResponse.json({ error: "Only merchants can use follow-up." }, { status: 403 }),
    };
  }
  return { currentUser };
}

/**
 * Both handlers below scope every lookup to `{_id, merchantId:
 * currentUser.id}` together — a follow-up id belonging to another merchant
 * 404s exactly like one that doesn't exist, never revealing which case it
 * is, and never trusting a client-supplied merchantId for anything.
 */

/** Edit a follow-up's note — the note only; the referenced order is never touched. */
export async function PATCH(request, { params }) {
  const { currentUser, error } = await requireMerchant();
  if (error) return error;

  const { id } = await params;
  if (!/^[0-9a-fA-F]{24}$/.test(id)) {
    return NextResponse.json({ error: "Follow-up not found." }, { status: 404 });
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  if (typeof body?.note !== "string") {
    return NextResponse.json({ error: "A note is required." }, { status: 400 });
  }
  const note = body.note.trim().slice(0, 2000);

  await connectToDatabase();

  const followUp = await OrderFollowUp.findOneAndUpdate(
    { _id: id, merchantId: currentUser.id },
    { $set: { note } },
    { new: true }
  )
    .populate({
      path: "orderId",
      select: "trackingNumber receiverName phone city address productNature price lastKnownStatus deliveredAt",
    })
    .populate({ path: "employeeId", select: "name" })
    .lean();

  if (!followUp) {
    return NextResponse.json({ error: "Follow-up not found." }, { status: 404 });
  }

  return NextResponse.json({ followUp: toFollowUpSummary(followUp) });
}

/**
 * Remove a follow-up record ONLY — never the Order it references, its
 * status, tracking data, employee, or commission information. This is a
 * `deleteOne` on `OrderFollowUp` exclusively; nothing here ever touches the
 * `Order` collection.
 */
export async function DELETE(request, { params }) {
  const { currentUser, error } = await requireMerchant();
  if (error) return error;

  const { id } = await params;
  if (!/^[0-9a-fA-F]{24}$/.test(id)) {
    return NextResponse.json({ error: "Follow-up not found." }, { status: 404 });
  }

  await connectToDatabase();

  const result = await OrderFollowUp.deleteOne({ _id: id, merchantId: currentUser.id });
  if (result.deletedCount === 0) {
    return NextResponse.json({ error: "Follow-up not found." }, { status: 404 });
  }

  return NextResponse.json({ ok: true });
}
