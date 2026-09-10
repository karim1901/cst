import { NextResponse } from "next/server";

import { connectToDatabase } from "@/lib/mongodb";
import { getCurrentUser } from "@/lib/auth/current-user";
import { USER_ROLES } from "@/models/User";
import { SHIPPING_PROVIDER_VALUES } from "@/lib/shipping/providers";
import { isValidPeriod, periodFor } from "@/lib/tracking/counter";
import { calculateMonthlyFinancials } from "@/lib/finance/calculate";
import { centsToDh } from "@/lib/finance/money";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// DH-money keys converted from *Cents at the response boundary — the
// calculation itself (lib/finance/calculate.js) stays entirely
// integer-centime, decimal-safe (item 29); the frontend only ever needs a
// display-ready number.
const MONEY_KEYS = [
  "revenueCents",
  "adSpendCents",
  "productCostCents",
  "shippingCostCents",
  "otherExpenseCents",
  "totalCostCents",
  "profitCents",
  "returnValueCents",
];
const RATIO_MONEY_KEYS = [
  "adCostPerOrderCents",
  "adCostPerDeliveredCents",
  "profitPerDeliveredCents",
  "averageOrderValueCents",
];

function serializeRow(row) {
  const out = { ...row };
  for (const key of MONEY_KEYS) {
    if (key in out) out[key.replace(/Cents$/, "")] = centsToDh(out[key]);
    delete out[key];
  }
  delete out.orderRows; // day rows stay compact for the month-wide `days` list
  return out;
}

/**
 * Provider- and month-scoped financial statistics — see
 * lib/finance/calculate.js#calculateMonthlyFinancials, the ONE centralized
 * calculation this route (and nothing else) exposes. `provider` is
 * REQUIRED (never combined — item 4/16); `period` defaults to the current
 * month. Merchant-only, same ownership rule as the rest of Finance.
 */
export async function GET(request) {
  const currentUser = await getCurrentUser();
  if (!currentUser) {
    return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  }
  if (currentUser.role !== USER_ROLES.MERCHANT) {
    return NextResponse.json({ error: "Only merchants can view Finance." }, { status: 403 });
  }

  const searchParams = new URL(request.url).searchParams;

  const requestedProvider = searchParams.get("provider");
  if (!SHIPPING_PROVIDER_VALUES.includes(requestedProvider)) {
    return NextResponse.json({ error: "A valid provider is required." }, { status: 400 });
  }

  const requestedPeriod = searchParams.get("period");
  const period = isValidPeriod(requestedPeriod) ? requestedPeriod : periodFor();

  await connectToDatabase();

  const result = await calculateMonthlyFinancials(currentUser.id, requestedProvider, period);

  const totals = serializeRow(result.totals);
  const ratios = { ...result.ratios };
  for (const key of RATIO_MONEY_KEYS) {
    ratios[key.replace(/Cents$/, "")] = ratios[key] != null ? centsToDh(ratios[key]) : null;
    delete ratios[key];
  }
  const days = result.days.map((day) => ({
    ...serializeRow(day),
    // Per-order detail IS wanted for the Daily view's expandable card, but
    // each order's own money fields also need cents->DH conversion.
    orderRows: day.orderRows?.map((o) => ({
      ...o,
      price: centsToDh(o.priceCents),
      revenue: centsToDh(o.revenueCents),
      productCost: o.productCostCents != null ? centsToDh(o.productCostCents) : null,
      shippingCost: o.shippingCostCents != null ? centsToDh(o.shippingCostCents) : null,
      priceCents: undefined,
      revenueCents: undefined,
      productCostCents: undefined,
      shippingCostCents: undefined,
    })),
  }));

  return NextResponse.json({
    provider: result.provider,
    period: result.period,
    totals,
    ratios,
    days,
  });
}
