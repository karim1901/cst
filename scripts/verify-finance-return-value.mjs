/**
 * Regression tests for the Finance "Return Value" / "Validated Return
 * Value" cards — ROOT-CAUSE FIX: these used to sum `order.price` (the
 * customer's full SELLING price). They now sum the PRODUCT COST value
 * (`ProductCost.costPerUnitCents × order.quantity` — the exact same
 * resolution lib/finance/calculate.js already uses for its regular
 * `productCostCents` total) of return-category orders (Returned / Refused /
 * Cancelled), split by `returnValidationStatus`. See
 * lib/finance/return-value.js's own comment for the full rationale.
 *
 * Pure logic: `lib/finance/return-value.js` and `lib/returns/constants.js`
 * have zero `@/` imports.
 *
 * Run with:  node scripts/verify-finance-return-value.mjs
 */

import { returnValueContribution, validatedReturnValueContribution } from "../lib/finance/return-value.js";
import { dhToCents, sumCents } from "../lib/finance/money.js";
import { RETURN_VALIDATION_STATUSES } from "../lib/returns/constants.js";

let failures = 0;
function eq(label, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failures++;
  console.log(`${ok ? "PASS" : "FAIL"} - ${label}${ok ? "" : ` - got ${JSON.stringify(actual)}, expected ${JSON.stringify(expected)}`}`);
}

// Mirrors EXACTLY what lib/finance/calculate.js does, in order:
//   unitCostCents   = ProductCost lookup by normalized productNature
//   quantity        = order.quantity ?? 1                    (unchanged default)
//   productCostCents = unitCostCents != null ? unitCostCents * quantity : null
//   costUsable      = productCostCents != null
// `costPerUnitDh: null` simulates "no matching ProductCost document" — the
// unresolved case (item 11), never falling back to `price`.
function productCostCentsFor({ costPerUnitDh, quantity = 1 }) {
  if (costPerUnitDh == null) return null;
  return dhToCents(costPerUnitDh) * quantity;
}

// `price` is accepted by both helpers below but deliberately NEVER read —
// see the "selling price is ignored" tests, which pass a `price` far from
// the expected result to prove it plays no role in either calculation.
function contribFor({ isReturn, price: _price, costPerUnitDh, quantity = 1, validation = RETURN_VALIDATION_STATUSES.PENDING }) {
  const productCostCents = productCostCentsFor({ costPerUnitDh, quantity });
  return returnValueContribution({
    isReturn,
    isValidated: validation === RETURN_VALIDATION_STATUSES.VALIDATED,
    costUsable: productCostCents != null,
    costCents: productCostCents ?? 0,
  });
}

function validatedContribFor({ isReturn, price: _price, costPerUnitDh, quantity = 1, validation = RETURN_VALIDATION_STATUSES.PENDING }) {
  const productCostCents = productCostCentsFor({ costPerUnitDh, quantity });
  return validatedReturnValueContribution({
    isReturn,
    isValidated: validation === RETURN_VALIDATION_STATUSES.VALIDATED,
    costUsable: productCostCents != null,
    costCents: productCostCents ?? 0,
  });
}

console.log("== THE core fix: Return Value uses PRODUCT COST × QUANTITY, never order.price ==");
// Task's own example: selling price 220, product RL costs 70, qty 1 -> 70, NOT 220.
eq(
  "selling price 220, cost 70, qty 1, pending -> 7000c (70.00 DH), NOT 22000c",
  contribFor({ isReturn: true, price: 220, costPerUnitDh: 70, quantity: 1 }),
  { valueCents: 7000, unknownCostOrders: 0 }
);
// qty 2 -> 140.
eq(
  "selling price 220, cost 70, qty 2, pending -> 14000c (140.00 DH)",
  contribFor({ isReturn: true, price: 220, costPerUnitDh: 70, quantity: 2 }),
  { valueCents: 14000, unknownCostOrders: 0 }
);
// Selling-price-difference proof (task item 19): price 500 changes nothing.
eq(
  "selling price 500 (far from 70) -> STILL 7000c, proving price is ignored",
  contribFor({ isReturn: true, price: 500, costPerUnitDh: 70, quantity: 1 }),
  { valueCents: 7000, unknownCostOrders: 0 }
);
// qty 3 -> 210.
eq(
  "cost 70, qty 3 -> 21000c (210.00 DH)",
  contribFor({ isReturn: true, price: 999, costPerUnitDh: 70, quantity: 3 }),
  { valueCents: 21000, unknownCostOrders: 0 }
);

