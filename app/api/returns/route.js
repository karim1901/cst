import { NextResponse } from "next/server";

import { getCurrentUser } from "@/lib/auth/current-user";
import { USER_ROLES } from "@/models/User";
import { findOwnedEmployee } from "@/lib/employees";
import { queryOrdersForSection, getSectionCounts } from "@/lib/returns/list";
import { resolveDeliveryDateRange } from "@/lib/returns/delivery-date";
import { isValidPeriod } from "@/lib/tracking/counter";
import { SHIPPING_PROVIDER_VALUES } from "@/lib/shipping/providers";
import {
  SHIPPING_STATUS_FILTER_VALUES,
  RETURN_VALIDATION_FILTER_VALUES,
  ORDER_LIFECYCLE_SECTIONS,
  ORDER_LIFECYCLE_SECTION_VALUES,
  DELIVERY_DATE_FILTER_VALUES,
} from "@/lib/returns/constants";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DEFAULT_PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 50;

/**
 * Order-lifecycle page (app/dashboard/returns) — 3 sections, all reading
 * the local `Order` mirror ONLY (fast, never calls a shipping provider on
 * this request; see app/api/returns/sync/route.js for that, a separate,
 * explicitly-triggered job):
 *
 *  - "all" (default)  — every order in the selected month (or every order,
 *    unscoped, if "All Months" is explicitly chosen), any status.
 *  - "delivered"       — orders whose `deliveredAt` is set, optionally
 *    narrowed by `employeeId` (ownership-validated below — never trusted
 *    from the client) and/or a delivery-date range (see
 *    lib/returns/delivery-date.js; always against `deliveredAt`, never
 *    `createdAt`) — AND the selected month (both apply together).
 *  - "returns"          — the ORIGINAL Returns feature: cancelled/refused/
 *    returned orders, filterable by shipping-status reason and by the
 *    merchant's own internal validation state — AND the selected month.
 *
 * Month (`period`) is a GLOBAL filter across all 3 sections, including the
 * 3 tab badge counts (see `getSectionCounts` — lib/returns/list.js's own
 * comment has the full root-cause story of why this matters).
 *
 * Merchant-only, same rule as Follow-up (app/api/order-followups) and the
 * "all employees" order browser this mirrors the shape of
 * (app/api/orders/route.js) — an employee has no cross-employee order
 * management to do here.
 */
export async function GET(request) {
  const currentUser = await getCurrentUser();
  if (!currentUser) {
    return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  }
  if (currentUser.role !== USER_ROLES.MERCHANT) {
    return NextResponse.json({ error: "Only merchants can manage orders here." }, { status: 403 });
  }

  const searchParams = new URL(request.url).searchParams;

  // Provider separation — REQUIRED, never a combined Ozon+Quick query (see
  // lib/returns/list.js's own comment). Validated against a fixed
  // allow-list, never trusted as-is from the client (item 11/34).
  const requestedProvider = searchParams.get("provider");
  if (!SHIPPING_PROVIDER_VALUES.includes(requestedProvider)) {
    return NextResponse.json({ error: "A valid provider is required." }, { status: 400 });
  }

  const requestedSection = searchParams.get("section");
  const section = ORDER_LIFECYCLE_SECTION_VALUES.includes(requestedSection)
    ? requestedSection
    : ORDER_LIFECYCLE_SECTIONS.ALL;

  const requestedShippingStatus = searchParams.get("shippingStatus");
  const shippingStatus = SHIPPING_STATUS_FILTER_VALUES.includes(requestedShippingStatus)
    ? requestedShippingStatus
    : "all";

  const requestedValidation = searchParams.get("validation");
  const validation = RETURN_VALIDATION_FILTER_VALUES.includes(requestedValidation)
    ? requestedValidation
    : "all";

  // Employee filter — Delivered section only, and ONLY after confirming the
  // id actually belongs to this merchant (never trust a client-supplied
  // employeeId for authorization — same rule as
  // app/api/orders/route.js/app/api/orders/{ozon,quick}/route.js).
  let employeeId = null;
  if (section === ORDER_LIFECYCLE_SECTIONS.DELIVERED) {
    const requestedEmployeeId = searchParams.get("employeeId");
    if (requestedEmployeeId) {
      const owned = await findOwnedEmployee(requestedEmployeeId, currentUser.id);
      if (!owned) {
        return NextResponse.json({ error: "Employee not found." }, { status: 404 });
      }
      employeeId = requestedEmployeeId;
    }
  }

  // Delivery-date filter — Delivered section only.
  let deliveryDateRange = null;
  if (section === ORDER_LIFECYCLE_SECTIONS.DELIVERED) {
    const requestedDeliveryDate = searchParams.get("deliveryDate");
    const deliveryDateFilter = DELIVERY_DATE_FILTER_VALUES.includes(requestedDeliveryDate)
      ? requestedDeliveryDate
      : "all";
    deliveryDateRange = resolveDeliveryDateRange(deliveryDateFilter, {
      date: searchParams.get("customDate"),
      start: searchParams.get("customStart"),
      end: searchParams.get("customEnd"),
    });
  }

  // Month filter — GLOBAL, applies to EVERY section including "delivered"
  // now (month-filter fix — see lib/returns/list.js's own comment for the
  // full root-cause story, including why the 3 tab badge counts needed the
  // exact same fix). "All Months" = no `period` param at all. Same "YYYYMM"
  // tracking-number-derived month convention as app/api/orders/route.js.
  const requestedPeriod = searchParams.get("period");
  const period = isValidPeriod(requestedPeriod) ? requestedPeriod : null;

  const page = Math.max(1, Number.parseInt(searchParams.get("page"), 10) || 1);
  const pageSize = Math.min(
    MAX_PAGE_SIZE,
    Math.max(1, Number.parseInt(searchParams.get("pageSize"), 10) || DEFAULT_PAGE_SIZE)
  );

  const [{ returns, total }, counts] = await Promise.all([
    queryOrdersForSection(currentUser.id, {
      provider: requestedProvider,
      section,
      shippingStatus,
      validation,
      employeeId,
      deliveryDateRange,
      period,
      page,
      pageSize,
    }),
    getSectionCounts(currentUser.id, requestedProvider, period),
  ]);

  return NextResponse.json({
    provider: requestedProvider,
    section,
    returns,
    page,
    pageSize,
    total,
    totalPages: Math.max(1, Math.ceil(total / pageSize)),
    counts,
  });
}
