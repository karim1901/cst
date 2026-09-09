import { NextResponse } from "next/server";

import { connectToDatabase } from "@/lib/mongodb";
import { getCurrentUser } from "@/lib/auth/current-user";
import User, { USER_ROLES } from "@/models/User";
import { findOwnedEmployee } from "@/lib/employees";
import { SHIPPING_PROVIDERS } from "@/models/ShippingCompany";
import Order from "@/models/Order";
import { quickOrderCreateSchema } from "@/lib/validation/quick-orders";
import { fieldErrorsOf } from "@/lib/validation/auth";
import { createParcel } from "@/lib/quick/client";
import { resolveQuickCredentials } from "@/lib/quick/credentials";
import { normalizeQuickOrderForFrontend, syncOneQuickOrder } from "@/lib/quick/sync-order";
import { fetchQuickOrdersForMonth } from "@/lib/quick/fetch-orders";
import { reconcileCurrentMonthQuickOrders } from "@/lib/quick/reconcile-current-month";
import {
  reserveNextQuickTrackingNumber,
  releaseQuickTrackingNumber,
  peekQuickCounterForPeriod,
  peekNextQuickCounter,
} from "@/lib/quick/reserve-tracking-number";
import {
  quickTrackingPrefixFor,
  buildFullQuickTrackingNumber,
} from "@/lib/quick/tracking-number";
import { periodFor, isValidPeriod } from "@/lib/tracking/counter";
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

/**
 * List the authenticated user's own Quick Livraison orders for one calendar
 * month (`?period=YYYYMM`, defaulting to the current month).
 *
 * "Selected month" is matched against `numericTrackingNumber`'s own leading
 * "YYYYMM" (the SAME convention every other tracking-number-derived month
 * filter in this app uses — app/api/orders/route.js, lib/returns/list.js,
 * lib/commission/resolve-commission-period.js), never `createdAt`.
 *
 * Two paths, chosen by whether `period` is the CURRENT calendar month:
 *
 *  - CURRENT month: delegates entirely to
 *    lib/quick/reconcile-current-month.js#reconcileCurrentMonthQuickOrders
 *    — see that module's own comment for the full rationale. Summary: Quick
 *    itself, not local Mongo, is the authority for both "does this parcel
 *    still exist" and "what is its status", for every tracking number in
 *    `[MONTH_BOUNDARY_COUNTER, quickTrackingCounter]` (the live counter
 *    itself, INCLUSIVE — never derived from local Mongo's highest tracking
 *    number, never from the old per-month `TrackingCounter` model, never a
 *    hardcoded 1000 ceiling). A number Quick confirms exists is
 *    created/updated locally; a number Quick positively confirms does NOT
 *    exist has its local mirror DELETED (handles an order manually removed
 *    directly in Quick's own dashboard); a local number above the live
 *    counter is deleted as stale at the database level, not just hidden in
 *    the UI; a genuinely ambiguous/network-failed check never deletes
 *    anything — the local order's last known state is kept and shown.
 *  - HISTORICAL (non-current) month: local Mongo may simply never have
 *    been told about that month's orders (placed before this app's own
 *    sync existed, or never opened before). Instead of a separate
 *    "backfill everything first, THEN read Mongo, THEN stream" step (which
 *    made the whole page wait for the ENTIRE discovery walk before showing
 *    anything — the exact blocking pattern this must avoid), this walks
 *    the real, already-known counter range for that period
 *    (lib/quick/reserve-tracking-number.js#peekQuickCounterForPeriod — never
 *    blind probing, never the current month's counter) via
 *    `fetchQuickOrdersForMonth`'s `onOrder` callback, which is AWAITED per
 *    candidate: the instant Quick confirms one tracking number exists, it
 *    is synced into MongoDB (lib/quick/sync-order.js#syncOneQuickOrder —
 *    idempotent create-or-update, never a duplicate) AND streamed to the
 *    client in the very same step — discovery and display happen inside
 *    one progressive pass, not two sequential ones.
 *
 * The response streams newline-delimited JSON:
 *   {"type":"meta","period":"..."}
 *   {"type":"order","order":{...}}    — includes `_numericCounter`, purely
 *     for the frontend to keep the list sorted by tracking sequence
 *     (descending) as items arrive out of order (concurrent batches don't
 *     resolve in strict counter order) — see
 *     app/_components/orders/QuickOrdersList.jsx, which mirrors
 *     OzonOrdersList.jsx's own established re-sort-on-arrival pattern.
 *     NEVER sorted by `createdAt`, MongoDB insertion order, or arrival
 *     order.
 *   {"type":"progress","checked":N,"total":M,"found":K} — one per candidate
 *     checked (current month's full-range reconciliation walk AND the
 *     historical-month discovery walk both emit this), so the UI can show
 *     real progress instead of one long blocking wait.
 *   {"type":"done","count":N}
 *   {"type":"error","message":"..."} (mid-stream, non-fatal — orders
 *     already sent stay valid)
 * A single order's check failing or being inconclusive never hides or
 * blocks any other order — each is isolated (lib/quick/lookup.js retries
 * ambiguous responses before ever giving up on one; a genuinely missing
 * tracking number is simply skipped, never fabricated).
 */
