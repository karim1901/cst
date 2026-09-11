import { RETURN_VALIDATION_STATUSES, RETURN_VALIDATION_FILTERS } from "./constants.js";

/**
 * Builds the MongoDB filter clause for `Order.returnValidationStatus` given
 * the Returns page's "Return Status" filter value — the ONE place this
 * mapping lives, so `lib/returns/list.js` and this module's own regression
 * test (scripts/verify-returns-validation-filter.mjs) can never drift.
 *
 * A return created before `returnValidationStatus` existed on the schema
 * has NO such field stored in MongoDB at all — Mongoose's `default:
 * "pending"` only applies going forward (documents created/saved through
 * the model), it is never retroactively written onto existing rows. Every
 * other place that reads this field already treats a missing value as
 * "pending" (lib/returns/list.js#toReturnSummary's `?? "pending"`, and
 * lib/finance/return-value.js's caller in lib/finance/calculate.js), so
 * this filter must match the same rule — otherwise "Pending" silently and
 * permanently excludes every legacy return, which is exactly the bug this
 * module fixes.
 *
 * `{$in: [PENDING, null]}` is the correct Mongo idiom: an equality match
 * against `null` matches BOTH a document with `returnValidationStatus:
 * null` AND one where the field is absent entirely (documented Mongo
 * behavior) — one condition covers "explicitly pending" and "legacy row,
 * no value" alike.
 *
 * `"validated"` has no such legacy ambiguity — it is ONLY ever written by
 * the explicit validate action (app/api/returns/[id]/validate/route.js), so
 * a literal match is correct and complete.
 *
 * @param {string} validation one of RETURN_VALIDATION_FILTERS ("all" |
 *   "pending" | "validated")
 * @returns {object|undefined} a Mongo filter value to assign to
 *   `returnValidationStatus`, or `undefined` when "all" (no restriction —
 *   caller should not set the key at all).
 */
export function buildReturnValidationFilter(validation) {
  if (validation === RETURN_VALIDATION_FILTERS.PENDING) {
    return { $in: [RETURN_VALIDATION_STATUSES.PENDING, null] };
  }
  if (validation === RETURN_VALIDATION_FILTERS.VALIDATED) {
    return RETURN_VALIDATION_STATUSES.VALIDATED;
  }
  return undefined;
}