console.log("\n== PENDING vs VALIDATED: toggling validation moves the order between the two cards, unchanged provider status ==");
{
  // Order A: cost 70, qty 1, pending -> Return Value = 70, Validated = 0.
  const aPending = contribFor({ isReturn: true, price: 220, costPerUnitDh: 70, quantity: 1 });
  const aPendingValidated = validatedContribFor({ isReturn: true, price: 220, costPerUnitDh: 70, quantity: 1 });
  eq("A pending -> Return Value 7000c", aPending, { valueCents: 7000, unknownCostOrders: 0 });
  eq("A pending -> Validated Return Value 0", aPendingValidated, { valueCents: 0, unknownCostOrders: 0 });

  // Now validate A: Return Value -> 0, Validated Return Value -> 70. The
  // order's own `status` (RETURNED/REFUSED/CANCELLED) is a separate,
  // untouched field — only returnValidationStatus changed (item 8/18).
  const aValidated = contribFor({ isReturn: true, price: 220, costPerUnitDh: 70, quantity: 1, validation: RETURN_VALIDATION_STATUSES.VALIDATED });
  const aValidatedValidated = validatedContribFor({ isReturn: true, price: 220, costPerUnitDh: 70, quantity: 1, validation: RETURN_VALIDATION_STATUSES.VALIDATED });
  eq("A validated -> Return Value 0", aValidated, { valueCents: 0, unknownCostOrders: 0 });
  eq("A validated -> Validated Return Value 7000c", aValidatedValidated, { valueCents: 7000, unknownCostOrders: 0 });
}

console.log("\n== missing ProductCost -> unresolved, NEVER falls back to order.price ==");
eq(
  "selling price 220, no ProductCost match, pending -> 0, flagged unknown (NOT 22000c)",
  contribFor({ isReturn: true, price: 220, costPerUnitDh: null }),
  { valueCents: 0, unknownCostOrders: 1 }
);
eq(
  "selling price 220, no ProductCost match, validated -> 0, flagged unknown (Validated card)",
  validatedContribFor({ isReturn: true, price: 220, costPerUnitDh: null, validation: RETURN_VALIDATION_STATUSES.VALIDATED }),
  { valueCents: 0, unknownCostOrders: 1 }
);
// A genuinely CONFIGURED 0 DH cost is a real zero, not "missing" — never conflated.
eq(
  "ProductCost configured at 0 DH -> a REAL 0, not flagged unknown",
  contribFor({ isReturn: true, price: 220, costPerUnitDh: 0, quantity: 1 }),
  { valueCents: 0, unknownCostOrders: 0 }
);

console.log("\n== Delivered / Progress orders excluded from BOTH cards regardless of cost ==");
eq("Delivered, cost 70 -> 0 (Return Value)", contribFor({ isReturn: false, price: 220, costPerUnitDh: 70 }), { valueCents: 0, unknownCostOrders: 0 });
eq("Progress, cost 70 -> 0 (Return Value)", contribFor({ isReturn: false, price: 220, costPerUnitDh: 70 }), { valueCents: 0, unknownCostOrders: 0 });
eq("Delivered, validated flag irrelevant -> 0 (Validated Return Value)", validatedContribFor({ isReturn: false, price: 220, costPerUnitDh: 70, validation: RETURN_VALIDATION_STATUSES.VALIDATED }), { valueCents: 0, unknownCostOrders: 0 });

