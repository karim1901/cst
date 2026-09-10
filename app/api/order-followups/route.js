import { NextResponse } from "next/server";

import { connectToDatabase } from "@/lib/mongodb";
import { getCurrentUser } from "@/lib/auth/current-user";
import { USER_ROLES } from "@/models/User";
import { SHIPPING_PROVIDER_VALUES } from "@/models/ShippingCompany";
import Order from "@/models/Order";
import OrderFollowUp from "@/models/OrderFollowUp";
import { listFollowUpsForOwner, toFollowUpSummary } from "@/lib/order-followups";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Follow-up — a user's OWN manual reminder list layered on top of Orders,
 * entirely separate from Ozon/Quick shipping tracking (see
 * models/OrderFollowUp.js's module comment).
 *
 * MERCHANT and EMPLOYEE each get their OWN independent list. The owner of a
 * record is `(createdByType, createdById)`, ALWAYS derived here from the
 * server-verified session — never from the request body:
 *   - a merchant  -> { merchantId: self, createdByType: "merchant", createdById: self }
 *   - an employee -> { merchantId: theirMerchant, createdByType: "employee", createdById: self }
 * Every query is scoped by all three, so a merchant never sees an
 * employee's follow-ups (or vice versa), and no one sees another tenant's.
 */
async function resolveFollowUpOwner() {
  const currentUser = await getCurrentUser();
  if (!currentUser) {
    return { error: NextResponse.json({ error: "Authentication required." }, { status: 401 }) };
  }
  if (currentUser.role === USER_ROLES.MERCHANT) {
    return {
      currentUser,
      owner: { merchantId: currentUser.id, createdByType: "merchant", createdById: currentUser.id },
    };
  }
  if (currentUser.role === USER_ROLES.EMPLOYEE) {
    return {
      currentUser,
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

/**
 * Every follow-up item belonging to the authenticated user's OWN list.
 * Optional `?provider=` (validated against SHIPPING_PROVIDER_VALUES;
 * anything else is ignored, not rejected) scopes to one provider's
 * follow-ups only, enforced at the MongoDB query level.
 */
export async function GET(request) {
  const { owner, error } = await resolveFollowUpOwner();
  if (error) return error;

  const requestedProvider = new URL(request.url).searchParams.get("provider");
  const provider = SHIPPING_PROVIDER_VALUES.includes(requestedProvider) ? requestedProvider : null;

  const followUps = await listFollowUpsForOwner(owner, provider);
  return NextResponse.json({ followUps });
}

/**
 * Add one order to the authenticated user's OWN follow-up list, with an
 * optional note.
 *
 * The order is identified by `{provider, trackingNumber}` (the same pair
 * models/Order.js's own unique index treats as an order's canonical
 * identity) and then looked up scoped to what THIS caller is allowed to
 * touch:
 *   - a merchant  -> any order under their own `merchantId`
 *   - an employee -> only orders under their merchant that ALSO belong to
 *                    them (`employeeId: self`) — an employee can only
 *                    follow up an order they are allowed to see, and can
 *                    never probe another employee's tracking numbers.
 * An id/tracking number that isn't such an order 404s exactly like one
 * that doesn't exist, preventing IDOR regardless of what a client sends.
 *
 * Race-safe duplicate prevention: relies on the unique
 * `{merchantId, createdByType, createdById, orderId}` index (see the
 * model) — a losing concurrent request catches the E11000 and returns the
 * WINNING request's record instead of erroring. A merchant record and an
 * employee record for the SAME order do NOT collide (different owner) —
 * intentional.
 */
export async function POST(request) {
  const { currentUser, owner, error } = await resolveFollowUpOwner();
  if (error) return error;

  let body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  const provider = String(body?.provider || "");
  const trackingNumber = String(body?.trackingNumber || "").trim();
  const note = typeof body?.note === "string" ? body.note.trim().slice(0, 2000) : "";

  if (!SHIPPING_PROVIDER_VALUES.includes(provider) || !trackingNumber) {
    return NextResponse.json(
      { error: "A valid provider and tracking number are required." },
      { status: 400 }
    );
  }

  await connectToDatabase();

  const orderFilter = { merchantId: owner.merchantId, provider, trackingNumber };
  if (currentUser.role === USER_ROLES.EMPLOYEE) {
    orderFilter.employeeId = currentUser.id;
  }
  const order = await Order.findOne(orderFilter).select("_id employeeId provider merchantId");

  if (!order) {
    return NextResponse.json(
      {
        error:
          "This order could not be found. If it was just created, please refresh the Orders page and try again.",
      },
      { status: 404 }
    );
  }

  let followUpId;
  try {
    const created = await OrderFollowUp.create({
      merchantId: owner.merchantId,
      orderId: order._id,
      createdByType: owner.createdByType,
      createdById: owner.createdById,
      employeeId: order.employeeId,
      provider: order.provider,
      note,
    });
    followUpId = created._id;
  } catch (err) {
    if (err?.code === 11000) {
      // Already in THIS owner's list (this request or a concurrent one) —
      // use the existing record rather than creating a duplicate.
      const existing = await OrderFollowUp.findOne({
        merchantId: owner.merchantId,
        createdByType: owner.createdByType,
        createdById: owner.createdById,
        orderId: order._id,
      }).select("_id");
      if (!existing) {
        console.error("[POST /api/order-followups] duplicate-key race could not be resolved");
        return NextResponse.json({ error: "Something went wrong. Please try again." }, { status: 500 });
      }
      followUpId = existing._id;
    } else if (err?.name === "ValidationError") {
      return NextResponse.json({ error: "Please correct the highlighted fields." }, { status: 422 });
    } else {
      throw err;
    }
  }

  const doc = await OrderFollowUp.findById(followUpId)
    .populate({
      path: "orderId",
      select: "trackingNumber receiverName phone city address productNature price lastKnownStatus deliveredAt",
    })
    .populate({ path: "employeeId", select: "name" })
    .lean();

  return NextResponse.json({ followUp: toFollowUpSummary(doc) }, { status: 201 });
}
