import { NextResponse } from "next/server";

import { connectToDatabase } from "@/lib/mongodb";
import { getCurrentUser } from "@/lib/auth/current-user";
import { USER_ROLES } from "@/models/User";
import { findOwnedEmployee } from "@/lib/employees";
import ShippingCompany, { SHIPPING_PROVIDERS } from "@/models/ShippingCompany";
import Order from "@/models/Order";
import { decryptSecret } from "@/lib/crypto/secret-box";
import { ozonOrderCreateSchema } from "@/lib/validation/orders";
import { fieldErrorsOf } from "@/lib/validation/auth";
import { addParcel } from "@/lib/ozon/client";
import { fetchOzonOrdersForMonth } from "@/lib/ozon/fetch-orders";
import {
  reserveNextOzonTrackingNumber,
  releaseOzonTrackingNumber,
  peekNextOzonCounter,
  peekOzonCounterForPeriod,
} from "@/lib/ozon/reserve-tracking-number";
import { ozonTrackingPrefixFor, buildFullOzonTrackingNumber } from "@/lib/ozon/tracking-number";
import { periodFor, isValidPeriod } from "@/lib/tracking/counter";
import { resolveDisplayStatus, getLivreurDisplayPhone, findDeliveredAt } from "@/lib/ozon/history";
import { syncOrderStatus } from "@/lib/commission/sync-status";
import { matchesStatusFilter, ORDER_STATUS_FILTER_VALUES } from "@/lib/orders/status-groups";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Ozon Express order creation + listing, server-side.
 *
 * The browser never talks to api.ozonexpress.ma directly — everything below
 * (credentials, tracking-number reservation, the actual Ozon calls) runs
 * here. See lib/ozon/* for the pieces this route composes, and the README's
 * "Ozon Express" section for the full design writeup.
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

// The merchant whose Ozon credentials / tracking sequence apply. An employee
// always acts under their own merchant's credentials but their OWN tracking
// sequence (see lib/ozon/tracking-number.js); a merchant acts under their
// own credentials and their own sequence.
function ownerMerchantId(currentUser) {
  return currentUser.role === USER_ROLES.EMPLOYEE ? currentUser.merchantId : currentUser.id;
}

/**
 * Which actor's own tracking sequence the listing (GET) should show —
 * normally whoever is logged in. A merchant may instead pass `?employeeId=`
 * to browse one of their own employees' live orders (see
 * app/_components/orders/OrderFilters.jsx / the Orders page) — validated
 * here, not trusted: an id that isn't a real, owned employee is rejected
 * exactly like a merchant trying to view an arbitrary/other merchant's
 * employee. An employee caller can never pass this (only their own view
 * ever applies to them).
 */
async function resolveListingActor(currentUser, requestedEmployeeId) {
  if (!requestedEmployeeId || currentUser.role !== USER_ROLES.MERCHANT) {
    return { actor: currentUser, error: null };
  }
  const employee = await findOwnedEmployee(requestedEmployeeId, currentUser.id, "_id username email");
  if (!employee) {
    return { actor: null, error: NextResponse.json({ error: "Employee not found." }, { status: 404 }) };
  }
  return {
    actor: { id: String(employee._id), username: employee.username, email: employee.email },
    error: null,
  };
}

async function loadOzonCredentials(merchantId) {
  const doc = await ShippingCompany.findOne({
    merchantId,
    provider: SHIPPING_PROVIDERS.OZON_EXPRESS,
  }).select("+apiKey");
  if (!doc) return null;
  return { ozonId: doc.ozonId, apiKey: decryptSecret(doc.apiKey) };
}

/** Attach the two derived display fields every card needs, without discarding the raw Ozon fields. */
function normalizeOrder(order) {
  const displayStatus = resolveDisplayStatus(order);

  // Best-effort, fire-and-forget: feeds the commission system's local status
  // cache (see lib/commission/sync-status.js) — never awaited, never allowed
  // to affect this response. `SHIPPING_PROVIDERS.OZON_EXPRESS` matches
  // exactly what Order.provider was created with, and `_fullTrackingNumber`
  // is the exact value fetch-orders.js built the tracking number from — see
  // its module comment.
  syncOrderStatus({
    provider: SHIPPING_PROVIDERS.OZON_EXPRESS,
    trackingNumber: order._fullTrackingNumber,
    status: displayStatus,
    // The real "Livré" event time from Ozon's own history, when there is
    // one — not the moment we happened to check (see findDeliveredAt's
    // comment / lib/commission/sync-status.js).
    deliveredAt: findDeliveredAt(order),
  });

  return {
    ...order,
    _displayStatus: displayStatus,
    _courierPhone: getLivreurDisplayPhone(order),
  };
}

