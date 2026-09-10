/**
 * Business-day helpers for financial reporting.
 *
 * WHY THIS EXISTS: the Finance "Advertising & Profit" Daily view used to
 * group orders by `toLocalDateKey(order.createdAt)` — where `createdAt` is
 * the MongoDB *insertion* timestamp. For an order discovered by historical
 * sync that is the day the sync ran, not the day the order was really
 * placed, so dozens of orders from different real days all collapsed onto
 * one "day". This module is the fix: group by the REAL provider creation
 * date (`Order.orderDate` — see models/Order.js), in an EXPLICIT business
 * timezone, never "whatever the server happens to be set to".
 *
 * TIMEZONE: the business operates in Morocco. Every daily key / boundary in
 * financial reporting is computed in `Africa/Casablanca`, always — not
 * server-local, not UTC. `Intl` does the zone math (no dependency, DST-safe).
 */

export const MOROCCO_TIMEZONE = "Africa/Casablanca";

// "en-CA" formats a date as "YYYY-MM-DD" — the exact key shape the rest of
// the Finance code (and AdvertisingExpense.date / OtherExpense.date) uses.
const DATE_KEY_FORMATTER = new Intl.DateTimeFormat("en-CA", {
  timeZone: MOROCCO_TIMEZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

/**
 * A `Date` (or value `new Date()` accepts) -> "YYYY-MM-DD" for the calendar
 * day it falls on in `Africa/Casablanca`. `null` for an invalid/missing
 * input (callers must handle that, never treat it as "today").
 *
 * @param {Date|string|number|null|undefined} value
 * @returns {string|null}
 */
export function businessDateKey(value) {
  if (value == null) return null;
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return DATE_KEY_FORMATTER.format(d);
}

/**
 * The date an order belongs to for BUSINESS-DAY reporting:
 *   - `order.orderDate` (the real provider creation date) when known;
 *   - `order.createdAt` (the DB insert timestamp) as an explicit LAST
 *     RESORT so the order is never silently dropped from a day/month total.
 * The fallback is flagged by `orderDateIsApproximate` so the UI/report can
 * say so — it is a stopgap for un-backfilled legacy rows, never a real
 * substitute for the provider date.
 *
 * @param {{orderDate?: Date|null, createdAt?: Date|null}} order
 * @returns {Date|null}
 */
export function businessDateForOrder(order) {
  return order?.orderDate ?? order?.createdAt ?? null;
}

/** True when this order has no real provider creation date and is running on the `createdAt` fallback. */
export function orderDateIsApproximate(order) {
  return order?.orderDate == null;
}
