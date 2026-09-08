/**
 * Local-timezone day-boundary helpers for the Delivered section's Delivery
 * Date filter (app/dashboard/returns). Deliberately uses the SAME
 * `new Date(year, month, day, ...)` local-time constructor convention
 * lib/tracking/counter.js#periodDateRange already established for this app
 * — `Date`'s local getters/setters follow the server's configured local
 * timezone, never UTC, so "Today"/"Yesterday" never shift by the hours-off-
 * UTC gap that UTC-based day math would introduce (an order delivered
 * shortly after local midnight must never appear under the previous day).
 *
 * Always filters on `Order.deliveredAt` — the REAL delivery moment (see
 * models/Order.js's own comment: set once, opportunistically, from the
 * provider's actual event time when known, never re-derived from
 * `createdAt`/the tracking-number date).
 */

function startOfLocalDay(date) {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
}

function addDays(date, days) {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}

const DATE_ONLY_RE = /^\d{4}-\d{2}-\d{2}$/;

/** "YYYY-MM-DD" (as a native `<input type="date">` sends it) -> local midnight `Date`. */
function parseDateOnly(value) {
  if (!DATE_ONLY_RE.test(String(value ?? ""))) return null;
  const [year, month, day] = value.split("-").map(Number);
  return new Date(year, month - 1, day, 0, 0, 0, 0);
}

/**
 * @param {string} filterValue one of DELIVERY_DATE_FILTERS (lib/returns/constants.js)
 * @param {{date?: string, start?: string, end?: string}} [custom]
 *   `date`: "YYYY-MM-DD" for "customDate". `start`/`end`: "YYYY-MM-DD" for
 *   "customRange" (`end` inclusive — the whole day, not just midnight).
 * @returns {{start: Date, end: Date} | null} a `[start, end)` range to match
 *   against `deliveredAt`, or `null` for "all" (no date restriction) / an
 *   incomplete custom input (treated as "all" rather than an error — a
 *   half-filled date picker must never silently return zero results).
 */
export function resolveDeliveryDateRange(filterValue, custom = {}) {
  const todayStart = startOfLocalDay(new Date());

  switch (filterValue) {
    case "today":
      return { start: todayStart, end: addDays(todayStart, 1) };

    case "yesterday":
      return { start: addDays(todayStart, -1), end: todayStart };

    case "last7":
      // Today plus the 6 days before it — 7 calendar days total, inclusive.
      return { start: addDays(todayStart, -6), end: addDays(todayStart, 1) };

    case "customDate": {
      const start = parseDateOnly(custom.date);
      if (!start) return null;
      return { start, end: addDays(start, 1) };
    }

    case "customRange": {
      const start = parseDateOnly(custom.start);
      if (!start) return null;
      const endDay = parseDateOnly(custom.end) ?? start;
      // Inclusive end day -> the range extends to the START of the day
      // AFTER it, same "[start, end)" convention as periodDateRange.
      return { start, end: addDays(endDay, 1) };
    }

    case "all":
    default:
      return null;
  }
}
