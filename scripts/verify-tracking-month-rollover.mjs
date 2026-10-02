/**
 * Regression tests for the monthly tracking-counter rollover fix (the
 * October-2026 regression — see lib/ozon/reserve-tracking-number.js /
 * lib/quick/reserve-tracking-number.js's own module comments for the full
 * root-cause story).
 *
 * Pure format/arithmetic checks only — `lib/tracking/counter.js` has zero
 * `@/` imports, so these run with plain `node`. The DB-dependent half (CAS
 * reservation, self-heal, concurrency, release-on-failure) was verified
 * live against real data in this task's own investigation — see the final
 * report for the exact real reservations/releases/concurrent-request
 * results (owner `osama`, provider `ozon_express`: first October
 * reservation = 1000; two simultaneous reservations for the same owner
 * returned 1000 and 1001, never a duplicate; a release correctly reverted
 * the counter back to 1000). What THIS script locks in is the one thing
 * that genuinely IS pure and provider/DB-independent: the month-rollover
 * ARITHMETIC itself never special-cases a specific month, so January ->
 * February, November -> December, and December -> January all behave
 * identically to September -> October by construction, not by having been
 * separately tested in production.
 *
 * Run with:  node scripts/verify-tracking-month-rollover.mjs
 */

import { periodFor, businessPeriodFor, isValidPeriod, periodDateRange, buildFullTrackingNumber, MONTH_BOUNDARY_COUNTER } from "../lib/tracking/counter.js";

let failures = 0;
function eq(label, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failures++;
  console.log(`${ok ? "PASS" : "FAIL"} - ${label}${ok ? "" : ` - got ${JSON.stringify(actual)}, expected ${JSON.stringify(expected)}`}`);
}

console.log("== MONTH_BOUNDARY_COUNTER is the fixed floor every new period starts at ==");
eq("floor is 1000", MONTH_BOUNDARY_COUNTER, 1000);

console.log("\n== periodFor: generic month rollover, never a special case for any one month ==");
eq("Sep 2026 -> 202609 (the real investigated case)", periodFor(new Date(2026, 8, 15)), "202609");
eq("Oct 2026 -> 202610 (the real investigated case)", periodFor(new Date(2026, 9, 1)), "202610");
eq("Jan 2026 -> 202601 -> Feb 2026 -> 202602", periodFor(new Date(2026, 0, 31)), "202601");
eq("Feb 2026", periodFor(new Date(2026, 1, 1)), "202602");
eq("Nov 2026 -> 202611", periodFor(new Date(2026, 10, 30)), "202611");
eq("Dec 2026 -> 202612", periodFor(new Date(2026, 11, 1)), "202612");
console.log("\n-- year rollover: December -> January must roll the YEAR too, never stay in the same year --");
eq("Dec 31 2026, 23:59 -> 202612", periodFor(new Date(2026, 11, 31, 23, 59)), "202612");
eq("Jan 1 2027, 00:00 -> 202701 (NOT 202601 or 202613)", periodFor(new Date(2027, 0, 1, 0, 0)), "202701");

console.log("\n== businessPeriodFor: explicit Africa/Casablanca time, independent of this machine's own local timezone ==");
// All instants given as UTC — Morocco has observed a fixed UTC+1 year-round
// since 2018 (no DST), so these are exact, deterministic regardless of what
// timezone this test happens to run in (unlike `periodFor` above).
eq(
  "Sep 30 22:30 UTC -> Sep 30 23:30 in Morocco -> still September",
  businessPeriodFor(new Date(Date.UTC(2026, 8, 30, 22, 30))),
  "202609"
);
eq(
  "Sep 30 23:30 UTC -> Oct 1 00:30 in Morocco -> already October (the exact boundary this function exists for)",
  businessPeriodFor(new Date(Date.UTC(2026, 8, 30, 23, 30))),
  "202610"
);
eq(
  "Dec 31 23:30 UTC -> Jan 1 00:30 in Morocco -> 202701, year rolls too",
  businessPeriodFor(new Date(Date.UTC(2026, 11, 31, 23, 30))),
  "202701"
);
eq(
  "Oct 1 2026, 12:00 UTC -> 202610 (comfortably mid-month, sanity check)",
  businessPeriodFor(new Date(Date.UTC(2026, 9, 1, 12, 0))),
  "202610"
);

console.log("\n== periodDateRange: Date's own month-overflow makes Dec -> Jan work with zero special-casing ==");
// Compared via LOCAL date components (getFullYear/getMonth/getDate) — the
// function itself deliberately builds these in LOCAL time (see its own
// comment); `.toISOString()` would shift by this machine's own UTC offset
// and is not what's actually being verified here.
function localDate(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
{
  const { start, end } = periodDateRange("202612");
  eq("202612 starts Dec 1 2026", localDate(start), "2026-12-01");
  eq("202612 end is exclusive -> Jan 1 2027 (the year itself rolls over automatically)", localDate(end), "2027-01-01");
  eq("end.getFullYear() is the NEXT year", end.getFullYear(), 2027);
}
{
  const { start, end } = periodDateRange("202701");
  eq("202701 starts Jan 1 2027", localDate(start), "2027-01-01");
  eq("202701 end is Feb 1 2027", localDate(end), "2027-02-01");
}

console.log("\n== isValidPeriod ==");
eq('"202610" is valid', isValidPeriod("202610"), true);
eq('"202613" (shape-valid, not a real calendar check here) still passes the SHAPE check', isValidPeriod("202613"), true);
eq('"2026-10" (wrong shape) is invalid', isValidPeriod("2026-10"), false);
eq("null is invalid", isValidPeriod(null), false);
eq("number (not a string) is invalid", isValidPeriod(202610), false);

console.log("\n== buildFullTrackingNumber: format never duplicates/corrupts the date segment across months ==");
eq("September, counter 1058", buildFullTrackingNumber("ibtissam", "202609", 1058), "ibtissam202609011058");
eq("October, counter 1000 (the real fixed case) — the exact tracking number format from the task's own example", buildFullTrackingNumber("ibtissam", "202610", 1000), "ibtissam202610011000");
eq("never duplicates the date (no 'ibtissam202609202610...')", buildFullTrackingNumber("ibtissam", "202610", 1000).includes("202609"), false);
eq("December -> January counter reset example", buildFullTrackingNumber("najwa", "202701", 1000), "najwa202701011000");

console.log(`\n${failures === 0 ? "ALL CHECKS PASSED" : failures + " CHECK(S) FAILED"}`);
process.exit(failures === 0 ? 0 : 1);
