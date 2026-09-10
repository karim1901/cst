import { NextResponse } from "next/server";

import { connectToDatabase } from "@/lib/mongodb";
import { getCurrentUser } from "@/lib/auth/current-user";
import { USER_ROLES } from "@/models/User";
import OrderFollowUp from "@/models/OrderFollowUp";
import { toFollowUpSummary } from "@/lib/order-followups";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * The owner scope (merchantId + createdByType + createdById) for the
 * authenticated user, all from the server-verified session — identical
 * rule to app/api/order-followups/route.js. Every lookup below is scoped
 * to `{ _id, ...owner }` TOGETHER, so:
 *   - a follow-up id belonging to another user (another employee, or the
 *     merchant) 404s exactly like one that doesn't exist;
 *   - an employee can never edit/delete a merchant's record or another
 *     employee's, and a merchant can never touch an employee's;
 *   - a client-supplied id is the ONLY thing taken from the request, and
 *     it can only ever match this user's own records.
 */
async function resolveFollowUpOwner() {
  const currentUser = await getCurrentUser();
  if (!currentUser) {
    return { error: NextResponse.json({ error: "Authentication required." }, { status: 401 }) };
  }
  if (currentUser.role === USER_ROLES.MERCHANT) {
    return {
      owner: { merchantId: currentUser.id, createdByType: "merchant", createdById: currentUser.id },
    };
  }
  if (currentUser.role === USER_ROLES.EMPLOYEE) {
    return {
      owner: {
        merchantId: currentUser.merchantId,
        createdByType: "employee",
        createdById: currentUser.id,
      },
    };
  }
  return {
    error: NextResponse.json(
      { error: "Only merchants and employees can use follow-up." },
      { status: 403 }
    ),
  };
}

const POPULATE = [
  {
    path: "orderId",
    select: "trackingNumber receiverName phone city address productNature price lastKnownStatus deliveredAt",
  },
  { path: "employeeId", select: "name" },
];

/** Edit a follow-up's note — the note only; the referenced order is never touched. */
export async function PATCH(request, { params }) {
  const { owner, error } = await resolveFollowUpOwner();
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
    { _id: id, ...owner },
    { $set: { note } },
    { new: true }
  )
    .populate(POPULATE)
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
 * `Order` collection. Scoped to this user's own records (see
 * `resolveFollowUpOwner`), so deleting the merchant's copy of an order's
 * follow-up leaves any employee's copy — and the order itself — intact.
 */
export async function DELETE(request, { params }) {
  const { owner, error } = await resolveFollowUpOwner();
  if (error) return error;

  const { id } = await params;
  if (!/^[0-9a-fA-F]{24}$/.test(id)) {
    return NextResponse.json({ error: "Follow-up not found." }, { status: 404 });
  }

  await connectToDatabase();

  const result = await OrderFollowUp.deleteOne({ _id: id, ...owner });
  if (result.deletedCount === 0) {
    return NextResponse.json({ error: "Follow-up not found." }, { status: 404 });
  }

  return NextResponse.json({ ok: true });
}