export async function GET(request) {
  const currentUser = await getCurrentUser();
  const denied = requireOrderActor(currentUser);
  if (denied) return denied;

  await connectToDatabase();

  const merchantId = ownerMerchantId(currentUser);

  const searchParams = new URL(request.url).searchParams;

  const requestedPeriod = searchParams.get("period");
  const period = isValidPeriod(requestedPeriod) ? requestedPeriod : periodFor();

  const { employeeId: requestedEmployeeId, error: employeeError } = await resolveListingEmployeeId(
    currentUser,
    searchParams.get("employeeId")
  );
  if (employeeError) return employeeError;

  // Whichever actor's orders are actually being viewed (themselves, or —
  // for a merchant browsing — the specific employee just resolved above, or
  // the merchant's own directly-created orders when that's null) is also
  // whose OWN Quick credential should be used to check their status, if
  // they have one — see lib/quick/credentials.js's module comment for why
  // this matters (an employee's orders live under THEIR account, not
  // necessarily the merchant's shared one).
  const credentials = await resolveQuickCredentials(requestedEmployeeId ?? currentUser.id, merchantId);
  if (!credentials) {
    return NextResponse.json(
      { error: "Quick Livraison credentials are not configured correctly." },
      { status: 409 }
    );
  }

  // "Tous"/"Livré"/"Progress"/"Retour" — see lib/orders/status-groups.js.
  const requestedStatus = searchParams.get("status");
  const statusFilter = ORDER_STATUS_FILTER_VALUES.includes(requestedStatus) ? requestedStatus : "all";

  // Whichever actor's orders are actually being viewed (themselves, or —
  // for a merchant browsing — the specific employee just resolved above, or
  // the merchant's own directly-created orders when that's null).
  const actorId = requestedEmployeeId ?? currentUser.id;
  const isCurrentMonth = period === periodFor();

  // Same ownership rule as order creation: an employee sees only their own
  // orders. A merchant sees only the ones they created directly
  // (`employeeId: null`) unless they explicitly asked to browse a specific
  // employee's own orders above — never another user's tracking sequence,
  // and never "all employees" here (see app/api/orders/route.js for that).
  const ownerFilter = { merchantId, employeeId: requestedEmployeeId };

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const writeLine = (payload) => {
        controller.enqueue(encoder.encode(`${JSON.stringify(payload)}\n`));
      };

      writeLine({ type: "meta", period });

      try {
        if (isCurrentMonth) {
          // ---- Current month ----
          // The live counter itself — the ONE authoritative source, read
          // fresh from MongoDB on every request (never cached, never
          // derived from local Order documents or the old per-month
          // TrackingCounter model). See
          // lib/quick/reconcile-current-month.js's own module comment for
          // why this is INCLUSIVE (a number equal to the counter may
          // already be a real, just-created order).
          const counterCeiling = await peekNextQuickCounter(actorId);

          const actorUser =
            actorId === currentUser.id ? currentUser : await User.findById(actorId).select("username email").lean();
          const prefix = quickTrackingPrefixFor(actorUser);
          const createdByRole = requestedEmployeeId ? USER_ROLES.EMPLOYEE : USER_ROLES.MERCHANT;

          let foundCount = 0;
          await reconcileCurrentMonthQuickOrders({
            credentials,
            prefix,
            period,
            counterCeiling,
            ownerFilter,
            employeeId: requestedEmployeeId,
            createdByRole,
            statusFilter,
            signal: request.signal,
            onOrder: (normalized) => {
              foundCount += 1;
              writeLine({ type: "order", order: normalized });
            },
            onProgress: (progress) => writeLine({ type: "progress", ...progress, found: foundCount }),
          });

          writeLine({ type: "done", count: foundCount });
        } else {
          // ---- Historical month ----
          // Step 1: whatever is ALREADY known locally streams instantly —
          // same reliable base the current-month path always had. This
          // also means a transient/inconclusive live check for one
          // candidate during step 2 below can never make an already-known
          // order vanish from the page — it was already sent.
          let foundCount = 0;
          const alreadySent = new Set();
          const localHistoricalOrders = await Order.find({
            ...ownerFilter,
            provider: SHIPPING_PROVIDERS.QUICK_LIVRAISON,
            numericTrackingNumber: { $regex: `^${period}` },
          })
            .sort({ numericTrackingNumber: -1 })
            .lean();

          for (const order of localHistoricalOrders) {
            alreadySent.add(order.trackingNumber);
            const normalized = normalizeQuickOrderForFrontend(order, order.lastKnownStatus);
            if (matchesStatusFilter(SHIPPING_PROVIDERS.QUICK_LIVRAISON, normalized.status, statusFilter)) {
              foundCount += 1;
              writeLine({ type: "order", order: normalized });
            }
          }

          // Step 2: progressively discover anything NOT already known
          // locally, walking the real, already-known counter range for
          // this period (lib/quick/reserve-tracking-number.js#peekQuickCounterForPeriod
          // — never blind probing, never the current month's live counter).
          // Each candidate is synced into MongoDB (idempotent create-or-
          // update — lib/quick/sync-order.js) AND streamed to the client
          // in the same step the instant it's confirmed — no separate
          // "backfill everything first, THEN read Mongo, THEN stream"
          // pass, which is what made the whole page wait for the entire
          // walk before showing anything.
          const knownCounter = await peekQuickCounterForPeriod(actorId, period);
          if (knownCounter != null) {
            // The tracking-number PREFIX must be the VIEWED actor's own
            // identity (their username, or the merchant's own derived
            // prefix) — not necessarily the caller's, when a merchant is
            // browsing a specific employee's historical month.
            const actorUser =
              actorId === currentUser.id ? currentUser : await User.findById(actorId).select("username email").lean();
            const prefix = quickTrackingPrefixFor(actorUser);
            const createdByRole = requestedEmployeeId ? USER_ROLES.EMPLOYEE : USER_ROLES.MERCHANT;

            await fetchQuickOrdersForMonth(credentials, prefix, period, knownCounter, {
              signal: request.signal,
              onProgress: (progress) => writeLine({ type: "progress", ...progress }),
              // Awaited — the discovered order is synced into MongoDB
              // BEFORE it is written to the stream, so the client only
              // ever sees orders that are already correctly mirrored
              // locally.
              onOrder: async (item) => {
                try {
                  const { normalized } = await syncOneQuickOrder({
                    merchantId,
                    employeeId: requestedEmployeeId,
                    createdByRole,
                    trackingNumber: item._fullTrackingNumber,
                    numericTrackingNumber: item._fullTrackingNumber.slice(prefix.length),
                    body: item.body,
                  });
                  if (!normalized) return;
                  // Already streamed in step 1 above — syncOneQuickOrder
                  // still refreshed its status server-side, but sending a
                  // second line for the same tracking number would render
                  // as a duplicate card.
                  if (alreadySent.has(normalized.trackingNumber)) return;
                  alreadySent.add(normalized.trackingNumber);
                  if (matchesStatusFilter(SHIPPING_PROVIDERS.QUICK_LIVRAISON, normalized.status, statusFilter)) {
                    foundCount += 1;
                    writeLine({ type: "order", order: normalized });
                  }
                } catch (error) {
                  if (error?.name === "AbortError") throw error;
                  console.error(
                    "[GET /api/orders/quick] failed to sync discovered order",
                    item._fullTrackingNumber,
                    "-",
                    error?.message
                  );
                }
              },
            });
          }
          writeLine({ type: "done", count: foundCount });
        }
      } catch (error) {
        if (error?.name !== "AbortError") {
          console.error("[GET /api/orders/quick]", error);
          writeLine({ type: "error", message: "Could not reach Quick Livraison. Please try again." });
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
 * Create one Quick Livraison delivery for the authenticated
 * merchant/employee.
 *
 * Sequence (see README for the full rationale — identical shape to the
 * Ozon Express route, bound to Quick's own field/client):
 *   1. auth + role check
 *   2. resolve Quick credentials — the caller's own if they have one,
 *      otherwise their merchant's shared one (see lib/quick/credentials.js;
 *      never from the client)
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
  // The person actually creating this order — their OWN Quick credential is
  // preferred if they have one (an employee with their own Quick account),
  // otherwise the merchant's shared one. See lib/quick/credentials.js.
  const credentials = await resolveQuickCredentials(currentUser.id, merchantId);
  if (!credentials) {
    return NextResponse.json(
      { error: "Quick Livraison credentials are not configured correctly." },
      { status: 409 }
    );
  }

  let reservation;
  try {
    reservation = await reserveNextQuickTrackingNumber(currentUser.id);
  } catch (error) {
    return NextResponse.json(
      { error: error.statusCode ? error.message : "Something went wrong." },
      { status: error.statusCode || 500 }
    );
  }

  const prefix = quickTrackingPrefixFor(currentUser);
  // The period segment always reflects TODAY's real month — it is NOT
  // stored alongside the counter (the live `quickTrackingCounter` is a
  // single continuous value, decoupled from calendar months by design —
  // see lib/quick/reserve-tracking-number.js — same as Ozon's own
  // equivalent field).
  const fullTrackingNumber = buildFullQuickTrackingNumber(prefix, periodFor(), reservation.trackingId);
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
    await releaseQuickTrackingNumber(currentUser.id, reservation);
    console.error("[POST /api/orders/quick] Quick Livraison call failed:", error?.message);
    return NextResponse.json(
      { error: "Could not reach Quick Livraison. Please try again." },
      { status: error?.statusCode || 502 }
    );
  }

  if (result.result === "ERROR") {
    await releaseQuickTrackingNumber(currentUser.id, reservation);
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
