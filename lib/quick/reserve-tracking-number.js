/**
 * Quick Livraison tracking-number reservation — LIVE counter.
 *
 * Mirrors lib/ozon/reserve-tracking-number.js EXACTLY, bound to
 * `User.quickTrackingCounter` instead of `User.ozonTrackingCounter` — same
 * NEXT-UNUSED semantics (the stored value IS the number to use for the
 * next order, unlike `TrackingCounter`'s "latest used" convention), same
 * CAS reserve/release mechanism, same single-continuous-value design
 * (deliberately never resets monthly). Completely independent from Ozon's
 * own field — a Quick reservation/release can only ever touch
 * `quickTrackingCounter`, never `ozonTrackingCounter`, and vice versa.
 *
 * The per-month `TrackingCounter` model (models/TrackingCounter.js) is
 * still used — read-only, via `peekQuickCounterForPeriod` below — for
 * browsing a PAST month's Quick history, the exact same role it plays for
 * Ozon (see that module's own comment for the full rationale: this field
 * is the CURRENT/live counter; `TrackingCounter` is a separate,
 * per-period-frozen mechanism that order CREATION never writes to once
 * this field is the authoritative source for the current month).
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
