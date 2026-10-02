/**
 * Quick Livraison tracking-number reservation — LIVE counter.
 *
 * Source of truth: `User.quickTrackingCounter` (a plain, single,
 * continuously-incrementing field — NOT the per-month `TrackingCounter`
 * model). DELIBERATELY left unchanged by the Ozon-only monthly-reset
 * business rule (see lib/ozon/reserve-tracking-number.js's own comment for
 * that architecture and its root-cause story) — Quick keeps its own,
 * separate, never-resets-monthly design exactly as it has always been.
 *
 * Semantics: NEXT-UNUSED (the stored value IS the number to use for the
 * next order — not "latest used", unlike `TrackingCounter`). Same proven
 * CAS idea as elsewhere in this app (compare-and-swap so two concurrent
 * requests can never be handed the same number, with a best-effort release
 * so a failed provider call never permanently consumes one), scoped to
 * this one field.
 *
 * `TrackingCounter` is still used — read-only, via
 * `peekQuickCounterForPeriod` below — for browsing a PAST month's Quick
 * history, the exact same role it plays for Ozon's own historical
 * (non-current) months.
 */

import User from "@/models/User";
import { peekLatestCounter } from "@/lib/tracking/reserve-counter";
import { SHIPPING_PROVIDERS } from "@/models/ShippingCompany";

const FIELD = "quickTrackingCounter";
const MAX_ATTEMPTS = 5;
// The floor a brand-new (never-used) counter starts at — same boundary the
// "01" tracking-number format and `TrackingCounter` both already use (see
// lib/tracking/counter.js), even though, unlike `TrackingCounter`, this
// counter never resets to it again — see the module comment.
const INITIAL_VALUE = 1000;

function httpError(message, statusCode) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

/**
 * Reserve the next Quick Livraison tracking number for `userId` (a
 * merchant or an employee).
 * @returns {Promise<{ trackingId: number, reservedNext: number }>}
 *   `trackingId`    — the counter value to use for THIS parcel.
 *   `reservedNext`  — the new counter value now persisted (pass the whole
 *                     reservation to `releaseQuickTrackingNumber` if the
 *                     provider call fails).
 */
export async function reserveNextQuickTrackingNumber(userId) {
  let userDoc = await User.findById(userId).select(`+${FIELD}`);
  if (!userDoc) {
    throw httpError("Account not found.", 404);
  }

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const hasValue = userDoc[FIELD] != null;
    const current = hasValue ? Number(userDoc[FIELD]) : INITIAL_VALUE;
    const next = current + 1;

    const filter = hasValue
      ? { _id: userId, [FIELD]: userDoc[FIELD] }
      : { _id: userId, $or: [{ [FIELD]: { $exists: false } }, { [FIELD]: null }] };

    // Compare-and-swap: only the request that still sees the counter's
    // current value wins.
    const res = await User.updateOne(filter, { $set: { [FIELD]: next } });

    if (res.matchedCount === 1) {
      return { trackingId: current, reservedNext: next };
    }

    // Someone else advanced the counter concurrently — reload and retry.
    userDoc = await User.findById(userId).select(`+${FIELD}`);
    if (!userDoc) {
      throw httpError("Account not found.", 404);
    }
  }

  throw httpError("Could not reserve a tracking number, please retry.", 409);
}

/**
 * Best-effort: hand a reserved number back after a failed Quick Livraison
 * call, so a failed attempt does not permanently consume it. Only succeeds
 * if nobody else has advanced the counter since the reservation.
 */
export async function releaseQuickTrackingNumber(userId, reservation) {
  const { trackingId, reservedNext } = reservation;
  try {
    await User.updateOne(
      { _id: userId, [FIELD]: reservedNext },
      { $set: { [FIELD]: trackingId } }
    );
  } catch (err) {
    // A failed release must never fail the request that triggered it — it
    // just means the gap isn't reclaimed this time.
    console.error("releaseQuickTrackingNumber failed:", err?.message);
  }
}

/**
 * Read-only: the CURRENT `quickTrackingCounter` value (the number the next
 * order will use), or the 1000 boundary if this user has never created a
 * Quick order yet.
 */
export async function peekNextQuickCounter(userId) {
  const userDoc = await User.findById(userId).select(`+${FIELD}`);
  if (!userDoc) {
    throw httpError("Account not found.", 404);
  }
  return userDoc[FIELD] != null ? Number(userDoc[FIELD]) : INITIAL_VALUE;
}

/**
 * Read-only: the latest-used counter for a PAST (non-current) month, from
 * the per-month `TrackingCounter` model — preserved, unchanged, for
 * historical-month browsing only (see app/api/orders/quick/route.js's GET
 * handler, the one caller). Never used for the current month or for order
 * creation (see module comment). `null` means no Quick order was ever
 * created that month.
 */
export async function peekQuickCounterForPeriod(userId, period) {
  return peekLatestCounter(userId, SHIPPING_PROVIDERS.QUICK_LIVRAISON, period);
}