/**
 * List the authenticated user's own Ozon orders for one calendar month
 * (`?period=YYYYMM`, defaulting to the current month) by re-fetching
 * tracking + parcel-info from Ozon live — see lib/ozon/fetch-orders.js.
 * Never reads order status back from our local `Order` mirror; that
 * collection is audit-only (see models/Order.js).
 *
 * Streams the response as newline-delimited JSON (NDJSON) instead of
 * waiting for every Ozon order to be fetched before responding: fetching
 * even a modest history is many sequential/batched Ozon HTTP calls (2 per
 * order), and waiting for all of them made the page feel frozen. Each line
 * is one JSON object:
 *   {"type":"meta","period":"..."}   — which month is actually being shown
 *   {"type":"order","order":{...}}   — one order, the moment it's ready
 *   {"type":"done","count":N}        — the stream finished normally
 *   {"type":"error","message":"..."} — the stream stopped early on a hard error
 * The initial auth/config checks below still run first and return a normal
 * JSON error response (same status codes as before) — only the actual order
 * fetch becomes a stream.
 */
export async function GET(request) {
  const currentUser = await getCurrentUser();
  const denied = requireOrderActor(currentUser);
  if (denied) return denied;

  await connectToDatabase();

  const merchantId = ownerMerchantId(currentUser);
  const credentials = await loadOzonCredentials(merchantId);
  if (!credentials) {
    return NextResponse.json(
      { error: "Ozon Express is not configured for this merchant yet." },
      { status: 409 }
    );
  }

  const searchParams = new URL(request.url).searchParams;
  const requestedPeriod = searchParams.get("period");
  const period = isValidPeriod(requestedPeriod) ? requestedPeriod : periodFor();
  const isCurrentMonth = period === periodFor();

  const { actor, error: actorError } = await resolveListingActor(
    currentUser,
    searchParams.get("employeeId")
  );
  if (actorError) return actorError;

  // "Tous"/"Livré"/"Progress"/"Retour" — see lib/orders/status-groups.js.
  // Filtered HERE, before streaming, so a non-matching order is never sent
  // to the browser at all (not a client-side hide after download).
  const requestedStatus = searchParams.get("status");
  const statusFilter = ORDER_STATUS_FILTER_VALUES.includes(requestedStatus) ? requestedStatus : "all";

  let startCounter;
  try {
    // The CURRENT month always reads from the live `User.ozonTrackingCounter`
    // — the authoritative counter. A PAST month keeps using the per-period
    // `TrackingCounter` records created while that was the active scheme;
    // that historical-lookup mechanism is preserved as-is. `actor` is
    // normally the caller; a merchant browsing an employee's orders (see
    // above) gets that employee's own counter instead — never the
    // merchant's own, which would show the wrong sequence entirely.
    startCounter = isCurrentMonth
      ? await peekNextOzonCounter(actor.id)
      : await peekOzonCounterForPeriod(actor.id, period);
  } catch (error) {
    return NextResponse.json(
      { error: error.statusCode ? error.message : "Something went wrong." },
      { status: error.statusCode || 500 }
    );
  }

  const prefix = ozonTrackingPrefixFor(actor);

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const writeLine = (payload) => {
        controller.enqueue(encoder.encode(`${JSON.stringify(payload)}\n`));
      };

      writeLine({ type: "meta", period });

      try {
        const orders = await fetchOzonOrdersForMonth(credentials, prefix, period, startCounter, {
          signal: request.signal,
          onOrder: (order) => {
            const normalized = normalizeOrder(order);
            // Classification still runs (via normalizeOrder, above) even for
            // an order this filter excludes — that's also what feeds
            // syncOrderStatus's local cache, and must never be skipped just
            // because the browser won't see this particular order.
            if (!matchesStatusFilter(SHIPPING_PROVIDERS.OZON_EXPRESS, normalized._displayStatus, statusFilter)) {
              return;
            }
            writeLine({ type: "order", order: normalized });
          },
        });
        writeLine({ type: "done", count: orders.length });
      } catch (error) {
        if (error?.name !== "AbortError") {
          console.error("[GET /api/orders/ozon]", error);
          writeLine({ type: "error", message: "Could not reach Ozon Express. Please try again." });
        }
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    status: 200,
    headers: {
      "content-type": "application/x-ndjson; charset=utf-8",
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
    },
  });
}