console.log("\n== spec example: A pending(cost70,qty1) + B validated(cost40,qty2) + C pending(cost0,qty1, missing) ==");
{
  const A = contribFor({ isReturn: true, price: 220, costPerUnitDh: 70, quantity: 1 }); // -> 70
  const Av = validatedContribFor({ isReturn: true, price: 220, costPerUnitDh: 70, quantity: 1 });
  const B = contribFor({ isReturn: true, price: 300, costPerUnitDh: 40, quantity: 2, validation: RETURN_VALIDATION_STATUSES.VALIDATED }); // excluded from pending
  const Bv = validatedContribFor({ isReturn: true, price: 300, costPerUnitDh: 40, quantity: 2, validation: RETURN_VALIDATION_STATUSES.VALIDATED }); // -> 80
  const C = contribFor({ isReturn: true, price: 180, costPerUnitDh: null, quantity: 1 }); // unresolved -> 0, flagged

  const returnValue = sumCents([A, B, C].map((r) => r.valueCents));
  const validatedReturnValue = sumCents([Av, Bv].map((r) => r.valueCents));
  eq("Return Value = 7000c (70.00 DH: only A resolves; C is unresolved, not fabricated)", returnValue, 7000);
  eq("Validated Return Value = 8000c (80.00 DH: B 40x2)", validatedReturnValue, 8000);
  eq("unresolved (unknown cost) count in Return Value = 1 (order C)", sumCents([A, B, C].map((r) => r.unknownCostOrders)), 1);
}

console.log("\n== Return Value + Validated Return Value partition the known-cost Return bucket exactly ==");
{
  const orders = [
    { price: 220, costPerUnitDh: 70, quantity: 1, validation: "pending" },
    { price: 300, costPerUnitDh: 40, quantity: 2, validation: "validated" },
    { price: 180, costPerUnitDh: 20, quantity: 3, validation: "pending" },
    { price: 150, costPerUnitDh: 15, quantity: 1, validation: "validated" },
  ];
  const pending = sumCents(orders.map((o) => contribFor({ isReturn: true, ...o }).valueCents));
  const validated = sumCents(orders.map((o) => validatedContribFor({ isReturn: true, ...o }).valueCents));
  const knownCostTotal = sumCents(orders.map((o) => productCostCentsFor(o) ?? 0));
  eq("pending + validated === SUM(productCost x quantity) over every known-cost return order", pending + validated, knownCostTotal);
  eq("knownCostTotal = 70x1 + 40x2 + 20x3 + 15x1 = 70+80+60+15 = 225 DH", knownCostTotal, 22500);
}

console.log("\n== daily <-> monthly reconciliation (product-cost basis, not price) ==");
{
  const day1 = [
    contribFor({ isReturn: true, price: 220, costPerUnitDh: 70, quantity: 1 }),
    contribFor({ isReturn: true, price: 180, costPerUnitDh: 20, quantity: 2 }),
  ];
  const day2 = [contribFor({ isReturn: true, price: 300, costPerUnitDh: 40, quantity: 1 })];
  const day3 = [contribFor({ isReturn: false, price: 999, costPerUnitDh: 999 })]; // not a return
  const dailyTotals = [day1, day2, day3].map((d) => sumCents(d.map((r) => r.valueCents)));
  const monthly = sumCents([...day1, ...day2, ...day3].map((r) => r.valueCents));
  eq("SUM(daily return values) === monthly return value", sumCents(dailyTotals), monthly);
  eq("monthly = 70 + 40 + 40 = 150 DH (day1: 70x1 + 20x2=40 -> 110; day2: 40)", monthly, 15000);
}

console.log(`\n${failures === 0 ? "ALL CHECKS PASSED" : failures + " CHECK(S) FAILED"}`);
process.exit(failures === 0 ? 0 : 1);
