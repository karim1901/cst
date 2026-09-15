/**
 * Regression tests for the Finance "Return Value" card — the total
 * monetary VALUE (order price) of return-category orders (Returned /
 * Refused / Cancelled) that are NOT yet physically validated. A reporting
 * metric that never touches profit/cost.
 *
 * Pure logic: `lib/finance/return-value.js`, `isUsableCommissionPrice` and
 * `lib/returns/constants.js` have zero `@/` imports.
 *
 * Run with:  node scripts/verify-finance-return-value.mjs
 */

import { returnValueContribution, validatedReturnValueContribution } from "../lib/finance/return-value.js";
import { isUsableCommissionPrice } from "../lib/commission/calculate.js";
import { dhToCents, sumCents } from "../lib/finance/money.js";
import { RETURN_VALIDATION_STATUSES } from "../lib/returns/constants.js";

let failures = 0;
function eq(label, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failures++;
  console.log(`${ok ? "PASS" : "FAIL"} - ${label}${ok ? "" : ` - got ${JSON.stringify(actual)}, expected ${JSON.stringify(expected)}`}`);
}

// Helper mirroring exactly what lib/finance/calculate.js feeds the function:
//   isReturn    = (bucket === RETURN)
//   isValidated = order.returnValidationStatus === "validated"
//   priceUsable = isUsableCommissionPrice(price)
//   priceCents  = dhToCents(price) ?? 0
// `validation` defaults to "pending" (also the schema default, and the
// safe treatment of a legacy row with no value).
function contribFor({ isReturn, price, validation = RETURN_VALIDATION_STATUSES.PENDING }) {
  return returnValueContribution({
    isReturn,
    isValidated: validation === RETURN_VALIDATION_STATUSES.VALIDATED,
    priceUsable: isUsableCommissionPrice(price),
    priceCents: dhToCents(price) ?? 0,
  });
}

// Same shape, for the Validated Return Value card's helper.
function validatedContribFor({ isReturn, price, validation = RETURN_VALIDATION_STATUSES.PENDING }) {
  return validatedReturnValueContribution({
    isReturn,
    isValidated: validation === RETURN_VALIDATION_STATUSES.VALIDATED,
    priceUsable: isUsableCommissionPrice(price),
    priceCents: dhToCents(price) ?? 0,
  });
}

console.log("== a PENDING return-category order contributes its real price ==");
eq("Returned 220 (pending) -> +22000c", contribFor({ isReturn: true, price: 220 }), { valueCents: 22000, unknownPriceOrders: 0 });
eq("Refused 180 (pending) -> +18000c", contribFor({ isReturn: true, price: 180 }), { valueCents: 18000, unknownPriceOrders: 0 });
eq("Cancelled 150 (pending) -> +15000c", contribFor({ isReturn: true, price: 150 }), { valueCents: 15000, unknownPriceOrders: 0 });
eq("Returned decimal 12.50 -> +1250c (cents, no float error)", contribFor({ isReturn: true, price: 12.5 }), { valueCents: 1250, unknownPriceOrders: 0 });
eq('Returned numeric string "300" -> +30000c', contribFor({ isReturn: true, price: "300" }), { valueCents: 30000, unknownPriceOrders: 0 });
// legacy row with no returnValidationStatus is treated as pending -> included
eq("Returned 220, validation missing -> treated as pending -> +22000c",
  returnValueContribution({ isReturn: true, isValidated: false, priceUsable: true, priceCents: 22000 }),
  { valueCents: 22000, unknownPriceOrders: 0 });

console.log("\n== a VALIDATED return contributes NOTHING (value AND unknown flag) ==");
eq("Returned 220, VALIDATED -> 0", contribFor({ isReturn: true, price: 220, validation: RETURN_VALIDATION_STATUSES.VALIDATED }), { valueCents: 0, unknownPriceOrders: 0 });
eq("Refused 180, VALIDATED -> 0", contribFor({ isReturn: true, price: 180, validation: RETURN_VALIDATION_STATUSES.VALIDATED }), { valueCents: 0, unknownPriceOrders: 0 });
eq("Cancelled 150, VALIDATED -> 0", contribFor({ isReturn: true, price: 150, validation: RETURN_VALIDATION_STATUSES.VALIDATED }), { valueCents: 0, unknownPriceOrders: 0 });
eq("Returned unknown price, VALIDATED -> 0 and NOT flagged unknown",
  contribFor({ isReturn: true, price: 0, validation: RETURN_VALIDATION_STATUSES.VALIDATED }), { valueCents: 0, unknownPriceOrders: 0 });

console.log("\n== NON-return orders never contribute (excluded) ==");
eq("Delivered 220 -> nothing", contribFor({ isReturn: false, price: 220 }), { valueCents: 0, unknownPriceOrders: 0 });
eq("Progress 220 -> nothing", contribFor({ isReturn: false, price: 220 }), { valueCents: 0, unknownPriceOrders: 0 });
eq("Delivered with unknown price -> nothing (not counted, not flagged here)", contribFor({ isReturn: false, price: 0 }), { valueCents: 0, unknownPriceOrders: 0 });

