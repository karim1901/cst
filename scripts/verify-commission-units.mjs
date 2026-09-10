/**
 * Regression tests for the commission UNIT calculation — the exact logic
 * whose interaction with unpriced synced orders caused an employee's
 * monthly units to be a phantom count (one per delivered order) instead of
 * a real price-derived figure.
 *
 * THE BUG: Quick Livraison historical sync stored orders with `price: 0`
 * whenever the provider response carried no amount (its guard used a bare
 * `Number(info.price)` — and `Number(null) === 0`, which is finite, so a
 * MISSING price slipped through as a real `0`). `commissionUnitsForPrice`
 * then returned 1 for `0` (because `0 < 350`), so every unpriced delivered
 * order silently contributed 1 commission unit.
 *
 * FIX 1: `commissionUnitsForPrice` (PRICE BRACKETS ONLY) treats a
 * non-positive / missing / invalid price as "unknown" -> 0, never as a
 * "< 350 -> 1 unit" order. The real 350/500/550/750 brackets and their
 * intentional gaps are unchanged.
 *
 * FIX 2 (business rule): `commissionUnitsForOrder({ delivered, price })` is
 * the per-order unit count. NOT DELIVERED -> 0. DELIVERED -> at least 1
 * (a delivered order is at least one product): a usable price applies the
 * brackets above; an unknown/missing price is the 1-unit floor, never 0.
 *
 * Pure logic, no DB/server needed — `lib/commission/calculate.js` and the
 * `parseProviderAmount` export have zero `@/` imports.
 *
 * Run with:  node scripts/verify-commission-units.mjs
 * Exits non-zero if any check fails.
 */

import {
  commissionUnitsForPrice,
  commissionUnitsForOrder,
  isUsableCommissionPrice,
  computeEmployeeCommission,
} from "../lib/commission/calculate.js";
import { parseProviderAmount, resolveSyncedQuickPrice } from "../lib/quick/amount.js";
import { quickDisplayStatus } from "../lib/quick/parse.js";
import { shouldReclaimOrderOwnership } from "../lib/orders/reclaim-ownership.js";

let failures = 0;
function check(label, ok, extra = "") {
  const mark = ok ? "PASS" : "FAIL";
  if (!ok) failures++;
  console.log(`${mark} - ${label}${extra ? " - " + extra : ""}`);
}
function eq(label, actual, expected) {
  check(label, actual === expected, `got ${JSON.stringify(actual)}, expected ${JSON.stringify(expected)}`);
}

console.log("\n== commissionUnitsForPrice: exact business brackets (UNCHANGED) ==");
eq("1 DH -> 1 unit", commissionUnitsForPrice(1), 1);
eq("349 -> 1", commissionUnitsForPrice(349), 1);
eq("349.99 -> 1", commissionUnitsForPrice(349.99), 1);
eq("350 (boundary, in a gap) -> 0", commissionUnitsForPrice(350), 0);
eq("350.01 -> 2", commissionUnitsForPrice(350.01), 2);
eq("351 -> 2", commissionUnitsForPrice(351), 2);
eq("400 -> 2", commissionUnitsForPrice(400), 2);
eq("500 -> 2", commissionUnitsForPrice(500), 2);
eq("500.01 (in the intentional 500-550 gap) -> 0", commissionUnitsForPrice(500.01), 0);
eq("501 (gap) -> 0", commissionUnitsForPrice(501), 0);
eq("549 (gap) -> 0", commissionUnitsForPrice(549), 0);
eq("550 -> 3", commissionUnitsForPrice(550), 3);
eq("650 -> 3", commissionUnitsForPrice(650), 3);
eq("750 -> 3", commissionUnitsForPrice(750), 3);
eq("750.01 -> 4", commissionUnitsForPrice(750.01), 4);
eq("751 -> 4", commissionUnitsForPrice(751), 4);
eq("800 -> 4", commissionUnitsForPrice(800), 4);
eq("5000 -> 4", commissionUnitsForPrice(5000), 4);

console.log("\n== commissionUnitsForPrice: numeric STRINGS resolve deterministically ==");
eq('"220" -> 1', commissionUnitsForPrice("220"), 1);
eq('"400" -> 2', commissionUnitsForPrice("400"), 2);
eq('"400.00" -> 2', commissionUnitsForPrice("400.00"), 2);
eq('" 400 " -> 2', commissionUnitsForPrice(" 400 "), 2);
eq('"650" -> 3', commissionUnitsForPrice("650"), 3);

