/**
 * Regression test for the Returns page "Return Status" (All/Pending/
 * Validated) MongoDB filter — lib/returns/validation-filter.js, the single
 * place lib/returns/list.js#queryReturnsForMerchant builds the
 * `returnValidationStatus` query clause from.
 *
 * Root-cause bug this guards against: a return created before
 * `returnValidationStatus` existed on the schema has NO such field in the
 * stored document. `{returnValidationStatus: "pending"}` (a literal string
 * equality) does NOT match a document where the field is absent — so
 * "Pending" was silently excluding every legacy return, while "All" (no
 * filter) and the section-tab counts (which never filter on this field)
 * still included them. Symptom: DB has 13 pending returns, Pending view
 * shows only 4 (the ones with an explicit "pending" value already saved by
 * a prior validate/unvalidate action) — see this script's assertions below.
 *
 * Alias-free (relative imports only) — runs with plain `node`.
 * Run with:  node scripts/verify-returns-validation-filter.mjs
 */

import { buildReturnValidationFilter } from "../lib/returns/validation-filter.js";
import { RETURN_VALIDATION_STATUSES, RETURN_VALIDATION_FILTERS } from "../lib/returns/constants.js";

let failures = 0;
function eq(label, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failures++;
  console.log(`${ok ? "PASS" : "FAIL"} - ${label}${ok ? "" : ` - got ${JSON.stringify(actual)}, expected ${JSON.stringify(expected)}`}`);
}

// A tiny in-memory stand-in for MongoDB's actual field-matching semantics,
// used only to prove the filter VALUE this module produces behaves the way
// a real Mongo `{$in: [...]}` / equality match does against documents that
// (a) explicitly carry the field and (b) never had it saved at all. This is
// not a MongoDB driver reimplementation — just the one piece of semantics
// this bug hinges on: does `{field: {$in: [X, null]}}` match a document
// with no `field` key? (Yes — this is documented MongoDB behavior, and is
// exactly what real-DB verification against the live app confirmed too.)
function mongoMatchesReturnValidationStatus(doc, filterValue) {
  if (filterValue === undefined) return true; // no restriction ("all")
  const hasField = Object.prototype.hasOwnProperty.call(doc, "returnValidationStatus");
  const value = hasField ? doc.returnValidationStatus : undefined;
  if (filterValue && typeof filterValue === "object" && Array.isArray(filterValue.$in)) {
    return filterValue.$in.some((v) => (v === null ? !hasField || value === null : value === v));
  }
  // literal equality
  return hasField && value === filterValue;
}

console.log("== 'all' -> no restriction (undefined), every doc matches ==");
eq("buildReturnValidationFilter('all') -> undefined", buildReturnValidationFilter(RETURN_VALIDATION_FILTERS.ALL), undefined);
eq("buildReturnValidationFilter(undefined) -> undefined (defensive default)", buildReturnValidationFilter(undefined), undefined);

console.log("\n== 'pending' matches an explicit \"pending\" value ==");
{
  const filter = buildReturnValidationFilter(RETURN_VALIDATION_FILTERS.PENDING);
  eq("explicit pending doc matches", mongoMatchesReturnValidationStatus({ returnValidationStatus: "pending" }, filter), true);
}

console.log("\n== 'pending' matches a LEGACY doc with NO returnValidationStatus field at all (the bug) ==");
{
  const filter = buildReturnValidationFilter(RETURN_VALIDATION_FILTERS.PENDING);
  const legacyDoc = { trackingNumber: "legacy123" }; // field genuinely absent, pre-dates the schema field
  eq("legacy doc (field absent) matches 'pending'", mongoMatchesReturnValidationStatus(legacyDoc, filter), true);
}

console.log("\n== 'pending' matches a doc with returnValidationStatus: null ==");
{
  const filter = buildReturnValidationFilter(RETURN_VALIDATION_FILTERS.PENDING);
  eq("explicit null matches 'pending'", mongoMatchesReturnValidationStatus({ returnValidationStatus: null }, filter), true);
}

console.log("\n== 'pending' does NOT match a validated doc ==");
{
  const filter = buildReturnValidationFilter(RETURN_VALIDATION_FILTERS.PENDING);
  eq("validated doc does not match 'pending'", mongoMatchesReturnValidationStatus({ returnValidationStatus: "validated" }, filter), false);
}

console.log("\n== 'validated' matches ONLY an explicit \"validated\" value — never a legacy/missing doc ==");
{
  const filter = buildReturnValidationFilter(RETURN_VALIDATION_FILTERS.VALIDATED);
  eq("buildReturnValidationFilter('validated') -> literal string", filter, RETURN_VALIDATION_STATUSES.VALIDATED);
  eq("explicit validated doc matches", mongoMatchesReturnValidationStatus({ returnValidationStatus: "validated" }, filter), true);
  eq("legacy doc (field absent) does NOT match 'validated'", mongoMatchesReturnValidationStatus({ trackingNumber: "legacy456" }, filter), false);
  eq("explicit pending doc does NOT match 'validated'", mongoMatchesReturnValidationStatus({ returnValidationStatus: "pending" }, filter), false);
}

console.log("\n== full-dataset reconciliation: 13 pending (9 legacy + 4 explicit), 81 validated, 94 total ==");
{
  const docs = [
    ...Array.from({ length: 9 }, (_, i) => ({ trackingNumber: `legacy-pending-${i}` })), // field absent
    ...Array.from({ length: 4 }, (_, i) => ({ trackingNumber: `explicit-pending-${i}`, returnValidationStatus: "pending" })),
    ...Array.from({ length: 81 }, (_, i) => ({ trackingNumber: `validated-${i}`, returnValidationStatus: "validated" })),
  ];
  const pendingFilter = buildReturnValidationFilter(RETURN_VALIDATION_FILTERS.PENDING);
  const validatedFilter = buildReturnValidationFilter(RETURN_VALIDATION_FILTERS.VALIDATED);
  const allFilter = buildReturnValidationFilter(RETURN_VALIDATION_FILTERS.ALL);

  const pendingCount = docs.filter((d) => mongoMatchesReturnValidationStatus(d, pendingFilter)).length;
  const validatedCount = docs.filter((d) => mongoMatchesReturnValidationStatus(d, validatedFilter)).length;
  const allCount = docs.filter((d) => mongoMatchesReturnValidationStatus(d, allFilter)).length;

  eq("Pending = 13 (this is the exact bug: was 4 before the fix)", pendingCount, 13);
  eq("Validated = 81", validatedCount, 81);
  eq("All = 94 (unaffected by validation, always was correct)", allCount, 94);
  eq("Pending + Validated === All (no double-count, no loss)", pendingCount + validatedCount, allCount);
}

console.log(`\n${failures === 0 ? "ALL CHECKS PASSED" : failures + " CHECK(S) FAILED"}`);
process.exit(failures === 0 ? 0 : 1);