console.log("\n== unknown / missing / real-zero return price is NEVER fabricated ==");
eq("Return price 0 (Quick 'unknown') -> value 0, flagged unknown", contribFor({ isReturn: true, price: 0 }), { valueCents: 0, unknownPriceOrders: 1 });
eq("Return price null -> value 0, flagged unknown", contribFor({ isReturn: true, price: null }), { valueCents: 0, unknownPriceOrders: 1 });
eq("Return price undefined -> value 0, flagged unknown", contribFor({ isReturn: true, price: undefined }), { valueCents: 0, unknownPriceOrders: 1 });
eq("Return price NaN -> value 0, flagged unknown", contribFor({ isReturn: true, price: NaN }), { valueCents: 0, unknownPriceOrders: 1 });
eq("Return price negative -> value 0, flagged unknown", contribFor({ isReturn: true, price: -50 }), { valueCents: 0, unknownPriceOrders: 1 });

console.log("\n== spec example (13): 220 + 300 + 180 refused, 250 progress excluded -> 700 DH ==");
{
  const rows = [
    contribFor({ isReturn: true, price: 220 }),
    contribFor({ isReturn: true, price: 300 }),
    contribFor({ isReturn: true, price: 180 }),
    contribFor({ isReturn: false, price: 250 }), // progress
  ];
  eq("Return Value = 70000c (700.00 DH)", sumCents(rows.map((r) => r.valueCents)), 70000);
  eq("unknown-price returns = 0", sumCents(rows.map((r) => r.unknownPriceOrders)), 0);
}

console.log("\n== updated spec example (3): B (300) is VALIDATED -> excluded -> 400 DH ==");
{
  const A = contribFor({ isReturn: true, price: 220 }); // RETURNED + pending
  const B = contribFor({ isReturn: true, price: 300, validation: RETURN_VALIDATION_STATUSES.VALIDATED }); // RETURNED + validated
  const C = contribFor({ isReturn: true, price: 180 }); // REFUSED + pending
  const D = contribFor({ isReturn: false, price: 250 }); // DELIVERED
  eq("Return Value = 40000c (400.00 DH: 220 + 180)", sumCents([A, B, C, D].map((r) => r.valueCents)), 40000);
}

console.log("\n== validate / revert transitions move the total by exactly that order's price ==");
{
  // start: 3 pending returns -> 1000 DH
  const priced = [400, 300, 300];
  const allPending = priced.map((p) => contribFor({ isReturn: true, price: p }));
  const startTotal = sumCents(allPending.map((r) => r.valueCents));
  eq("start: all pending -> 100000c (1,000.00 DH)", startTotal, 100000);

  // validate the 300 DH one
  const afterValidate = [
    contribFor({ isReturn: true, price: 400 }),
    contribFor({ isReturn: true, price: 300, validation: RETURN_VALIDATION_STATUSES.VALIDATED }),
    contribFor({ isReturn: true, price: 300 }),
  ];
  const validatedTotal = sumCents(afterValidate.map((r) => r.valueCents));
  eq("after validate 300 -> 70000c (700.00 DH), i.e. down by exactly 300", validatedTotal, 70000);
  eq("delta on validate == -30000c", validatedTotal - startTotal, -30000);

  // revert it back to pending
  const afterRevert = priced.map((p) => contribFor({ isReturn: true, price: p }));
  const revertedTotal = sumCents(afterRevert.map((r) => r.valueCents));
  eq("after revert -> back to 100000c (1,000.00 DH)", revertedTotal, 100000);
  eq("delta on revert == +30000c", revertedTotal - validatedTotal, 30000);
}

console.log("\n== spec example (14): 220 + unknown + 300 -> known 520 DH, 1 unknown ==");
{
  const rows = [
    contribFor({ isReturn: true, price: 220 }),
    contribFor({ isReturn: true, price: 0 }), // Quick historical, priceSource "unknown"
    contribFor({ isReturn: true, price: 300 }),
  ];
  eq("known Return Value = 52000c (520.00 DH)", sumCents(rows.map((r) => r.valueCents)), 52000);
  eq("unknown-price returns = 1", sumCents(rows.map((r) => r.unknownPriceOrders)), 1);
}

console.log("\n== no returned orders -> Return Value = 0 ==");
eq("empty -> 0", sumCents([].map((r) => r.valueCents)), 0);

console.log("\n== daily <-> monthly reconciliation (known prices) ==");
{
  // three "days", each a small set of return orders
  const day1 = [contribFor({ isReturn: true, price: 220 }), contribFor({ isReturn: true, price: 180 })];
  const day2 = [contribFor({ isReturn: true, price: 300 })];
  const day3 = [contribFor({ isReturn: false, price: 999 })]; // not a return
  const dailyTotals = [day1, day2, day3].map((d) => sumCents(d.map((r) => r.valueCents)));
  const monthly = sumCents([...day1, ...day2, ...day3].map((r) => r.valueCents));
  eq("SUM(daily return values) === monthly return value", sumCents(dailyTotals), monthly);
  eq("monthly = 70000c (700.00 DH: 220 + 180 + 300)", monthly, 70000);
}