/**
 * Create one Ozon Express parcel for the authenticated merchant/employee.
 *
 * Sequence (see README for the full rationale):
 *   1. auth + role check
 *   2. load this merchant's Ozon credentials (never from the client)
 *   3. reserve a tracking number atomically (advances the counter)
 *   4. call Ozon `add-parcel`
 *   5. inspect ADD-PARCEL.RESULT
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

  const parsed = ozonOrderCreateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Please correct the highlighted fields.", fieldErrors: fieldErrorsOf(parsed.error) },
      { status: 422 }
    );
  }

  await connectToDatabase();

  const merchantId = ownerMerchantId(currentUser);
  const credentials = await loadOzonCredentials(merchantId);
  if (!credentials) {
    return NextResponse.json(
      { error: "Ozon Express is not configured for this merchant yet." },
      { status: 409 }
    );
  }

  let reservation;
  try {
    reservation = await reserveNextOzonTrackingNumber(currentUser.id);
  } catch (error) {
    return NextResponse.json(
      { error: error.statusCode ? error.message : "Something went wrong." },
      { status: error.statusCode || 500 }
    );
  }

  const prefix = ozonTrackingPrefixFor(currentUser);
  // The period segment always reflects TODAY's real month — it is NOT
  // stored alongside the counter (unlike Quick's per-month scheme): the
  // live `ozonTrackingCounter` is a single continuous value, decoupled from
  // calendar months by design (see lib/ozon/reserve-tracking-number.js).
  const fullTrackingNumber = buildFullOzonTrackingNumber(prefix, periodFor(), reservation.trackingId);
  // Everything after the prefix — kept as its own value (not just the bare
  // counter) so `trackingNumber === prefix + numericTrackingNumber` always
  // holds, the same invariant models/Order.js documents.
  const numericTrackingNumber = fullTrackingNumber.slice(prefix.length);

  const { receiver, phone, city, address, productNature, price } = parsed.data;
  const parcelFields = {
    "parcel-receiver": receiver,
    "parcel-phone": phone,
    "parcel-city": city,
    "parcel-address": address,
    "parcel-note": productNature,
    "parcel-price": price,
    "parcel-nature": productNature,
  };

  let result;
  try {
    result = await addParcel(credentials, fullTrackingNumber, parcelFields, request.signal);
  } catch (error) {
    if (error?.name === "AbortError") throw error;
    await releaseOzonTrackingNumber(currentUser.id, reservation);
    console.error("[POST /api/orders/ozon] Ozon Express call failed:", error?.message);
    return NextResponse.json(
      { error: "Could not reach Ozon Express. Please try again." },
      { status: error?.statusCode || 502 }
    );
  }

  if (result.result === "ERROR") {
    await releaseOzonTrackingNumber(currentUser.id, reservation);
    return NextResponse.json(
      { error: "Ozon Express rejected this order.", ozon: result.addParcel ?? null },
      { status: 422 }
    );
  }

  // Ozon confirmed creation — mirror it locally. A failure here must not be
  // reported as an order failure: the parcel already exists at Ozon.
  let orderDoc = null;
  try {
    orderDoc = await Order.create({
      merchantId,
      employeeId: currentUser.role === USER_ROLES.EMPLOYEE ? currentUser.id : null,
      createdByRole: currentUser.role,
      provider: SHIPPING_PROVIDERS.OZON_EXPRESS,
      trackingNumber: fullTrackingNumber,
      numericTrackingNumber,
      receiverName: receiver,
      phone,
      city,
      address,
      productNature,
      price,
      // The user typed this amount just now — the canonical, trustworthy
      // price source; historical sync must never overwrite it.
      priceSource: "order_creation",
      providerResult: result.result,
    });
  } catch (error) {
    console.error("[POST /api/orders/ozon] local order mirror failed:", error?.message);
  }

  return NextResponse.json(
    {
      trackingNumber: fullTrackingNumber,
      numericTrackingNumber,
      ozon: result.addParcel ?? null,
      order: orderDoc ? { id: String(orderDoc._id) } : null,
    },
    { status: 201 }
  );
}
