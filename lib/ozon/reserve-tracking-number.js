/**
 * Ozon Express tracking-number reservation — LIVE counter, MONTHLY-RESETTING.
 *
 * Source of truth: `User.ozonTrackingCounter` (NEXT-UNUSED semantics — the
 * stored value IS the number to use for the next order) paired with
 * `User.ozonTrackingCounterMonth` ("YYYYMM", which month the counter value
 * currently represents) — see models/User.js's own comment on both fields.
 *
 * ROOT CAUSE this architecture fixes: a PRIOR design used a single,
 * continuously-incrementing counter that never reset month to month — on
 * entering a new calendar month, order numbering silently continued from
 * wherever the previous month left off instead of starting at 1000. This
 * module detects the month rollover itself, automatically, on the very
 * first reservation attempt of a new month — no cron, no manual step:
 *
 *   stored month === this month  -> normal CAS increment, exactly as before.
 *   stored month !== this month  -> treated as "nothing reserved yet this
 *                                    month" (current = 1000), and BOTH
 *                                    fields are set together, atomically,
 *                                    in the SAME compare-and-swap as the
 *                                    reservation itself — there is no
 *                                    separate "reset step" that could race
 *                                    with a reservation.
 *   stored month missing entirely (a brand-new employee, or one that
 *   predates this field) -> identical to "different month": resets to 1000.
 *
 * "This month" is computed via `businessPeriodFor()` — the EXPLICIT Morocco
 * business timezone (`Africa/Casablanca`), never the server process's own
 * local time (which a serverless host can run in any timezone) — see
 * lib/tracking/counter.js's own comment.
 *
 * Quick Livraison is DELIBERATELY NOT symmetric with this: it keeps its
 * own, unchanged, continuously-incrementing `User.quickTrackingCounter`
 * (see lib/quick/reserve-tracking-number.js) — this monthly-reset rule is
 * Ozon-only by explicit business requirement.
 *
 * `TrackingCounter` (models/TrackingCounter.js) is still used — read-only,
 * via `peekOzonCounterForPeriod` below — for browsing a PAST (non-current)
 * month's Ozon history; this module's reservation/release/self-heal never
 * writes to it, and historical records are never touched by anything here.
 */

import User from "@/models/User";
import { peekLatestCounter } from "@/lib/tracking/reserve-counter";
import { SHIPPING_PROVIDERS } from "@/models/ShippingCompany";
import { businessPeriodFor, MONTH_BOUNDARY_COUNTER } from "@/lib/tracking/counter";

const FIELD = "ozonTrackingCounter";
const MONTH_FIELD = "ozonTrackingCounterMonth";
const MAX_ATTEMPTS = 5;

function httpError(message, statusCode) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

/** `{ [MONTH_FIELD]: value }` if set, else the "field is unset/null" `$or` shape. */
function exactOrUnset(field, value) {
  return value != null ? { [field]: value } : { $or: [{ [field]: { $exists: false } }, { [field]: null }] };
}

/**
 * Reserve the next Ozon tracking number for `userId` (a merchant or an
 * employee), for the CURRENT Morocco business month. Automatically resets
 * to 1000 the first time a given month is reserved against.
 * @returns {Promise<{ trackingId: number, period: string, reservedNext: number, previousCounterValue: string|null }>}
 *   `trackingId`    — the counter value to use for THIS parcel.
 *   `period`        — the exact "YYYYMM" this was reserved against; pass
 *                      this (not a second, independently-computed period)
 *                      to `buildFullOzonTrackingNumber`.
 *   Everything else — pass straight through to `releaseOzonTrackingNumber`
 *                      if the provider call fails.
 */
export async function reserveNextOzonTrackingNumber(userId) {
  const period = businessPeriodFor();
  let userDoc = await User.findById(userId).select(`+${FIELD} +${MONTH_FIELD}`);
  if (!userDoc) {
    throw httpError("Account not found.", 404);
  }

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const storedMonth = userDoc[MONTH_FIELD] ?? null;
    const storedCounter = userDoc[FIELD] ?? null;
    const isSameMonth = storedMonth === period;
    // Not the same month (including "never set at all") -> this IS the
    // automatic reset: nothing has been reserved yet under `period`.
    const current = isSameMonth && storedCounter != null ? Number(storedCounter) : MONTH_BOUNDARY_COUNTER;
    const next = current + 1;

    // CAS filter: match the EXACT (month, counter) pair just observed —
    // this single filter correctly covers both "same month, increment" and
    // "stale/missing month, reset" the same way, so a concurrent request
    // that already won either case always makes this one fail and retry.
    const filter = {
      _id: userId,
      $and: [exactOrUnset(MONTH_FIELD, storedMonth), exactOrUnset(FIELD, storedCounter)],
    };

    const res = await User.updateOne(filter, { $set: { [FIELD]: String(next), [MONTH_FIELD]: period } });

    if (res.matchedCount === 1) {
      return { trackingId: current, period, reservedNext: next, previousCounterValue: storedCounter };
    }

    // Someone else advanced (or reset) the counter concurrently — reload and retry.
    userDoc = await User.findById(userId).select(`+${FIELD} +${MONTH_FIELD}`);
    if (!userDoc) {
      throw httpError("Account not found.", 404);
    }
  }

  throw httpError("Could not reserve a tracking number, please retry.", 409);
}

