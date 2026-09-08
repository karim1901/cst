import { NextResponse } from "next/server";

import { connectToDatabase } from "@/lib/mongodb";
import { getCurrentUser } from "@/lib/auth/current-user";
import { USER_ROLES } from "@/models/User";
import { findOwnedEmployee } from "@/lib/employees";
import ShippingCompany, { SHIPPING_PROVIDERS } from "@/models/ShippingCompany";
import Order from "@/models/Order";
import { decryptSecret } from "@/lib/crypto/secret-box";
import { quickOrderCreateSchema } from "@/lib/validation/quick-orders";
import { fieldErrorsOf } from "@/lib/validation/auth";
import { createParcel, fetchParcelDetails } from "@/lib/quick/client";
import { quickParcelExists, quickDisplayStatus } from "@/lib/quick/parse";
import {
  reserveNextQuickTrackingNumber,
  releaseQuickTrackingNumber,
} from "@/lib/quick/reserve-tracking-number";
import {
  quickTrackingPrefixFor,
  buildFullQuickTrackingNumber,
} from "@/lib/quick/tracking-number";
import { periodFor, isValidPeriod, periodDateRange } from "@/lib/tracking/counter";
import { syncOrderStatus } from "@/lib/commission/sync-status";
import { matchesStatusFilter, ORDER_STATUS_FILTER_VALUES } from "@/lib/orders/status-groups";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Quick Livraison order creation + listing, server-side.
 *
 * Mirrors app/api/orders/ozon/route.js's structure exactly (same auth
 * model, same reserve-before-call / release-on-failure pattern), bound to
 * Quick's own credentials, counter field and HTTP client — see
 * lib/quick/*. The browser never talks to clients.quicklivraison.ma
 * directly.
 */

function requireOrderActor(currentUser) {
  if (!currentUser) {
    return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  }
  if (currentUser.role !== USER_ROLES.MERCHANT && currentUser.role !== USER_ROLES.EMPLOYEE) {
    return NextResponse.json(
      { error: "Only merchants and employees can create orders." },
      { status: 403 }
    );
  }
  return null;
}

// The merchant whose Quick credentials / tracking sequence apply. An
// employee always acts under their own merchant's credentials but their OWN
// tracking sequence; a merchant acts under their own credentials and
// sequence. Same rule as the Ozon route.
function ownerMerchantId(currentUser) {
  return currentUser.role === USER_ROLES.EMPLOYEE ? currentUser.merchantId : currentUser.id;
}

/**
 * Whose orders the listing (GET) should show — normally the caller's own.
 * A merchant may instead pass `?employeeId=` to view one specific
 * employee's orders (see app/_components/orders/OrderFilters.jsx) —
 * validated here: an id that isn't a real, owned employee 404s exactly
 * like one that doesn't exist. An employee caller can never pass this.
 */
async function resolveListingEmployeeId(currentUser, requestedEmployeeId) {
  if (currentUser.role === USER_ROLES.EMPLOYEE) {
    return { employeeId: currentUser.id, error: null };
  }
  if (!requestedEmployeeId) {
    return { employeeId: null, error: null };
  }
  const owned = await findOwnedEmployee(requestedEmployeeId, currentUser.id);
  if (!owned) {
    return { employeeId: null, error: NextResponse.json({ error: "Employee not found." }, { status: 404 }) };
  }
  return { employeeId: requestedEmployeeId, error: null };
}

async function loadQuickCredentials(merchantId) {
  const doc = await ShippingCompany.findOne({
    merchantId,
    provider: SHIPPING_PROVIDERS.QUICK_LIVRAISON,
  }).select("+apiKey");
  if (!doc) return null;
  return { apiKey: decryptSecret(doc.apiKey) };
}

/**
 * List the authenticated user's own Quick Livraison orders for one calendar
 * month (`?period=YYYYMM`, defaulting to the current month).
 *
 * MongoDB is the source of truth for the order list and every
 * customer/order field — Quick's API does not expose enough information to
 * reconstruct that, and is never used to *discover* orders (no scanning
 * tracking numbers). For each locally-stored order, Quick is queried ONLY
 * for its current live status via `getParcelDetails`; if that call fails or
 * is inconclusive for a given order, the order still shows (with its last
 * known status, or `statusUnavailable` if none is stored yet) — a provider
 * hiccup must never hide or corrupt a local order.
 */