console.log(
  "\n== commissionUnitsForPrice (BRACKETS ONLY): INVALID / MISSING price -> 0 (the per-order floor is applied by commissionUnitsForOrder, not here) =="
);
eq("0 -> 0 (unknown, NOT a real <350 order)", commissionUnitsForPrice(0), 0);
eq("-100 -> 0", commissionUnitsForPrice(-100), 0);
eq("null -> 0", commissionUnitsForPrice(null), 0);
eq("undefined -> 0", commissionUnitsForPrice(undefined), 0);
eq('"" -> 0', commissionUnitsForPrice(""), 0);
eq('"   " -> 0', commissionUnitsForPrice("   "), 0);
eq("NaN -> 0", commissionUnitsForPrice(NaN), 0);
eq('"abc" -> 0', commissionUnitsForPrice("abc"), 0);
eq("Infinity -> 0", commissionUnitsForPrice(Infinity), 0);

console.log("\n== isUsableCommissionPrice ==");
for (const [v, want] of [
  [1, true], [349, true], [400, true], ["400", true], ["400.00", true], [5000, true],
  [0, false], [-1, false], [null, false], [undefined, false], ["", false], ["  ", false],
  [NaN, false], ["abc", false], [Infinity, false],
]) {
  eq(`isUsableCommissionPrice(${JSON.stringify(v)})`, isUsableCommissionPrice(v), want);
}

console.log(
  "\n== a REAL positive price is NEVER classified as unknown (Units=0 must be a data fact, not a parser bug) =="
);
// The exact vector from the task spec: every one of these is a genuine
// amount and MUST produce its real bracket's units, never 0-because-unknown.
for (const [price, wantUnits] of [
  [180, 1], [349, 1], [351, 2], [450, 2], [500, 2],
  [550, 3], [600, 3], [750, 3], [751, 4], [800, 4],
]) {
  eq(`price ${price} is usable`, isUsableCommissionPrice(price), true);
  eq(`price ${price} -> ${wantUnits} unit(s)`, commissionUnitsForPrice(price), wantUnits);
}
// The stored type in this app is always a JS number (models/Order.js
// `price: { type: Number }`); a numeric string still resolves identically.
eq('stored-as-string "220" still -> 1 unit', commissionUnitsForPrice("220"), 1);
eq("mongo number 0 (the 'amount unknown' sentinel) -> 0 units", commissionUnitsForPrice(0), 0);

console.log(
  "\n== commissionUnitsForOrder: NOT DELIVERED -> 0 ; DELIVERED -> minimum 1, price raises it =="
);
// Non-delivered orders never count, whatever the price.
eq("IN_PROGRESS + 180 -> 0", commissionUnitsForOrder({ delivered: false, price: 180 }), 0);
eq("not delivered + 800 -> 0", commissionUnitsForOrder({ delivered: false, price: 800 }), 0);
eq("not delivered + unknown -> 0", commissionUnitsForOrder({ delivered: false, price: 0 }), 0);
// Delivered + unknown / missing price -> the 1-unit floor (never 0).
eq("DELIVERED + 0/unknown -> 1", commissionUnitsForOrder({ delivered: true, price: 0 }), 1);
eq("DELIVERED + null -> 1", commissionUnitsForOrder({ delivered: true, price: null }), 1);
eq("DELIVERED + undefined -> 1", commissionUnitsForOrder({ delivered: true, price: undefined }), 1);
eq("DELIVERED + NaN -> 1", commissionUnitsForOrder({ delivered: true, price: NaN }), 1);
eq('DELIVERED + "" -> 1', commissionUnitsForOrder({ delivered: true, price: "" }), 1);
eq("DELIVERED + -50 -> 1", commissionUnitsForOrder({ delivered: true, price: -50 }), 1);
// Delivered + usable price -> the existing brackets, EXACTLY.
eq("DELIVERED + 100 -> 1", commissionUnitsForOrder({ delivered: true, price: 100 }), 1);
eq("DELIVERED + 180 -> 1", commissionUnitsForOrder({ delivered: true, price: 180 }), 1);
eq("DELIVERED + 349 -> 1", commissionUnitsForOrder({ delivered: true, price: 349 }), 1);
eq(
  "DELIVERED + 350 -> existing bracket behaviour preserved (gap -> 0, NOT floored)",
  commissionUnitsForOrder({ delivered: true, price: 350 }),
  0
);
eq("DELIVERED + 351 -> 2", commissionUnitsForOrder({ delivered: true, price: 351 }), 2);
eq("DELIVERED + 450 -> 2", commissionUnitsForOrder({ delivered: true, price: 450 }), 2);
eq("DELIVERED + 500 -> 2", commissionUnitsForOrder({ delivered: true, price: 500 }), 2);
eq("DELIVERED + 550 -> 3", commissionUnitsForOrder({ delivered: true, price: 550 }), 3);
eq("DELIVERED + 600 -> 3", commissionUnitsForOrder({ delivered: true, price: 600 }), 3);
eq("DELIVERED + 750 -> 3", commissionUnitsForOrder({ delivered: true, price: 750 }), 3);
eq("DELIVERED + 751 -> 4", commissionUnitsForOrder({ delivered: true, price: 751 }), 4);
eq("DELIVERED + 800 -> 4", commissionUnitsForOrder({ delivered: true, price: 800 }), 4);
eq('DELIVERED + valid string "600" -> 3', commissionUnitsForOrder({ delivered: true, price: "600" }), 3);
// Recovered-price scenario: same order, no status change, price now known.
eq(
  "unknown -> 1, then recovered 600 -> 3 (no status change)",
  [
    commissionUnitsForOrder({ delivered: true, price: 0 }),
    commissionUnitsForOrder({ delivered: true, price: 600 }),
  ].join(","),
  "1,3"
);