/**
 * Best-effort: hand a reserved number back after a failed Ozon call, so a
 * failed attempt does not permanently consume it — including when the
 * reservation was ALSO this month's automatic reset (reverting the counter
 * field to its previous value, or removing it entirely if it was never set,
 * correctly leaves the month field at `period`: a subsequent reservation
 * this same month still correctly computes "nothing used yet -> 1000",
 * identical to the reset having never happened). Only succeeds if nobody
 * else has advanced the counter since the reservation.
 */
export async function releaseOzonTrackingNumber(userId, reservation) {
  const { period, reservedNext, previousCounterValue } = reservation;
  try {
    const filter = { _id: userId, [MONTH_FIELD]: period, [FIELD]: String(reservedNext) };
    if (previousCounterValue != null) {
      await User.updateOne(filter, { $set: { [FIELD]: String(previousCounterValue) } });
    } else {
      await User.updateOne(filter, { $unset: { [FIELD]: "" } });
    }
  } catch (err) {
    // A failed release must never fail the request that triggered it — it
    // just means the gap isn't reclaimed this time.
    console.error("releaseOzonTrackingNumber failed:", err?.message);
  }
}

/**
 * Read-only: the CURRENT Morocco-business-month next-UNUSED counter value
 * for this owner — `MONTH_BOUNDARY_COUNTER` (1000) if this owner has
 * created no Ozon order yet THIS month (a brand-new month, a brand-new
 * employee, or simply nobody has ordered yet). This is what the CURRENT
 * month's listing/discovery starts from.
 */
export async function peekNextOzonCounter(userId) {
  const userDoc = await User.findById(userId).select(`+${FIELD} +${MONTH_FIELD}`);
  if (!userDoc) {
    throw httpError("Account not found.", 404);
  }
  const period = businessPeriodFor();
  const isSameMonth = userDoc[MONTH_FIELD] === period;
  if (!isSameMonth || userDoc[FIELD] == null) return MONTH_BOUNDARY_COUNTER;
  // `FIELD` itself already holds the NEXT-UNUSED value (see
  // `reserveNextOzonTrackingNumber`'s own `current = storedCounter` — it is
  // assigned directly as the new order's trackingId, never storedCounter+1)
  // — no further adjustment here, confirmed against real pre-existing
  // production data where this field was already exactly (latest real
  // tracking number used) + 1.
  return Number(userDoc[FIELD]);
}

/**
 * Read-only: the latest-used counter for a PAST (non-current) month, from
 * the per-month `TrackingCounter` model — preserved, unchanged, for
 * historical-month browsing only. Never used for the current month or for
 * order creation. `null` means no Ozon order was ever created that month.
 */
export async function peekOzonCounterForPeriod(userId, period) {
  return peekLatestCounter(userId, SHIPPING_PROVIDERS.OZON_EXPRESS, period);
}

/**
 * Administrative override (app/api/employees/[id]/route.js) — a merchant
 * manually correcting an employee's CURRENT-month counter. Unconditional
 * (no CAS — an explicit admin edit, not a race with order creation).
 * `value` is the NEXT-UNUSED number the merchant wants the next order to
 * use (matches what `peekNextOzonCounter` displays); always applied to the
 * CURRENT Morocco business month, setting both fields together so the
 * override can never accidentally look "stale" a moment later.
 */
export async function forceSetNextOzonCounter(userId, value) {
  const period = businessPeriodFor();
  // `value` IS the next-unused number already (validated >= 1000 by
  // lib/validation/auth.js's OZON_COUNTER_FLOOR before this is ever called)
  // — stored directly, no conversion (see `peekNextOzonCounter`'s own
  // comment for why FIELD needs none either).
  await User.updateOne(
    { _id: userId },
    { $set: { [FIELD]: String(Number(value)), [MONTH_FIELD]: period } }
  );
}

/**
 * VERIFY+SELF-HEAL support (lib/commission/sync-historical-orders.js): CAS
 * the counter up to a provider-VERIFIED higher value for `verifiedPeriod`
 * — never a guess, only ever a value `discoverHighestOzonCounter` already
 * confirmed exists at Ozon. Does its OWN fresh read (rather than trusting a
 * snapshot the caller observed slightly earlier) and only ever corrects
 * UPWARD — never overwrites a value already >= what was just verified,
 * which could reflect a legitimate newer reservation that happened
 * concurrently. A lost race here is never a failure: the next sync run
 * simply verifies again (best-effort, matching this mechanism's own
 * established tolerance elsewhere).
 * @returns {Promise<boolean>} whether the correction was applied.
 */
export async function selfHealOzonCounter(userId, verifiedPeriod, verifiedLatestUsed) {
  const userDoc = await User.findById(userId).select(`+${FIELD} +${MONTH_FIELD}`);
  if (!userDoc) return false;

  const storedMonth = userDoc[MONTH_FIELD] ?? null;
  const storedCounter = userDoc[FIELD] ?? null;
  const isSameMonth = storedMonth === verifiedPeriod;
  const currentLatestUsed = isSameMonth && storedCounter != null ? Number(storedCounter) : null;

  if (currentLatestUsed != null && currentLatestUsed >= verifiedLatestUsed) {
    return false; // already at or past the verified value — nothing to correct
  }

  const filter = {
    _id: userId,
    $and: [exactOrUnset(MONTH_FIELD, storedMonth), exactOrUnset(FIELD, storedCounter)],
  };
  const res = await User.updateOne(filter, {
    $set: { [FIELD]: String(verifiedLatestUsed + 1), [MONTH_FIELD]: verifiedPeriod },
  });
  return res.matchedCount === 1;
}
