/**
 * Which commission month does this order belong to? — Answered SOLELY from
 * the order's own tracking number, never from any date field.
 *
 * Every tracking number this app generates (Ozon and Quick alike — both
 * built from the same shared `prefix + period + "01" + counter` format, see
 * lib/tracking/counter.js#buildFullTrackingNumber) encodes its commission
 * month directly: `period` ("YYYYMM") is always the leading 6 characters of
 * `Order.numericTrackingNumber` (== the tracking number with the
 * employee/merchant prefix stripped — see models/Order.js's own comment on
 * why that field exists). This is deliberately independent of:
 *
 *  - `createdAt` — when the order was inserted into our DB (can differ from
 *    when it was actually placed, e.g. a backfilled historical order).
 *  - `deliveredAt` — when the delivery was OBSERVED/happened. An order
 *    tracking-numbered for August that happens to be delivered in
 *    September still belongs to AUGUST's commission — the tracking number
 *    is the authoritative source for "which month", full stop. See the
 *    "Commission" section of the README for the worked example.
 *
 * `deliveredAt` still answers a completely separate question — "did this
 * order ever get delivered at all" (see resolve-delivery-date.js) — the two
 * are combined, not conflated, in lib/commission/report.js.
 *
 * @param {{numericTrackingNumber?: string}} order
 * @returns {string|null} "YYYYMM", or null if it can't be determined
 *   (never invented — an order with an unparseable tracking number is
 *   excluded from every month rather than guessed into one).
 */
export function commissionPeriodFromOrder(order) {
  const numeric = order?.numericTrackingNumber;
  if (typeof numeric !== "string" || numeric.length < 6) return null;
  const period = numeric.slice(0, 6);
  return /^\d{6}$/.test(period) ? period : null;
}
