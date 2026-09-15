import { NextResponse } from "next/server";

import { connectToDatabase } from "@/lib/mongodb";
import { getCurrentUser } from "@/lib/auth/current-user";
import { USER_ROLES } from "@/models/User";
import { SHIPPING_PROVIDER_VALUES } from "@/models/ShippingCompany";
import Order from "@/models/Order";
import { findOwnedEmployee } from "@/lib/employees";
import { isValidPeriod } from "@/lib/tracking/counter";
import {
  ORDER_STATUS_FILTERS,
  ORDER_STATUS_FILTER_VALUES,
  RETURN_STATUS_RAW_TOKENS,
} from "@/lib/orders/status-groups";
import { ORDER_SEARCH_MODES, buildOrderSearchFilter } from "@/lib/orders/search";
import { ACTIVE_PROVIDER_ORDER_FILTER } from "@/lib/orders/provider-record-status";
import { buildCityNameIndex, resolveOrderCityDisplayName } from "@/lib/orders/city-name-index";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DEFAULT_PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 50;

/**
 * Server-side Orders-page search — by phone number OR by tracking number —
 * over the local `Order` mirror (models/Order.js), which IS the source of
 * truth for the app's order list. This route NEVER calls a provider API:
 * a search can't turn into hundreds of tracking-number probes, and a
 * provider timeout / rate-limit / temporary outage can't make an order that
 * exists locally vanish from the results. The exists/not_found/unknown
 * reconciliation rules live elsewhere (lib/orders/reconcile-stale-orders.js)
 * and are untouched by searching.
 *
 * Every result is constrained, SERVER-SIDE, to:
 *   - the caller's own merchant  (merchant → self; employee → their merchant)
 *   - the selected provider      (?provider=, required — Ozon and Quick
 *                                 orders never cross)
 *   - the selected month         (?period=YYYYMM — the same anchored
 *                                 `numericTrackingNumber` rule as
 *                                 app/api/orders/route.js and
 *                                 lib/commission/report.js, not a second
 *                                 month calculation)
 *   - the selected employee      (merchant: ?employeeId=me | <id> | absent;
 *                                 employee: ALWAYS forced to themselves — a
 *                                 client-supplied employeeId is ignored)
 *   - the selected status tab    (?status= — same Livré/Progress/Retour rule)
 *
 * A merchant can never reach another merchant's orders (merchantId is their
 * own id, never from the request); an employee can never reach another
 * employee's or another merchant's orders (merchantId + employeeId are both
 * derived from the verified session, never the query string).
 */
