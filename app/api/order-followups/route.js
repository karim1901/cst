import { NextResponse } from "next/server";

import { connectToDatabase } from "@/lib/mongodb";
import { getCurrentUser } from "@/lib/auth/current-user";
import { USER_ROLES } from "@/models/User";
import { SHIPPING_PROVIDER_VALUES } from "@/models/ShippingCompany";
import Order from "@/models/Order";
import OrderFollowUp from "@/models/OrderFollowUp";
import { listFollowUpsForMerchant, toFollowUpSummary } from "@/lib/order-followups";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Follow-up — a merchant's own manual reminder list layered on top
 * of Orders, entirely separate from Ozon/Quick shipping tracking (see
 * models/OrderFollowUp.js's module comment). Merchant-only end to end: the
 * whole feature request describes this from the merchant's perspective
 * throughout, and explicitly warns employees must not automatically gain
 * access — the safe, spec-consistent default is that employees don't see
 * or use this feature at all, not just the list page.
 */
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

/** Every follow-up item belonging to the authenticated merchant. */
export async function GET() {
  const { currentUser, error } = await requireMerchant();
  if (error) return error;

  const followUps = await listFollowUpsForMerchant(currentUser.id);
  return NextResponse.json({ followUps });
}

/**
 * Add one order to the merchant's follow-up list, with an optional note.
 *
 * Identifies the order by `{provider, trackingNumber}` — the same pair
 * `models/Order.js`'s own unique index already treats as an order's
 * canonical identity — rather than a raw database id, so this works
 * uniformly from every Orders-page card regardless of which of the three
 * listing surfaces rendered it (the live Ozon/Quick streams don't
 * necessarily carry this app's internal Order `_id` on each item; every
 * card DOES always know its own tracking number). The order is then looked
 * up scoped to `merchantId: currentUser.id` — an id/tracking number that
 * isn't a real, owned order 404s exactly like one that doesn't exist,
 * preventing IDOR regardless of what a client sends.
 *
 * Race-safe duplicate prevention: relies on the unique
 * `{merchantId, orderId}` index (see the model) — a losing concurrent
 * request catches the resulting E11000 and returns the WINNING request's
 * record instead of erroring, per the feature's own "use the existing
 * record" rule.
 */
export async function POST(request) {
  const { currentUser, error } = await requireMerchant();
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

  const order = await Order.findOne({
    merchantId: currentUser.id,
    provider,
    trackingNumber,
  }).select("_id employeeId provider");

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
      merchantId: currentUser.id,
      orderId: order._id,
      employeeId: order.employeeId,
      provider: order.provider,
      note,
    });
    followUpId = created._id;
  } catch (err) {
    if (err?.code === 11000) {
      // Already followed up (this request or a concurrent one) — use the
      // existing record rather than creating a duplicate or erroring.
      const existing = await OrderFollowUp.findOne({
        merchantId: currentUser.id,
        orderId: order._id,
      }).select("_id");
      if (!existing) {
        // Vanishingly unlikely (deleted between the failed insert and this
        // lookup) — surface a genuine error rather than silently returning
        // nothing.
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
