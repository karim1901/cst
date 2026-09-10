/**
 * Regression tests for the Finance Daily "business date" fix.
 *
 * THE BUG: the Daily "Advertising & Profit" view grouped orders by
 * `toLocalDateKey(order.createdAt)` — the MongoDB INSERT time. A
 * historically-synced order got a `createdAt` equal to the sync run's date,
 * so dozens of orders from different real days piled onto one "day".
 *
 * THE FIX:
 *   - `Order.orderDate` = the real provider creation date (Quick
 *     `date_creation`, Ozon earliest history step).
 *   - Finance Daily groups by `businessDateForOrder(order)` (orderDate,
 *     else createdAt as a flagged fallback), formatted in the EXPLICIT
 *     `Africa/Casablanca` business timezone (`businessDateKey`).
 *   - `createdAt` is never touched and never used as the business date
 *     when a real `orderDate` exists.
 *
 * Pure logic, no DB/server — the modules under test have zero `@/` imports.
 *
 * Run with:  node scripts/verify-finance-business-date.mjs
 */

import {
  businessDateKey,
  businessDateForOrder,
  orderDateIsApproximate,
  MOROCCO_TIMEZONE,
} from "../lib/finance/business-date.js";
import { quickCreatedAt } from "../lib/quick/parse.js";

let failures = 0;
function eq(label, actual, expected) {
  const ok = actual === expected;
  if (!ok) failures++;
  console.log(`${ok ? "PASS" : "FAIL"} - ${label}${ok ? "" : ` - got ${JSON.stringify(actual)}, expected ${JSON.stringify(expected)}`}`);
}

console.log("== timezone is explicit ==");
eq("business timezone is Africa/Casablanca", MOROCCO_TIMEZONE, "Africa/Casablanca");

console.log("\n== businessDateKey: Africa/Casablanca calendar day (never server-local, never UTC) ==");
// Morocco is UTC+1 (no DST in the modern rule). 22:30 UTC on the 8th is
// still the 8th locally; 23:30 UTC on the 8th has already rolled to the 9th.
eq("2026-09-08T12:00:00Z -> 2026-09-08", businessDateKey(new Date("2026-09-08T12:00:00.000Z")), "2026-09-08");
eq("2026-09-08T22:30:00Z -> 2026-09-08 (still the 8th in Morocco)", businessDateKey(new Date("2026-09-08T22:30:00.000Z")), "2026-09-08");
eq("2026-09-08T23:30:00Z -> 2026-09-09 (past midnight Morocco)", businessDateKey(new Date("2026-09-08T23:30:00.000Z")), "2026-09-09");
eq("2026-09-09T00:30:00Z -> 2026-09-09", businessDateKey(new Date("2026-09-09T00:30:00.000Z")), "2026-09-09");
eq("accepts an ISO string too", businessDateKey("2026-09-03T12:00:00.000Z"), "2026-09-03");
eq("null -> null (never 'today')", businessDateKey(null), null);
eq("invalid date -> null", businessDateKey(new Date("nonsense")), null);

console.log("\n== businessDateForOrder: real provider date wins; createdAt is only a fallback ==");
const provDate = new Date("2026-09-03T12:00:00.000Z");
const syncDate = new Date("2026-09-08T07:16:57.000Z");
eq(
  "orderDate present -> use it (NOT createdAt)",
  businessDateForOrder({ orderDate: provDate, createdAt: syncDate })?.toISOString(),
  provDate.toISOString()
);
eq(
  "orderDate null -> fall back to createdAt",
  businessDateForOrder({ orderDate: null, createdAt: syncDate })?.toISOString(),
  syncDate.toISOString()
);
eq("orderDate present -> not approximate", orderDateIsApproximate({ orderDate: provDate, createdAt: syncDate }), false);
eq("orderDate null -> approximate (flagged)", orderDateIsApproximate({ orderDate: null, createdAt: syncDate }), true);

console.log("\n== end-to-end: an order SYNCED on the 8th but CREATED at the provider on the 3rd ==");
{
  // Real scenario from the audit: provider date 2026-09-03, sync insert 2026-09-08.
  const order = {
    orderDate: quickCreatedAt({ date_creation: "2026-09-03 14:01:26", status: "IN_PROGRESS" }),
    createdAt: new Date("2026-09-08T07:16:57.000Z"),
  };
  eq("quickCreatedAt parsed a date", order.orderDate instanceof Date, true);
  eq("Finance Daily places it on 2026-09-03", businessDateKey(businessDateForOrder(order)), "2026-09-03");
  eq("Finance Daily does NOT place it on the sync day 2026-09-08", businessDateKey(businessDateForOrder(order)) === "2026-09-08", false);
}

console.log("\n== quickCreatedAt: parsing shapes ==");
eq('"2026-09-03 14:01:26" -> day 2026-09-03', businessDateKey(quickCreatedAt({ date_creation: "2026-09-03 14:01:26" })), "2026-09-03");
eq('"2026-09-03" (date only) -> day 2026-09-03', businessDateKey(quickCreatedAt({ date_creation: "2026-09-03" })), "2026-09-03");
eq('late-evening "2026-09-03 23:59:00" still -> 2026-09-03 (noon-UTC anchor)', businessDateKey(quickCreatedAt({ date_creation: "2026-09-03 23:59:00" })), "2026-09-03");
eq("missing date_creation -> null", quickCreatedAt({ status: "DELIVERED" }), null);
eq("garbage date_creation -> null", quickCreatedAt({ date_creation: "not a date" }), null);

console.log(`\n${failures === 0 ? "ALL CHECKS PASSED" : failures + " CHECK(S) FAILED"}`);
process.exit(failures === 0 ? 0 : 1);