export async function GET(request) {
  const currentUser = await getCurrentUser();
  if (!currentUser) {
    return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  }
  if (currentUser.role !== USER_ROLES.MERCHANT && currentUser.role !== USER_ROLES.EMPLOYEE) {
    return NextResponse.json({ error: "Not allowed." }, { status: 403 });
  }

  const searchParams = new URL(request.url).searchParams;

  const provider = searchParams.get("provider");
  if (!SHIPPING_PROVIDER_VALUES.includes(provider)) {
    return NextResponse.json({ error: "A valid `provider` is required." }, { status: 400 });
  }

  const mode = searchParams.get("searchMode");
  if (!ORDER_SEARCH_MODES.includes(mode)) {
    return NextResponse.json({ error: "A valid `searchMode` is required." }, { status: 400 });
  }

  const searchFragment = buildOrderSearchFilter(mode, searchParams.get("search"));
  if (!searchFragment) {
    // Nothing meaningful to search for — an empty result, not a full scan.
    return NextResponse.json({
      orders: [],
      page: 1,
      pageSize: DEFAULT_PAGE_SIZE,
      total: 0,
      totalPages: 1,
    });
  }

  // ---- authorization-bound scope -------------------------------------
  const isEmployee = currentUser.role === USER_ROLES.EMPLOYEE;
  const merchantId = isEmployee ? currentUser.merchantId : currentUser.id;

  // A confirmed provider-deleted order (lib/orders/provider-record-status.js)
  // stays in Mongo for audit but must not appear in search results either —
  // same active/existing scope rule as every other local-DB order surface.
  const filter = { merchantId, provider, providerRecordStatus: ACTIVE_PROVIDER_ORDER_FILTER, ...searchFragment };

  if (isEmployee) {
    // An employee only ever searches their OWN orders — a client-supplied
    // employeeId is never trusted here.
    filter.employeeId = currentUser.id;
  } else {
    const requestedEmployeeId = searchParams.get("employeeId");
    if (requestedEmployeeId === "me") {
      filter.employeeId = null; // the merchant's own directly-created orders
    } else if (requestedEmployeeId) {
      const owned = await findOwnedEmployee(requestedEmployeeId, currentUser.id);
      if (!owned) {
        return NextResponse.json({ error: "Employee not found." }, { status: 404 });
      }
      filter.employeeId = requestedEmployeeId;
    }
    // absent → across every employee under this merchant ("All employees")
  }

  const requestedPeriod = searchParams.get("period");
  if (requestedPeriod && isValidPeriod(requestedPeriod)) {
    filter.numericTrackingNumber = { $regex: `^${requestedPeriod}` };
  }

  const requestedStatus = searchParams.get("status");
  const statusFilter = ORDER_STATUS_FILTER_VALUES.includes(requestedStatus) ? requestedStatus : "all";
  let useCollation = false;
  if (statusFilter === ORDER_STATUS_FILTERS.DELIVERED) {
    filter.deliveredAt = { $ne: null };
  } else if (statusFilter === ORDER_STATUS_FILTERS.RETURN) {
    filter.deliveredAt = null;
    filter.lastKnownStatus = { $in: RETURN_STATUS_RAW_TOKENS };
    useCollation = true;
  } else if (statusFilter === ORDER_STATUS_FILTERS.PROGRESS) {
    filter.deliveredAt = null;
    filter.lastKnownStatus = { $nin: RETURN_STATUS_RAW_TOKENS };
    useCollation = true;
  }
  const withCollation = (query) =>
    useCollation ? query.collation({ locale: "en", strength: 1 }) : query;

  const page = Math.max(1, Number.parseInt(searchParams.get("page"), 10) || 1);
  const pageSize = Math.min(
    MAX_PAGE_SIZE,
    Math.max(1, Number.parseInt(searchParams.get("pageSize"), 10) || DEFAULT_PAGE_SIZE)
  );

  await connectToDatabase();

  const [orders, total, cityNameById] = await Promise.all([
    withCollation(
      Order.find(filter)
        .select(
          "employeeId provider trackingNumber receiverName phone city providerLocationId address productNature price quantity note lastKnownStatus deliveredAt createdAt updatedAt"
        )
        .sort({ createdAt: -1 })
        .skip((page - 1) * pageSize)
        .limit(pageSize)
        .populate({ path: "employeeId", select: "name username" })
    ).lean(),
    withCollation(Order.countDocuments(filter)),
    buildCityNameIndex(merchantId, provider),
  ]);

  return NextResponse.json({
    orders: orders.map((order) => ({
      id: String(order._id),
      provider: order.provider,
      // Real business data below — returned verbatim, never translated.
      trackingNumber: order.trackingNumber,
      employee: order.employeeId
        ? {
            id: String(order.employeeId._id),
            name: order.employeeId.name,
            username: order.employeeId.username,
          }
        : null,
      receiver: order.receiverName,
      phone: order.phone,
      city: resolveOrderCityDisplayName(order, cityNameById),
      address: order.address,
      product: order.productNature,
      quantity: order.quantity ?? null,
      note: order.note ?? null,
      price: order.price,
      status: order.lastKnownStatus,
      deliveredAt: order.deliveredAt,
      createdAt: order.createdAt,
      updatedAt: order.updatedAt,
    })),
    page,
    pageSize,
    total,
    totalPages: Math.max(1, Math.ceil(total / pageSize)),
  });
}