console.log("\n== VALIDATED RETURN VALUE: a VALIDATED return-category order contributes its real price ==");
eq("Returned 220 (validated) -> +22000c", validatedContribFor({ isReturn: true, price: 220, validation: RETURN_VALIDATION_STATUSES.VALIDATED }), { valueCents: 22000, unknownPriceOrders: 0 });
eq("Refused 180 (validated) -> +18000c", validatedContribFor({ isReturn: true, price: 180, validation: RETURN_VALIDATION_STATUSES.VALIDATED }), { valueCents: 18000, unknownPriceOrders: 0 });
eq("Cancelled 150 (validated) -> +15000c", validatedContribFor({ isReturn: true, price: 150, validation: RETURN_VALIDATION_STATUSES.VALIDATED }), { valueCents: 15000, unknownPriceOrders: 0 });

console.log("\n== VALIDATED RETURN VALUE: a PENDING return contributes NOTHING ==");
eq("Returned 220, pending -> 0 (excluded from Validated Return Value)", validatedContribFor({ isReturn: true, price: 220 }), { valueCents: 0, unknownPriceOrders: 0 });
eq("Refused 180, pending -> 0", validatedContribFor({ isReturn: true, price: 180 }), { valueCents: 0, unknownPriceOrders: 0 });
eq("legacy row (validation missing -> treated as pending) -> 0",
  validatedReturnValueContribution({ isReturn: true, isValidated: false, priceUsable: true, priceCents: 22000 }),
  { valueCents: 0, unknownPriceOrders: 0 });

console.log("\n== VALIDATED RETURN VALUE: Delivered / Progress orders never contribute ==");
eq("Delivered 220, validated flag irrelevant -> 0", validatedContribFor({ isReturn: false, price: 220, validation: RETURN_VALIDATION_STATUSES.VALIDATED }), { valueCents: 0, unknownPriceOrders: 0 });
eq("Progress 220 -> 0", validatedContribFor({ isReturn: false, price: 220 }), { valueCents: 0, unknownPriceOrders: 0 });

console.log("\n== VALIDATED RETURN VALUE: unknown price on a VALIDATED return is not fabricated ==");
eq("Return price 0 (Quick 'unknown'), validated -> 0, flagged unknown",
  validatedContribFor({ isReturn: true, price: 0, validation: RETURN_VALIDATION_STATUSES.VALIDATED }),
  { valueCents: 0, unknownPriceOrders: 1 });
eq("Return price null, validated -> 0, flagged unknown",
  validatedContribFor({ isReturn: true, price: null, validation: RETURN_VALIDATION_STATUSES.VALIDATED }),
  { valueCents: 0, unknownPriceOrders: 1 });

console.log("\n== spec example (task 10, §3): A pending 220, B validated 300, C pending 180, D validated 150 ==");
{
  const A = { isReturn: true, price: 220, validation: RETURN_VALIDATION_STATUSES.PENDING }; // RETURNED, pending
  const B = { isReturn: true, price: 300, validation: RETURN_VALIDATION_STATUSES.VALIDATED }; // RETURNED, validated
  const C = { isReturn: true, price: 180, validation: RETURN_VALIDATION_STATUSES.PENDING }; // REFUSED, pending
  const D = { isReturn: true, price: 150, validation: RETURN_VALIDATION_STATUSES.VALIDATED }; // CANCELLED, validated

  const returnValue = sumCents([A, B, C, D].map((o) => contribFor(o).valueCents));
  const validatedReturnValue = sumCents([A, B, C, D].map((o) => validatedContribFor(o).valueCents));

  eq("Return Value = 40000c (400.00 DH: A 220 + C 180)", returnValue, 40000);
  eq("Validated Return Value = 45000c (450.00 DH: B 300 + D 150)", validatedReturnValue, 45000);
}

console.log("\n== Return Value + Validated Return Value partition the known-price Return bucket exactly ==");
{
  const orders = [
    { isReturn: true, price: 220, validation: "pending" },
    { isReturn: true, price: 300, validation: "validated" },
    { isReturn: true, price: 180, validation: "pending" },
    { isReturn: true, price: 150, validation: "validated" },
    { isReturn: false, price: 999, validation: "pending" }, // delivered/progress, irrelevant
  ];
  const pending = sumCents(orders.map((o) => contribFor(o).valueCents));
  const validated = sumCents(orders.map((o) => validatedContribFor(o).valueCents));
  const knownReturnTotal = sumCents(
    orders.filter((o) => o.isReturn).map((o) => dhToCents(o.price) ?? 0)
  );
  eq("pending + validated === SUM(price) over every known-price return order", pending + validated, knownReturnTotal);
}

console.log(`\n${failures === 0 ? "ALL CHECKS PASSED" : failures + " CHECK(S) FAILED"}`);
process.exit(failures === 0 ? 0 : 1);