console.log("\n== parseProviderAmount (lib/quick/sync-order.js) ==");
eq("number 400 -> 400", parseProviderAmount(400), 400);
eq('"400" -> 400', parseProviderAmount("400"), 400);
eq('"400.00" -> 400', parseProviderAmount("400.00"), 400);
eq('"400 DH" -> 400 (was NaN -> order dropped)', parseProviderAmount("400 DH"), 400);
eq('"1,250.50 MAD" -> 1250.5', parseProviderAmount("1,250.50 MAD"), 1250.5);
eq("null -> 0 (missing amount)", parseProviderAmount(null), 0);
eq('"" -> 0', parseProviderAmount(""), 0);
eq('"  " -> 0', parseProviderAmount("  "), 0);
eq("0 -> 0", parseProviderAmount(0), 0);
eq("-50 -> 0", parseProviderAmount(-50), 0);
eq('"abc" -> 0', parseProviderAmount("abc"), 0);
eq("NaN -> 0", parseProviderAmount(NaN), 0);

console.log("\n== computeEmployeeCommission: mixed-price delivered orders sum correctly ==");
const emp = {
  commission: { threshold: 60, commissionBelowThreshold: 15, commissionAtOrAboveThreshold: 20 },
};
{
  // 58 orders @ 220 DH (1 unit each) + 2 orders @ 400 DH (2 units each)
  //   -> 58 + 4 = 62 units. 62 >= threshold 60 -> higher rate 20.
  const orders = [
    ...Array.from({ length: 58 }, () => ({ price: 220 })),
    { price: 400 },
    { price: 400 },
  ];
  const r = computeEmployeeCommission(emp, orders);
  eq("deliveredOrders = 60", r.deliveredOrders, 60);
  eq("commissionUnits = 62", r.commissionUnits, 62);
  eq("unknownPriceOrders = 0", r.unknownPriceOrders, 0);
  eq("commissionRate = 20 (62 >= 60)", r.commissionRate, 20);
  eq("totalCommission = 62 * 20 = 1240", r.totalCommission, 1240);
}
{
  // BUSINESS RULE: 60 delivered orders whose price is 0 (Quick historical
  // orders, amount never returned by the Quick API). Every delivered order
  // is at least one product -> 60 units, NOT 0. 60 >= threshold 60 -> the
  // at/above rate (20). Total updates naturally: 60 * 20 = 1200.
  const orders = Array.from({ length: 60 }, () => ({ price: 0 }));
  const r = computeEmployeeCommission(emp, orders);
  eq("all-unpriced: deliveredOrders = 60", r.deliveredOrders, 60);
  eq("all-unpriced: commissionUnits = 60 (the 1-unit floor, not 0)", r.commissionUnits, 60);
  eq("all-unpriced: unknownPriceOrders = 60 (surfaced, but still counted)", r.unknownPriceOrders, 60);
  eq("all-unpriced: commissionRate = 20 (60 >= threshold 60)", r.commissionRate, 20);
  eq("all-unpriced: totalCommission = 60 * 20 = 1200", r.totalCommission, 1200);
}
{
  // Same 60 unpriced delivered orders (1 unit each) + 3 with a real
  // 2-unit price (400 DH). Each order is scored INDEPENDENTLY:
  // 60*1 + 3*2 = 66 units. Proves a recovered price raises the total
  // above the delivered count (63), with nothing hardcoded.
  const orders = [
    ...Array.from({ length: 60 }, () => ({ price: 0 })),
    { price: 400 },
    { price: 400 },
    { price: 400 },
  ];
  const r = computeEmployeeCommission(emp, orders);
  eq("60 unpriced + 3x400: deliveredOrders = 63", r.deliveredOrders, 63);
  eq("60 unpriced + 3x400: commissionUnits = 60*1 + 3*2 = 66", r.commissionUnits, 66);
  eq("60 unpriced + 3x400: unknownPriceOrders = 60", r.unknownPriceOrders, 60);
}
{
  // 59 real 1-unit orders + one 550 DH order (3 units) -> 62 units,
  // proving units can exceed the delivered count.
  const orders = [...Array.from({ length: 59 }, () => ({ price: 200 })), { price: 550 }];
  const r = computeEmployeeCommission(emp, orders);
  eq("59x200 + 1x550: deliveredOrders = 60", r.deliveredOrders, 60);
  eq("59x200 + 1x550: commissionUnits = 62", r.commissionUnits, 62);
}
{
  // Threshold boundary: exactly `threshold` units -> higher rate.
  const orders = Array.from({ length: 60 }, () => ({ price: 200 })); // 60 units == threshold
  const r = computeEmployeeCommission(emp, orders);
  eq("exactly 60 units -> higher rate 20", r.commissionRate, 20);
  const orders59 = Array.from({ length: 59 }, () => ({ price: 200 }));
  eq("59 units -> lower rate 15", computeEmployeeCommission(emp, orders59).commissionRate, 15);
}
{
  // Quantity must NEVER be the unit source — a 220 DH order stays 1 unit
  // no matter its quantity.
  const orders = [{ price: 220, quantity: 5 }, { price: 220, quantity: 1 }];
  const r = computeEmployeeCommission(emp, orders);
  eq("quantity ignored: 2 orders @ 220 -> 2 units", r.commissionUnits, 2);
}
{
  // Mixed valid + unknown price. Each delivered order is worth >= 1:
  // 400 -> 2, 0 -> 1 (floor), 200 -> 1, null -> 1 (floor)  => 5 units.
  const orders = [{ price: 400 }, { price: 0 }, { price: 200 }, { price: null }];
  const r = computeEmployeeCommission(emp, orders);
  eq("mixed: commissionUnits = 2 + 1 + 1 + 1 = 5", r.commissionUnits, 5);
  eq("mixed: unknownPriceOrders = 2", r.unknownPriceOrders, 2);
}

