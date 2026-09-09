import { NextResponse } from "next/server";

import { getCurrentUser } from "@/lib/auth/current-user";
import { USER_ROLES } from "@/models/User";
import { periodFor, isValidPeriod } from "@/lib/tracking/counter";
import { SHIPPING_PROVIDER_VALUES } from "@/lib/shipping/providers";
import { computeCommissionReport } from "@/lib/commission/report";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Server-side employee commission report for one calendar month
 * (`?period=YYYYMM`, defaulting to the current month) and ONE provider
 * (`?provider=` — REQUIRED, validated against a fixed allow-list) — see
 * lib/commission/report.js for the calculation, lib/commission/calculate.js
 * for the business rules. Ozon Express and Quick Livraison are never
 * combined into one number here (see report.js's own comment).
 *
 * Two authorized callers, same endpoint, same underlying calculation
 * (`computeCommissionReport` — see its module comment):
 *  - A MERCHANT sees every one of their own employees — unchanged from
 *    before, same authorization boundary as GET /api/employees.
 *  - An EMPLOYEE sees ONLY their own row — `merchantId` AND `employeeId`
 *    both come from `currentUser` (the freshly-loaded, server-verified
 *    session user — see lib/auth/current-user.js), never from the request.
 *    There is no request parameter that can change whose id is used, so an
 *    employee can never request or influence another employee's numbers.
 * The client supplies only `period` and `provider`; every id, order, rate,
 * and total is derived server-side.
 */
export async function GET(request) {
  const currentUser = await getCurrentUser();

  if (!currentUser) {
    return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  }

  const searchParams = new URL(request.url).searchParams;

  const requestedPeriod = searchParams.get("period");
  const period = isValidPeriod(requestedPeriod) ? requestedPeriod : periodFor();

  const requestedProvider = searchParams.get("provider");
  if (!SHIPPING_PROVIDER_VALUES.includes(requestedProvider)) {
    return NextResponse.json({ error: "A valid provider is required." }, { status: 400 });
  }

  if (currentUser.role === USER_ROLES.MERCHANT) {
    const employees = await computeCommissionReport({
      merchantId: currentUser.id,
      period,
      provider: requestedProvider,
    });
    return NextResponse.json({ period, provider: requestedProvider, employees });
  }

  if (currentUser.role === USER_ROLES.EMPLOYEE) {
    // Scoped to exactly this employee, under their own merchant — both
    // values read from the server-verified session, never from the client.
    const employees = await computeCommissionReport({
      merchantId: currentUser.merchantId,
      period,
      provider: requestedProvider,
      employeeId: currentUser.id,
    });
    return NextResponse.json({ period, provider: requestedProvider, employees });
  }

  return NextResponse.json(
    { error: "Only merchants and employees can view commission reports." },
    { status: 403 }
  );
}