export async function GET(request) {
  const currentUser = await getCurrentUser();
  const denied = requireOrderActor(currentUser);
  if (denied) return denied;

  await connectToDatabase();

  const merchantId = ownerMerchantId(currentUser);
  const credentials = await loadQuickCredentials(merchantId);
  if (!credentials) {
    return NextResponse.json(
      { error: "Quick Livraison is not configured for this merchant yet." },
      { status: 409 }
    );
  }

  const searchParams = new URL(request.url).searchParams;

  const requestedPeriod = searchParams.get("period");
  const period = isValidPeriod(requestedPeriod) ? requestedPeriod : periodFor();
  // Quick's list already comes from MongoDB (not a tracking-number scan),
  // so "selected month" is just a `createdAt` range filter — an order's
  // creation month always equals the period its tracking number was
  // generated for, by construction (see the POST handler below).
  const { start, end } = periodDateRange(period);

  const { employeeId: requestedEmployeeId, error: employeeError } = await resolveListingEmployeeId(
    currentUser,
    searchParams.get("employeeId")
  );
  if (employeeError) return employeeError;

  // "Tous"/"Livré"/"Progress"/"Retour" — see lib/orders/status-groups.js.
  const requestedStatus = searchParams.get("status");
  const statusFilter = ORDER_STATUS_FILTER_VALUES.includes(requestedStatus) ? requestedStatus : "all";

  // Same ownership rule as order creation: an employee sees only their own
  // orders. A merchant sees only the ones they created directly
  // (`employeeId: null`) unless they explicitly asked to browse a specific
  // employee's own orders above — never another user's tracking sequence,
  // and never "all employees" here (see app/api/orders/route.js for that).
  const ownerFilter = { merchantId, employeeId: requestedEmployeeId };

  const localOrders = await Order.find({
    ...ownerFilter,
    provider: SHIPPING_PROVIDERS.QUICK_LIVRAISON,
    createdAt: { $gte: start, $lt: end },
  })
    .sort({ createdAt: -1 })
    .lean();

  const orders = await Promise.all(
    localOrders.map(async (order) => {
      let liveStatus = null;
      try {
        const { httpStatus, body } = await fetchParcelDetails(
          credentials,
          order.trackingNumber,
          request.signal
        );
        if (quickParcelExists(body, httpStatus)) {
          liveStatus = quickDisplayStatus(body);
        }
      } catch (error) {
        if (error?.name === "AbortError") throw error;
        console.error(
          "[GET /api/orders/quick] status check failed for",
          order.trackingNumber,
          "-",
          error?.message
        );
      }

      if (liveStatus) {
        // Best-effort cache for the next time Quick is unreachable, and also
        // feeds the commission system's `deliveredAt` — see
        // lib/commission/sync-status.js. Never blocks or fails this response.
        syncOrderStatus({
          provider: SHIPPING_PROVIDERS.QUICK_LIVRAISON,
          trackingNumber: order.trackingNumber,
          status: liveStatus,
        });
      }

      const status = liveStatus ?? order.lastKnownStatus ?? null;

      return {
        id: String(order._id),
        trackingNumber: order.trackingNumber,
        receiver: order.receiverName,
        phone: order.phone,
        city: order.city,
        address: order.address,
        product: order.productNature,
        quantity: order.quantity ?? null,
        note: order.note ?? null,
        price: order.price,
        createdAt: order.createdAt,
        status,
        statusUnavailable: status == null,
      };
    })
  );

  // Filtered AFTER the per-order live-status lookup above (status isn't
  // known any earlier — it depends on that call), but still before the
  // response is sent, so a non-matching order's full details are never
  // shipped to the browser. See lib/orders/status-groups.js.
  const filteredOrders = orders.filter((order) =>
    matchesStatusFilter(SHIPPING_PROVIDERS.QUICK_LIVRAISON, order.status, statusFilter)
  );

  return NextResponse.json({ orders: filteredOrders, period });
}