console.log("\n== resolveSyncedQuickPrice: sync can NEVER wipe a real local price ==");
function sameDecision(label, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  check(label, ok, `got ${JSON.stringify(actual)}, expected ${JSON.stringify(expected)}`);
}
// THE BUG'S EXACT SCENARIO: local price 180 (typed at creation), Quick
// sync response has NO amount -> the price MUST stay untouched.
sameDecision(
  "existing order_creation price 180 + provider gives nothing -> leave alone (null)",
  resolveSyncedQuickPrice({ price: 180, priceSource: "order_creation" }, null),
  null
);
sameDecision(
  "existing order_creation price 450 + provider gives 0 -> leave alone",
  resolveSyncedQuickPrice({ price: 450, priceSource: "order_creation" }, 0),
  null
);
sameDecision(
  "existing order_creation price 450 + provider gives a DIFFERENT amount -> STILL leave alone",
  resolveSyncedQuickPrice({ price: 450, priceSource: "order_creation" }, 999),
  null
);
sameDecision(
  "existing manual price 300 + provider gives nothing -> leave alone",
  resolveSyncedQuickPrice({ price: 300, priceSource: "manual" }, null),
  null
);
sameDecision(
  "legacy row (no priceSource) with positive price 220 + provider nothing -> leave alone",
  resolveSyncedQuickPrice({ price: 220, priceSource: undefined }, null),
  null
);
sameDecision(
  "existing UNKNOWN price + provider NOW gives 400 -> fill in as provider_sync",
  resolveSyncedQuickPrice({ price: 0, priceSource: "unknown" }, "400"),
  { price: 400, priceSource: "provider_sync" }
);
sameDecision(
  "existing UNKNOWN price + provider still gives nothing -> stay unknown (null)",
  resolveSyncedQuickPrice({ price: 0, priceSource: "unknown" }, null),
  null
);
sameDecision(
  "BRAND NEW order + provider has real amount 180 -> {180, provider_sync}",
  resolveSyncedQuickPrice(null, 180),
  { price: 180, priceSource: "provider_sync" }
);
sameDecision(
  "BRAND NEW order + provider has NO amount -> {0, unknown} (explicit marker, not a real 0)",
  resolveSyncedQuickPrice(null, null),
  { price: 0, priceSource: "unknown" }
);

