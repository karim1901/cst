import { NextResponse } from "next/server";

import { getCurrentUser } from "@/lib/auth/current-user";
import { USER_ROLES } from "@/models/User";
import { periodFor, isValidPeriod } from "@/lib/tracking/counter";
import { SHIPPING_PROVIDERS } from "@/lib/shipping/providers";
import { computeCommissionReport } from "@/lib/commission/report";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * The authenticated EMPLOYEE's commission for one month, split by shipping
 * provider — the data behind the Dashboard's "Total Commission" section.
 *
 * This is a pure CONSUMER of the existing commission service
 * (lib/commission/report.js#computeCommissionReport — the exact same
 * calculation the Commission page uses). Nothing about the business rules
 * is re-implemented here: delivered-only, the tracking-number month rule,
 * price-based units, the employee's own threshold, the
 * threshold-picks-one-rate-for-all-units rule, and — critically — PROVIDER
 * SEPARATION are all applied by that service, unchanged. Ozon Express and
 * Quick Livraison are computed as two completely separate provider-scoped
 * reports; `total` is only their SUM, never a combined-units calculation.
 *
 * Scope (item 5): `merchantId` and `employeeId` are BOTH taken from the
 * server-verified session — never from the request. There is no parameter
 * that can point this at another employee. `period` is the only client
 * input and is validated against a fixed "YYYYMM" shape.
 */
export async function GET(request) {
  const currentUser = await getCurrentUser();
  if (!currentUser) {
    return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  }
  if (currentUser.role !== USER_ROLES.EMPLOYEE) {
    return NextResponse.json(
      { error: "Only employees have a commission dashboard." },
      { status: 403 }
    );
  }

  const requestedPeriod = new URL(request.url).searchParams.get("period");
  const period = isValidPeriod(requestedPeriod) ? requestedPeriod : periodFor();

  const scope = {
    merchantId: currentUser.merchantId,
    employeeId: currentUser.id,
    period,
  };

  // Two independent, provider-scoped reports — computed separately, added
  // only at the very end (item 9/10/17).
  const [ozonReport, quickReport] = await Promise.all([
    computeCommissionReport({ ...scope, provider: SHIPPING_PROVIDERS.OZON_EXPRESS }),
    computeCommissionReport({ ...scope, provider: SHIPPING_PROVIDERS.QUICK_LIVRAISON }),
  ]);

  // The employee branch of computeCommissionReport returns a 1-element
  // array (this employee's row) — or empty if the employee record somehow
  // isn't found. `totalCommission` is a plain DH amount, or null when the
  // employee has no commission configuration.
  function pick(report) {
    const row = report[0] ?? null;
    return {
      commission: row?.totalCommission ?? 0,
      configured: row?.configured ?? false,
      deliveredOrders: row?.deliveredOrders ?? 0,
      commissionUnits: row?.commissionUnits ?? 0,
      // Delivered orders whose stored price is not a usable amount — they
      // contribute 0 units (never a phantom 1). Surfaced so the UI can
      // explain a low unit count instead of it silently vanishing.
      unknownPriceOrders: row?.unknownPriceOrders ?? 0,
      threshold: row?.threshold ?? null,
      commissionRate: row?.commissionRate ?? null,
    };
  }

  const ozon = pick(ozonReport);
  const quick = pick(quickReport);

  return NextResponse.json({
    period,
    ozon,
    quick,
    total: ozon.commission + quick.commission,
    unknownPriceOrders: ozon.unknownPriceOrders + quick.unknownPriceOrders,
  });
}
