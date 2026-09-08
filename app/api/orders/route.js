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

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DEFAULT_PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 50;

/**
 * Merchant-wide order browsing across employees — local-DB, paginated,
 * server-filtered. This is the "All employees" case of the Orders page's
 * employee filter (see app/_components/orders/OrderFilters.jsx); browsing
 * ONE specific employee's (or the merchant's own) orders still goes through
 * the existing LIVE per-provider endpoints
 * (app/api/orders/{ozon,quick}/route.js) unchanged — this route exists
 * because live-fetching N employees' tracking sequences one by one would be
 * slow and wasteful. Reads only the local `Order` mirror, same "aggregate
 * views read the DB, never the provider live" rule already used by
 * lib/commission/report.js and lib/orders/dashboard-stats.js.
 *
 * Merchant-only — an employee has nothing to browse "across employees".
 */
export async function GET(request) {
  const currentUser = await getCurrentUser();
  if (!currentUser) {
    return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  }
  if (currentUser.role !== USER_ROLES.MERCHANT) {
    return NextResponse.json(
      { error: "Only merchants can browse orders across employees." },
      { status: 403 }
    );
  }

  const searchParams = new URL(request.url).searchParams;

  const provider = searchParams.get("provider");
  if (!SHIPPING_PROVIDER_VALUES.includes(provider)) {
    return NextResponse.json({ error: "A valid `provider` is required." }, { status: 400 });
  }

  const requestedEmployeeId = searchParams.get("employeeId");
  let employeeId = null;
  if (requestedEmployeeId) {
    const owned = await findOwnedEmployee(requestedEmployeeId, currentUser.id);
    if (!owned) {
      return NextResponse.json({ error: "Employee not found." }, { status: 404 });
    }
    employeeId = requestedEmployeeId;
  }

  const requestedPeriod = searchParams.get("period");
  const period = requestedPeriod && isValidPeriod(requestedPeriod) ? requestedPeriod : null;

  const requestedStatus = searchParams.get("status");
  const statusFilter = ORDER_STATUS_FILTER_VALUES.includes(requestedStatus) ? requestedStatus : "all";

  const page = Math.max(1, Number.parseInt(searchParams.get("page"), 10) || 1);
  const pageSize = Math.min(
    MAX_PAGE_SIZE,
    Math.max(1, Number.parseInt(searchParams.get("pageSize"), 10) || DEFAULT_PAGE_SIZE)
  );

  await connectToDatabase();

  const filter = { merchantId: currentUser.id, provider };
  if (employeeId) filter.employeeId = employeeId;
  // Same anchored-prefix convention as lib/commission/report.js — an
  // order's tracking number, not createdAt, decides which month it's in.
  if (period) filter.numericTrackingNumber = { $regex: `^${period}` };

  // "Tous"/"Livré"/"Progress"/"Retour" — see lib/orders/status-groups.js.
  // "Livré" reuses `deliveredAt` (set once, authoritative — the same field
  // lib/orders/dashboard-stats.js and lib/commission/report.js already
  // treat as the real "was this ever delivered" fact, never re-derived from
  // status text here). "Retour" matches `lastKnownStatus` against the
  // SAME canonical token list status-groups.js exports — a
  // case/diacritic-insensitive collation on the query does the equivalent
  // of that module's own JS normalization, so there is exactly one
  // definition of "what counts as a return", not two.
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

  const [orders, total] = await Promise.all([
    withCollation(
      Order.find(filter)
        .select(
          "employeeId provider trackingNumber receiverName phone city address productNature price lastKnownStatus deliveredAt createdAt"
        )
        .sort({ createdAt: -1 })
        .skip((page - 1) * pageSize)
        .limit(pageSize)
        .populate({ path: "employeeId", select: "name username" })
    ).lean(),
    withCollation(Order.countDocuments(filter)),
  ]);

  return NextResponse.json({
    orders: orders.map((order) => ({
      id: String(order._id),
      trackingNumber: order.trackingNumber,
      employee: order.employeeId
        ? { id: String(order.employeeId._id), name: order.employeeId.name, username: order.employeeId.username }
        : null,
      receiver: order.receiverName,
      phone: order.phone,
      city: order.city,
      address: order.address,
      product: order.productNature,
      price: order.price,
      status: order.lastKnownStatus,
      deliveredAt: order.deliveredAt,
      createdAt: order.createdAt,
    })),
    page,
    pageSize,
    total,
    totalPages: Math.max(1, Math.ceil(total / pageSize)),
  });
}