/**
 * Create one Quick Livraison delivery for the authenticated
 * merchant/employee.
 *
 * Sequence (see README for the full rationale — identical shape to the
 * Ozon Express route, bound to Quick's own field/client):
 *   1. auth + role check
 *   2. load this merchant's Quick credentials (never from the client)
 *   3. reserve a Quick-specific tracking number atomically
 *   4. call Quick `deliveries/store`
 *   5. inspect the (best-effort parsed) response
 *   6. success -> mirror the order locally; failure -> release the number
 */
export async function POST(request) {
  const currentUser = await getCurrentUser();
  const denied = requireOrderActor(currentUser);
  if (denied) return denied;

  let body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  const parsed = quickOrderCreateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Please correct the highlighted fields.", fieldErrors: fieldErrorsOf(parsed.error) },
      { status: 422 }
    );
  }

  await connectToDatabase();

  const merchantId = ownerMerchantId(currentUser);
  const credentials = await loadQuickCredentials(merchantId);
  if (!credentials) {
    return NextResponse.json(
      { error: "Quick Livraison is not configured for this merchant yet." },
      { status: 409 }
    );
  }

  let reservation;
  try {
    reservation = await reserveNextQuickTrackingNumber(currentUser.id, periodFor());
  } catch (error) {
    return NextResponse.json(
      { error: error.statusCode ? error.message : "Something went wrong." },
      { status: error.statusCode || 500 }
    );
  }

  const prefix = quickTrackingPrefixFor(currentUser);
  const fullTrackingNumber = buildFullQuickTrackingNumber(prefix, reservation.period, reservation.trackingId);
  // Everything after the prefix — kept as its own value (not just the bare
  // counter) so `trackingNumber === prefix + numericTrackingNumber` always
  // holds, the same invariant models/Order.js documents.
  const numericTrackingNumber = fullTrackingNumber.slice(prefix.length);

  const { receiver, phone, districtId, address, productName, quantity, amount, note } = parsed.data;
  const deliveryFields = {
    district_id: districtId,
    name: receiver,
    amount,
    phone,
    address,
    prd_name: productName,
    qte_prd: quantity,
    note,
    // Always allow the customer to open the package before paying — a fixed
    // business rule, not a per-order choice. Enforced here, server-side, so
    // no client input (or its absence) can ever change it.
    open: 1,
    code: fullTrackingNumber,
  };

  let result;
  try {
    result = await createParcel(credentials, deliveryFields, request.signal);
  } catch (error) {
    if (error?.name === "AbortError") throw error;
    await releaseQuickTrackingNumber(reservation);
    console.error("[POST /api/orders/quick] Quick Livraison call failed:", error?.message);
    return NextResponse.json(
      { error: "Could not reach Quick Livraison. Please try again." },
      { status: error?.statusCode || 502 }
    );
  }

  if (result.result === "ERROR") {
    await releaseQuickTrackingNumber(reservation);
    return NextResponse.json(
      { error: result.message || "Quick Livraison rejected this order.", quick: result.raw ?? null },
      { status: 422 }
    );
  }

  // Quick confirmed creation — mirror it locally. A failure here must not
  // be reported as an order failure: the parcel already exists at Quick.
  let orderDoc = null;
  try {
    orderDoc = await Order.create({
      merchantId,
      employeeId: currentUser.role === USER_ROLES.EMPLOYEE ? currentUser.id : null,
      createdByRole: currentUser.role,
      provider: SHIPPING_PROVIDERS.QUICK_LIVRAISON,
      trackingNumber: fullTrackingNumber,
      numericTrackingNumber,
      receiverName: receiver,
      phone,
      city: districtId,
      address,
      productNature: productName,
      price: amount,
      quantity,
      note,
      providerLocationId: districtId,
      providerResult: result.result,
    });
  } catch (error) {
    console.error("[POST /api/orders/quick] local order mirror failed:", error?.message);
  }

  return NextResponse.json(
    {
      trackingNumber: fullTrackingNumber,
      numericTrackingNumber,
      quick: result.raw ?? null,
      order: orderDoc ? { id: String(orderDoc._id) } : null,
    },
    { status: 201 }
  );
}
