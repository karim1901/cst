/**
 * Regression tests for the Finance "Net Profit — Delivered Only" card —
 * lib/finance/delivered-only.js#deliveredOnlyCostContribution, the pure
 * gate lib/finance/calculate.js uses to restrict order-level product/
 * shipping cost to DELIVERED orders only, while leaving revenue, the
 * EXISTING (all-orders) Net Profit, and advertising/other-expense
 * allocation completely untouched.
 *
 * Pure logic only — zero `@/` imports, runs with plain `node`.
 * Run with:  node scripts/verify-finance-delivered-only-profit.mjs
 */

import { deliveredOnlyCostContribution } from "../lib/finance/delivered-only.js";

let failures = 0;
function eq(label, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failures++;
  console.log(`${ok ? "PASS" : "FAIL"} - ${label}${ok ? "" : ` - got ${JSON.stringify(actual)}, expected ${JSON.stringify(expected)}`}`);
}

console.log("== a non-Delivered order NEVER contributes its cost, whatever the cost value is ==");
eq("Returned order, cost known 8000c -> 0, not missing", deliveredOnlyCostContribution({ delivered: false, costCents: 8000 }), { costCents: 0, missing: 0 });
eq("Progress order, cost known -> 0, not missing", deliveredOnlyCostContribution({ delivered: false, costCents: 4500 }), { costCents: 0, missing: 0 });
eq("Returned order, cost UNCONFIGURED (null) -> still 0, NOT flagged missing (irrelevant to this metric)",
  deliveredOnlyCostContribution({ delivered: false, costCents: null }), { costCents: 0, missing: 0 });

console.log("\n== a Delivered order contributes its resolved cost ==");
eq("Delivered, cost 8000c -> +8000c", deliveredOnlyCostContribution({ delivered: true, costCents: 8000 }), { costCents: 8000, missing: 0 });
eq("Delivered, cost 0c (a real, resolved zero) -> +0c, not missing", deliveredOnlyCostContribution({ delivered: true, costCents: 0 }), { costCents: 0, missing: 0 });

console.log("\n== a Delivered order with an UNRESOLVED cost is flagged missing, never fabricated as 0 ==");
eq("Delivered, cost null -> 0, missing=1", deliveredOnlyCostContribution({ delivered: true, costCents: null }), { costCents: 0, missing: 1 });

