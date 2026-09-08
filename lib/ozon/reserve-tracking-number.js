/**
 * Ozon Express tracking-number reservation — LIVE counter.
 *
 * Source of truth: `User.ozonTrackingCounter` (a plain, single, continuously
 * -incrementing field — NOT the per-month `TrackingCounter` model that
 * Quick Livraison uses). An earlier task had migrated Ozon onto that same
 * monthly `TrackingCounter` scheme; this was an explicit correction
 * reverting Ozon specifically back onto `User.ozonTrackingCounter` as the
 * authoritative counter for order CREATION and for the CURRENT month's
 * listing — see the README's "Ozon Express" section for the full history.
 * `TrackingCounter` is still used (read-only, via `peekOzonCounterForPeriod`
 * below) for browsing a PAST month's Ozon history, since that mechanism
 * already existed and works — only the CURRENT/live counter moved back.
 *
 * Semantics: NEXT-UNUSED (the stored value IS the number to use for the
 * next order — not "latest used", unlike `TrackingCounter`). Same
 * proven CAS idea as elsewhere in this app (compare-and-swap so two
 * concurrent requests can never be handed the same number, with a
 * best-effort release so a failed provider call never permanently consumes
 * one), scoped to this one field.
 */

import User from "@/models/User";
import { peekLatestCounter } from "@/lib/tracking/reserve-counter";
import { SHIPPING_PROVIDERS } from "@/models/ShippingCompany";

const FIELD = "ozonTrackingCounter";
const MAX_ATTEMPTS = 5;
// The floor a brand-new (never-used) counter starts at. Matches the "01"
// tracking-number format's own boundary (see lib/tracking/counter.js) even
// though, unlike TrackingCounter, this counter never resets to it again —
// see the module comment.
const INITIAL_VALUE = 1000;

function httpError(message, statusCode) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

/**
 * Reserve the next Ozon tracking number for `userId` (a merchant or an
 * employee).
 * @returns {Promise<{ trackingId: number, reservedNext: number }>}
 *   `trackingId`    — the counter value to use for THIS parcel.
 *   `reservedNext`  — the new counter value now persisted (pass the whole
 *                     reservation to `releaseOzonTrackingNumber` if the
 *                     provider call fails).
 */
export async function reserveNextOzonTrackingNumber(userId) {
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
    const res = await User.updateOne(filter, { $set: { [FIELD]: String(next) } });

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
 * Best-effort: hand a reserved number back after a failed Ozon call, so a
 * failed attempt does not permanently consume it. Only succeeds if nobody
 * else has advanced the counter since the reservation.
 */
export async function releaseOzonTrackingNumber(userId, reservation) {
  const { trackingId, reservedNext } = reservation;
  try {
    await User.updateOne(
      { _id: userId, [FIELD]: String(reservedNext) },
      { $set: { [FIELD]: String(trackingId) } }
    );
  } catch (err) {
    // A failed release must never fail the request that triggered it — it
    // just means the gap isn't reclaimed this time.
    console.error("releaseOzonTrackingNumber failed:", err?.message);
  }
}

/**
 * Read-only: the CURRENT `ozonTrackingCounter` value (the number the next
 * order will use), or the 1000 boundary if this user has never created an
 * Ozon order yet. This is what the CURRENT month's listing starts from.
 */
export async function peekNextOzonCounter(userId) {
  const userDoc = await User.findById(userId).select(`+${FIELD}`);
  if (!userDoc) {
    throw httpError("Account not found.", 404);
  }
  return userDoc[FIELD] != null ? Number(userDoc[FIELD]) : INITIAL_VALUE;
}

/**
 * Read-only: the latest-used counter for a PAST (non-current) month, from
 * the per-month `TrackingCounter` model — preserved, unchanged, for
 * historical-month browsing only. Never used for the current month or for
 * order creation (see module comment). `null` means no Ozon order was ever
 * created that month.
 */
export async function peekOzonCounterForPeriod(userId, period) {
  return peekLatestCounter(userId, SHIPPING_PROVIDERS.OZON_EXPRESS, period);
}
