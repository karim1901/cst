/**
 * Regression test for lib/quick/parse.js#classifyQuickParcelLookup — the
 * exact function whose bug caused real, existing historical Quick Livraison
 * orders to be silently misclassified as "harmless gaps" (see that file's
 * own module comment and lib/quick/lookup.js's for the full story).
 *
 * Pure logic, no DB/server needed — `lib/quick/parse.js` has zero `@/`
 * imports, so this can run directly with plain Node (unlike
 * lib/quick/credentials.js, which needs the real app running — see
 * scripts/verify-quick-credentials.mjs for that pattern).
 *
 * Run with:  node scripts/verify-quick-parcel-classification.mjs
 * Exits non-zero if any check fails.
 */

import { classifyQuickParcelLookup, quickParcelExists } from "../lib/quick/parse.js";

let failures = 0;
function check(label, ok, extra = "") {
  const mark = ok ? "PASS" : "FAIL";
  if (!ok) failures++;
  console.log(`${mark} - ${label}${extra ? " - " + extra : ""}`);
}

// ---------------------------------------------------------------------------
// THE BUG: a real, existing parcel whose response happens to carry a
// generic `success: false` wrapper flag (common in many APIs, unrelated to
// whether THIS specific parcel was found) — the exact shape the task's own
// example response used, plus the wrapper flag that was silently discarding
// it. The old implementation returned `false` here (a confirmed "harmless
// gap"), permanently losing this order from every historical-month view.
// ---------------------------------------------------------------------------
{
  const body = {
    tracking_number: "ibtissam202608011112",
    status: "DELIVERED",
    situation: "INVOICED",
    success: false, // the generic wrapper flag that used to hide this order
  };
  check(
    "BUG CASE: existing parcel with success:false wrapper flag -> classified as 'exists' (was silently 'not_found' before the fix)",
    classifyQuickParcelLookup(body, 200) === "exists"
  );
  check("quickParcelExists() boolean wrapper also returns true for it", quickParcelExists(body, 200) === true);
}

// The exact response shape given in the task/report, without the success
// flag — must also be "exists" (this already worked before; confirming no
// regression).
{
  const body = { tracking_number: "ibtissam202608011112", status: "DELIVERED", situation: "INVOICED" };
  check("Plain existing-parcel response (no success flag) -> 'exists'", classifyQuickParcelLookup(body, 200) === "exists");
}

// A response carrying ONLY tracking_number (no status at all) — still a
// real, recognizable parcel record.
{
  const body = { tracking_number: "ibtissam202608011050" };
  check("Response with only tracking_number -> 'exists'", classifyQuickParcelLookup(body, 200) === "exists");
}

// ---------------------------------------------------------------------------
// Genuine absences MUST remain "not_found" — these are the real gaps
// (item 9's explicit requirement: don't turn genuine gaps into false
// positives while fixing false negatives).
// ---------------------------------------------------------------------------
check("HTTP 404 -> 'not_found'", classifyQuickParcelLookup({ anything: "here" }, 404) === "not_found");
check("HTTP 404 with null body -> 'not_found'", classifyQuickParcelLookup(null, 404) === "not_found");
check(
  "Explicit status: 'not_found' (HTTP 200) -> 'not_found'",
  classifyQuickParcelLookup({ status: "not_found" }, 200) === "not_found"
);
check(
  "Explicit status: 'NOT_FOUND' (case-insensitive) -> 'not_found'",
  classifyQuickParcelLookup({ status: "NOT_FOUND" }, 200) === "not_found"
);
check(
  "Explicit situation: 'notfound' (fallback field) -> 'not_found'",
  classifyQuickParcelLookup({ situation: "notfound" }, 200) === "not_found"
);
check("quickParcelExists() is false for a genuine 404", quickParcelExists({}, 404) === false);

// ---------------------------------------------------------------------------
// A real delivery-outcome status that happens to read like an English
// "failure" word (e.g. a genuinely refused/cancelled/returned parcel — a
// REAL order, just not a delivered one) must NEVER be misread as "does not
// exist" — this was a real risk with the old FALSE_TOKENS-based check.
// ---------------------------------------------------------------------------
check(
  "A real REFUSED order (status literally reads like a negative word but is NOT a not-found signal) -> 'exists', never 'not_found'",
  classifyQuickParcelLookup({ tracking_number: "x", status: "REFUSED" }, 200) === "exists"
);
check(
  "A real CANCELLED order -> 'exists'",
  classifyQuickParcelLookup({ tracking_number: "x", status: "CANCELLED" }, 200) === "exists"
);

// ---------------------------------------------------------------------------
// Genuinely ambiguous responses -> 'unknown', NEVER silently folded into
// either 'exists' or 'not_found'. This is what lib/quick/lookup.js retries
// before giving up.
// ---------------------------------------------------------------------------
check("Null body (no HTTP 404) -> 'unknown'", classifyQuickParcelLookup(null, 200) === "unknown");
check(
  "Bare {success:false} error envelope with nothing else -> 'unknown' (not a confirmed absence)",
  classifyQuickParcelLookup({ success: false }, 200) === "unknown"
);
check(
  "Empty object body -> 'unknown'",
  classifyQuickParcelLookup({}, 200) === "unknown"
);
check("quickParcelExists() is false (not true) for an 'unknown' case", quickParcelExists({}, 200) === false);

console.log("\n" + (failures === 0 ? "All checks passed." : `${failures} check(s) FAILED.`));
process.exit(failures === 0 ? 0 : 1);