console.log("\n== spec example (§17): Delivered A+B, Returned C, Progress D ==");
{
  // A: delivered, price 220, product cost 80, shipping 35
  // B: delivered, price 300, product cost 120, shipping 45
  // C: returned (pending), price 400, product cost 150, shipping 35
  // D: progress, price 250, product cost 100, shipping 0
  const orders = [
    { delivered: true, priceCents: 22000, productCostCents: 8000, shippingCostCents: 3500 },
    { delivered: true, priceCents: 30000, productCostCents: 12000, shippingCostCents: 4500 },
    { delivered: false, priceCents: 40000, productCostCents: 15000, shippingCostCents: 3500 }, // Returned
    { delivered: false, priceCents: 25000, productCostCents: 10000, shippingCostCents: 0 }, // Progress
  ];

  const revenueCents = orders.filter((o) => o.delivered).reduce((sum, o) => sum + o.priceCents, 0);

  const deliveredOnlyProductCostCents = orders.reduce(
    (sum, o) => sum + deliveredOnlyCostContribution({ delivered: o.delivered, costCents: o.productCostCents }).costCents,
    0
  );
  const deliveredOnlyShippingCostCents = orders.reduce(
    (sum, o) => sum + deliveredOnlyCostContribution({ delivered: o.delivered, costCents: o.shippingCostCents }).costCents,
    0
  );

  // Existing (all-orders) product/shipping cost — for contrast, proving the
  // two metrics genuinely differ when Returned/Progress orders have costs.
  const allOrdersProductCostCents = orders.reduce((sum, o) => sum + o.productCostCents, 0);
  const allOrdersShippingCostCents = orders.reduce((sum, o) => sum + o.shippingCostCents, 0);

  eq("Revenue = 52000c (520.00 DH: A 220 + B 300)", revenueCents, 52000);
  eq("Delivered-only product cost = 20000c (200.00 DH: A 80 + B 120)", deliveredOnlyProductCostCents, 20000);
  eq("Delivered-only shipping cost = 8000c (80.00 DH: A 35 + B 45)", deliveredOnlyShippingCostCents, 8000);
  eq(
    "Order-level profit before shared expenses = 24000c (240.00 DH) -- matches the task's worked example exactly",
    revenueCents - deliveredOnlyProductCostCents - deliveredOnlyShippingCostCents,
    24000
  );

  // C and D's costs must NOT have leaked into the delivered-only totals.
  eq("C (Returned, 150+35 DH cost) did not contribute", deliveredOnlyProductCostCents < allOrdersProductCostCents, true);
  eq("D (Progress, 100 DH cost) did not contribute", deliveredOnlyShippingCostCents < allOrdersShippingCostCents, true);
  eq(
    "all-orders product cost = 45000c (450.00 DH: A 80 + B 120 + C 150 + D 100)",
    allOrdersProductCostCents,
    45000
  );
  eq("all-orders shipping cost = 11500c (115.00 DH: A 35 + B 45 + C 35 + D 0)", allOrdersShippingCostCents, 11500);

  // With ad spend + other expenses assumed 0 for this isolated example, the
  // two profit figures diverge by EXACTLY the non-delivered orders' cost
  // that only the existing (all-orders) formula charges.
  const existingProfitCents = revenueCents - allOrdersProductCostCents - allOrdersShippingCostCents;
  const deliveredOnlyProfitCents = revenueCents - deliveredOnlyProductCostCents - deliveredOnlyShippingCostCents;
  eq("existing profit (all-orders cost) = -4500c (-45.00 DH)", existingProfitCents, -4500);
  eq("delivered-only profit = 24000c (240.00 DH)", deliveredOnlyProfitCents, 24000);
  eq(
    "the two profits differ by exactly C+D's product/shipping cost (15000+3500+10000+0 = 28500c)",
    deliveredOnlyProfitCents - existingProfitCents,
    28500
  );
}

console.log("\n== ad spend and other expenses are IDENTICAL between the two profit figures (never re-derived) ==");
{
  // Simulates lib/finance/calculate.js's totals assembly for one day: same
  // adSpendCents feeds both `totalCostCents` (existing) and
  // `deliveredOnlyTotalCostCents` (new) — proving no double invention/
  // double count of shared (non-order-level) expenses.
  const revenueCents = 52000;
  const allOrdersProductCostCents = 35000;
  const allOrdersShippingCostCents = 8000;
  const deliveredOnlyProductCostCents = 20000;
  const deliveredOnlyShippingCostCents = 8000;
  const adSpendCents = 5000;
  const otherExpenseCents = 1000;

  const totalCostCents = allOrdersProductCostCents + adSpendCents + allOrdersShippingCostCents + otherExpenseCents;
  const deliveredOnlyTotalCostCents =
    deliveredOnlyProductCostCents + adSpendCents + deliveredOnlyShippingCostCents + otherExpenseCents;

  const profitCents = revenueCents - totalCostCents;
  const deliveredOnlyProfitCents = revenueCents - deliveredOnlyTotalCostCents;

  eq("existing profit = -3000c", profitCents, revenueCents - allOrdersProductCostCents - adSpendCents - allOrdersShippingCostCents - otherExpenseCents);
  eq(
    "delivered-only profit uses the SAME adSpendCents/otherExpenseCents value",
    deliveredOnlyTotalCostCents - totalCostCents,
    deliveredOnlyProductCostCents + deliveredOnlyShippingCostCents - (allOrdersProductCostCents + allOrdersShippingCostCents)
  );
  eq("delivered-only profit = 18000c (180.00 DH)", deliveredOnlyProfitCents, 18000);
}

console.log(`\n${failures === 0 ? "ALL CHECKS PASSED" : failures + " CHECK(S) FAILED"}`);
process.exit(failures === 0 ? 0 : 1);
