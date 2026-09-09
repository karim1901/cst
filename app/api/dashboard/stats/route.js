import { NextResponse } from "next/server";

import { connectToDatabase } from "@/lib/mongodb";
import { getCurrentUser } from "@/lib/auth/current-user";
import { USER_ROLES } from "@/models/User";
import { SHIPPING_PROVIDER_VALUES } from "@/lib/shipping/providers";
import { computeOrderDeliveryStats } from "@/lib/orders/dashboard-stats";
import { isValidPeriod } from "@/lib/tracking/counter";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Provider- and month-scoped dashboard statistics (see
 * lib/orders/dashboard-stats.js's module comment for the exact counting
 * rules, unchanged). `provider` is REQUIRED — the whole point of this
 * route is that Ozon Express and Quick Livraison numbers are never
 * combined (see app/dashboard/page.jsx's module comment). `period`
 * ("YYYYMM") is optional; omitted means all-time.
 *
 * Same ownership/authorization rule as every other order-scoped route in
 * this app: a merchant sees every order under their own account
 * (including employees'); an employee sees only their own. `provider` and
 * `period` are read from the query string but always VALIDATED against a
 * fixed allow-list before use — never trusted/interpolated as-is (see item
 * 11/34's explicit "never trust client input" requirement).
 */
export async function GET(request) {
  const currentUser = await getCurrentUser();
  if (!currentUser) {
    return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  }
  if (currentUser.role !== USER_ROLES.MERCHANT && currentUser.role !== USER_ROLES.EMPLOYEE) {
    return NextResponse.json({ error: "Only merchants and employees have order statistics." }, { status: 403 });
  }

  const searchParams = new URL(request.url).searchParams;

  const requestedProvider = searchParams.get("provider");
  if (!SHIPPING_PROVIDER_VALUES.includes(requestedProvider)) {
    return NextResponse.json({ error: "A valid provider is required." }, { status: 400 });
  }

  const requestedPeriod = searchParams.get("period");
  const period = isValidPeriod(requestedPeriod) ? requestedPeriod : null;

  await connectToDatabase();

  const stats = await computeOrderDeliveryStats({
    merchantId: currentUser.role === USER_ROLES.EMPLOYEE ? currentUser.merchantId : currentUser.id,
    employeeId: currentUser.role === USER_ROLES.EMPLOYEE ? currentUser.id : null,
    provider: requestedProvider,
    period,
  });

  return NextResponse.json({ provider: requestedProvider, period, stats });
}