console.log("\n== Quick status: `status` is authoritative, NOT `situation`/`status_second` ==");
eq(
  'IN_PROGRESS + status_second CANCELED -> displayStatus is "IN_PROGRESS" (not CANCELED)',
  quickDisplayStatus({ status: "IN_PROGRESS", status_second: "CANCELED", situation: "NOT_PAID" }),
  "IN_PROGRESS"
);
eq(
  'DELIVERED + situation INVOICED -> "DELIVERED"',
  quickDisplayStatus({ status: "DELIVERED", situation: "INVOICED", status_second: "" }),
  "DELIVERED"
);
eq(
  "status_second only used when status is absent",
  quickDisplayStatus({ status_second: "DELIVERED" }),
  "DELIVERED"
);
eq("situation is NEVER the delivery status", quickDisplayStatus({ situation: "INVOICED" }), null);

console.log(
  "\n== shouldReclaimOrderOwnership: stale employeeId self-heal (Delivered = 0 bug) =="
);
const M = "merchantAAA";
const M2 = "merchantBBB";
const EMP_NEW = "ibtissamNEWid";
const EMP_OLD = "ibtissamOLDid";
eq(
  "orphaned order (points at a removed employee record) under same merchant -> reclaim",
  shouldReclaimOrderOwnership({
    syncEmployeeId: EMP_NEW,
    syncMerchantId: M,
    orderEmployeeId: EMP_OLD,
    orderMerchantId: M,
  }),
  true
);
eq(
  "order already owned by the current employee -> no-op (idempotent re-run)",
  shouldReclaimOrderOwnership({
    syncEmployeeId: EMP_NEW,
    syncMerchantId: M,
    orderEmployeeId: EMP_NEW,
    orderMerchantId: M,
  }),
  false
);
eq(
  "ObjectId vs string form of the SAME id -> treated as equal, no-op",
  shouldReclaimOrderOwnership({
    syncEmployeeId: "6aa16c7c59ae6cb094999543",
    syncMerchantId: M,
    orderEmployeeId: { toString: () => "6aa16c7c59ae6cb094999543" },
    orderMerchantId: M,
  }),
  false
);
eq(
  "merchant-scoped run (no employee id) -> never touches employeeId: null orders",
  shouldReclaimOrderOwnership({
    syncEmployeeId: null,
    syncMerchantId: M,
    orderEmployeeId: null,
    orderMerchantId: M,
  }),
  false
);
eq(
  "order belongs to a DIFFERENT merchant -> never moved across merchants",
  shouldReclaimOrderOwnership({
    syncEmployeeId: EMP_NEW,
    syncMerchantId: M,
    orderEmployeeId: EMP_OLD,
    orderMerchantId: M2,
  }),
  false
);
eq(
  "orphaned order with employeeId already null under same merchant + employee run -> adopt",
  shouldReclaimOrderOwnership({
    syncEmployeeId: EMP_NEW,
    syncMerchantId: M,
    orderEmployeeId: null,
    orderMerchantId: M,
  }),
  true
);

console.log(`\n${failures === 0 ? "ALL CHECKS PASSED" : failures + " CHECK(S) FAILED"}`);
process.exit(failures === 0 ? 0 : 1);
