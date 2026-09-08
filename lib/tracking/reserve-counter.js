/**
 * Server-only: atomically reserve / release a per-(owner, provider, period)
 * monthly tracking-number counter — see models/TrackingCounter.js for the
 * storage shape and lib/tracking/counter.js for the number FORMAT.
 *
 * Same proven idea as the original single-field CAS this was generalized
 * from (compare-and-swap so two concurrent requests can never be handed the
 * same number, with a best-effort release so a failed provider call never
 * permanently consumes one), now scoped to a whole document per month
 * instead of one ever-growing field per provider — because the counter must
 * reset to 1000 every month independently, not continue forever.
 *
 * Contract:
 *  - `reserveNextCounter(ownerId, provider, period)` advances (or creates)
 *    the period's counter document FIRST — atomically, so only one
 *    concurrent caller can win a given value — then the caller talks to the
 *    provider.
 *  - If the provider call then fails, the caller MUST call
 *    `releaseCounter(reservation)` to hand the number back. Best-effort: it
 *    only succeeds if nobody else has advanced the counter further in the
 *    meantime (a plain CAS), or — for the very first reservation of a new
 *    month — deletes the just-created document entirely so the next attempt
 *    correctly starts over at the boundary (1000) instead of one past it.
 *    If the release can't apply (someone else already advanced/created
 *    past it), the number is simply never reused — a small, harmless gap —
 *    rather than risking corrupting a different, already-successful
 *    request's state.
 */

import TrackingCounter from "@/models/TrackingCounter";
import { MONTH_BOUNDARY_COUNTER } from "@/lib/tracking/counter";

const MAX_ATTEMPTS = 5;

function httpError(message, statusCode) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

/**
 * Reserve one tracking number for `ownerId` (a merchant or an employee) on
 * `provider`, for calendar month `period` ("YYYYMM").
 * @returns {Promise<{ trackingId: number, period: string, _id: string, reservedFrom: number|null }>}
 *   `trackingId`    — the counter value to use for THIS parcel.
 *   `reservedFrom`  — the counter's value before this reservation, or
 *                     `null` if this reservation created the period's very
 *                     first document (pass straight through to
 *                     `releaseCounter` if the provider call fails).
 */
export async function reserveNextCounter(ownerId, provider, period) {
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const doc = await TrackingCounter.findOne({ ownerId, provider, period });

    if (!doc) {
      // No orders yet this month for this owner+provider — try to create
      // the first document, atomically, at the boundary value.
      try {
        const created = await TrackingCounter.create({
          ownerId,
          provider,
          period,
          counter: MONTH_BOUNDARY_COUNTER,
        });
        return {
          trackingId: MONTH_BOUNDARY_COUNTER,
          period,
          _id: String(created._id),
          reservedFrom: null,
        };
      } catch (err) {
        if (err?.code === 11000) {
          // Someone else created it concurrently between our findOne and
          // create — retry, the next loop iteration will find their doc.
          continue;
        }
        throw err;
      }
    }

    const current = doc.counter;
    const next = current + 1;

    // Compare-and-swap: only the request that still sees the counter's
    // current value wins.
    const res = await TrackingCounter.updateOne(
      { _id: doc._id, counter: current },
      { $set: { counter: next } }
    );

    if (res.matchedCount === 1) {
      return { trackingId: next, period, _id: String(doc._id), reservedFrom: current };
    }

    // Someone else advanced the counter concurrently — reload and retry.
  }

  throw httpError("Could not reserve a tracking number, please retry.", 409);
}

/**
 * Best-effort: hand a reserved number back after a failed provider call, so
 * a failed attempt does not permanently consume it. Pass the exact object
 * `reserveNextCounter` returned. See module comment for the two cases this
 * handles (a brand-new month's first document vs. an existing one).
 */
export async function releaseCounter({ _id, trackingId, reservedFrom }) {
  try {
    if (reservedFrom == null) {
      // This reservation created the period's first document — remove it
      // entirely (only if it's still exactly at that just-created value)
      // so the next attempt starts over at the boundary, not one past it.
      await TrackingCounter.deleteOne({ _id, counter: trackingId });
    } else {
      await TrackingCounter.updateOne(
        { _id, counter: trackingId },
        { $set: { counter: reservedFrom } }
      );
    }
  } catch (err) {
    // A failed release must never fail the request that triggered it — it
    // just means the gap isn't reclaimed this time.
    console.error("releaseCounter failed:", err?.message);
  }
}

/**
 * Read-only: the latest successfully-used counter for (ownerId, provider,
 * period), or `null` if no order has ever been created that owner+provider+
 * month (i.e. nothing to fetch).
 */
export async function peekLatestCounter(ownerId, provider, period) {
  const doc = await TrackingCounter.findOne({ ownerId, provider, period }).lean();
  return doc ? doc.counter : null;
}
