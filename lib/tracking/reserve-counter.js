/**
 * Server-only: read-only access to the per-(owner, provider, period)
 * HISTORICAL tracking-number counter — see models/TrackingCounter.js for the
 * storage shape (and why it is historical/past-month-only, not the live
 * current-month mechanism for either provider) and lib/tracking/counter.js
 * for the number FORMAT.
 */

import TrackingCounter from "@/models/TrackingCounter";

/**
 * Read-only: the latest successfully-used counter for (ownerId, provider,
 * period), or `null` if no order has ever been created that owner+provider+
 * month (i.e. nothing to fetch). Used by
 * lib/ozon/reserve-tracking-number.js#peekOzonCounterForPeriod and
 * lib/quick/reserve-tracking-number.js#peekQuickCounterForPeriod to browse a
 * PAST month — never the current one, which each provider's own live
 * `User.*TrackingCounter` field(s) answer instead.
 */
export async function peekLatestCounter(ownerId, provider, period) {
  const doc = await TrackingCounter.findOne({ ownerId, provider, period }).lean();
  return doc ? doc.counter : null;
}
