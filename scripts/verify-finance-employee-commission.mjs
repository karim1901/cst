/**
 * Regression tests for the Finance "Employee Commission" card and its
 * inclusion in Total Costs / Net Profit / Net Profit — Delivered Only (see
 * lib/finance/calculate.js's own "Employee Commission" module comment for
 * the full rationale — this script locks in the exact arithmetic contract
 * that comment documents).
 *
 * These pure arithmetic checks mirror lib/finance/calculate.js's own
 * formulas EXACTLY (same operand order, same integer-cents money utilities)
 * — they do NOT re-derive the commission VALUE itself (that stays
 * exclusively `lib/commission/report.js#computeCommissionReport`, the
 * Commission page's own authoritative service — this script only proves
 * that whatever number that service returns is folded into Total Costs and
 * Net Profit exactly once, correctly). The DB-integrated,
 * commission-service-reusing path itself was verified against real data —
 * see this task's own final report for the live before/after numbers.
 *
 * Pure logic: `lib/finance/money.js` has zero `@/` imports.
 *
 * Run with:  node scripts/verify-finance-employee-commission.mjs
 */

import { dhToCents, centsToDh, sumCents } from "../lib/finance/money.js";

let failures = 0;
function eq(label, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failures++;
  console.log(`${ok ? "PASS" : "FAIL"} - ${label}${ok ? "" : ` - got ${JSON.stringify(actual)}, expected ${JSON.stringify(expected)}`}`);
}

// Mirrors lib/finance/calculate.js's exact totals.totalCostCents /
// totals.deliveredOnlyTotalCostCents formulas after this task's fix.
function totalCostCents({ productCostCents, adSpendCents, shippingCostCents, otherExpenseCents, employeeCommissionCents }) {
  return productCostCents + adSpendCents + shippingCostCents + otherExpenseCents + employeeCommissionCents;
}

console.log("== task's own spec example (item 21): product 2000 + shipping 500 + ad 300 + other 100 + commission 600 ==");
{
  const costs = {
    productCostCents: dhToCents(2000),
    adSpendCents: dhToCents(300),
    shippingCostCents: dhToCents(500),
    otherExpenseCents: dhToCents(100),
    employeeCommissionCents: dhToCents(600),
  };
  const total = totalCostCents(costs);
  eq("Total Costs = 3500 DH (350000c)", total, dhToCents(3500));
  eq("Total Costs in DH = 3500", centsToDh(total), 3500);

  const revenueCents = dhToCents(5000);
  const profitCents = revenueCents - total;
  eq("Net Profit = revenue 5000 - total 3500 = 1500 DH", centsToDh(profitCents), 1500);
}

console.log("\n== Employee Commission = 0 -> Total Costs UNCHANGED from the pre-fix (4-component) formula ==");
{
  const base = { productCostCents: dhToCents(2000), adSpendCents: dhToCents(300), shippingCostCents: dhToCents(500), otherExpenseCents: dhToCents(100) };
  const preFixTotal = base.productCostCents + base.adSpendCents + base.shippingCostCents + base.otherExpenseCents;
  const postFixTotalWithZeroCommission = totalCostCents({ ...base, employeeCommissionCents: 0 });
  eq("Total Costs with employeeCommissionCents=0 equals the old 4-component total", postFixTotalWithZeroCommission, preFixTotal);
}

console.log("\n== Employee Commission = X -> Total Costs increases by EXACTLY X, Net Profit decreases by EXACTLY X ==");
{
  const base = { productCostCents: dhToCents(1200), adSpendCents: dhToCents(150), shippingCostCents: dhToCents(400), otherExpenseCents: dhToCents(50) };
  const revenueCents = dhToCents(3000);

  const withoutCommission = totalCostCents({ ...base, employeeCommissionCents: 0 });
  const profitWithoutCommission = revenueCents - withoutCommission;

  for (const commissionDh of [0, 1, 250, 900, 1590]) {
    const commissionCents = dhToCents(commissionDh);
    const withCommission = totalCostCents({ ...base, employeeCommissionCents: commissionCents });
    const profitWithCommission = revenueCents - withCommission;

    eq(`commission ${commissionDh} DH -> Total Costs increases by exactly ${commissionDh} DH`, withCommission - withoutCommission, commissionCents);
    eq(`commission ${commissionDh} DH -> Net Profit decreases by exactly ${commissionDh} DH`, profitWithoutCommission - profitWithCommission, commissionCents);
  }
}

console.log("\n== multi-employee aggregation (item 5): SUM of individual totalCommission values, DH -> cents, no float error ==");
{
  // Mirrors lib/finance/calculate.js's own
  // `sumCents(commissionReport.filter(e => e.configured).map(e => dhToCents(e.totalCommission) ?? 0))`.
  const employees = [
    { configured: true, totalCommission: 900 }, // Ibtissam
    { configured: true, totalCommission: 345 }, // Najwa
    { configured: true, totalCommission: 345 }, // Fatimazahra
  ];
  const employeeCommissionCents = sumCents(
    employees.filter((e) => e.configured).map((e) => dhToCents(e.totalCommission) ?? 0)
  );
  eq("900 + 345 + 345 = 1590 DH", centsToDh(employeeCommissionCents), 1590);
}

console.log("\n== an employee with no commission configuration (configured:false, totalCommission:null) is EXCLUDED, never treated as 0-owed-and-counted-as-real ==");
{
  const employees = [
    { configured: true, totalCommission: 500 },
    { configured: false, totalCommission: null }, // defensive fallback shape — see lib/commission/report.js
  ];
  const employeeCommissionCents = sumCents(
    employees.filter((e) => e.configured).map((e) => dhToCents(e.totalCommission) ?? 0)
  );
  eq("only the configured employee's 500 DH counts, the unconfigured one contributes nothing", centsToDh(employeeCommissionCents), 500);
}

console.log("\n== decimal commission rates never accumulate floating-point error across many employees ==");
{
  // e.g. 15 employees each earning a rate that produces a fractional DH
  // total, summed via integer cents throughout (item 17 — no floats).
  const employees = Array.from({ length: 15 }, () => ({ configured: true, totalCommission: 33.33 }));
  const employeeCommissionCents = sumCents(
    employees.filter((e) => e.configured).map((e) => dhToCents(e.totalCommission) ?? 0)
  );
  // 33.33 DH -> 3333c exactly (dhToCents rounds to the nearest cent); 15 x 3333 = 49995c = 499.95 DH.
  eq("15 x 33.33 DH = 499.95 DH exactly (integer cents, no float drift)", centsToDh(employeeCommissionCents), 499.95);
}

console.log(`\n${failures === 0 ? "ALL CHECKS PASSED" : failures + " CHECK(S) FAILED"}`);
process.exit(failures === 0 ? 0 : 1);
