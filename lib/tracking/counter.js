/**
 * Shared tracking-number format, used by every shipping provider this app
 * integrates with (currently Ozon Express and Quick Livraison — see
 * lib/ozon/tracking-number.js and lib/quick/tracking-number.js, which bind
 * these generic helpers to their own provider-specific counter storage).
 *
 *   fullTrackingNumber = prefix + period + FIXED_DAY + counter
 *   period             = YYYY + MM               (the selected/current month)
 *   FIXED_DAY           = "01"                     (always literally "01" —
 *                                                    NEVER today's actual day)
 *   counter             = a monthly sequence, starting at 1000 EVERY month
 *
 * Example: prefix "oussama", period "202608", counter 1200
 *          -> "oussama" + "202608" + "01" + "1200" -> "oussama202608011200"
 *
 * The counter is scoped to (owner, provider, period) — see
 * models/TrackingCounter.js and lib/tracking/reserve-counter.js — and does
 * NOT continue across months: September starts back at 1000 regardless of
 * where August ended. This file only knows the FORMAT; the actual per-month
 * counter storage/reservation lives in those two.
 */

// The fixed literal day segment. Never derived from the real calendar day —
// that was the exact bug this format exists to avoid (a tracking number
// must never encode "today is the 7th/15th/30th", only which MONTH it is).
const FIXED_DAY = "01";

// The first counter value every new (owner, provider, period) sequence
// gets, and the fixed lower boundary a month's order history is fetched
// down to (see lib/ozon/fetch-orders.js / app/api/orders/quick/route.js).
export const MONTH_BOUNDARY_COUNTER = 1000;

const pad2 = (value) => String(value).padStart(2, "0");

/** "YYYYMM" for the given date (defaults to now) — the month a tracking number/counter belongs to. */
export function periodFor(now = new Date()) {
  const year = now.getFullYear();
  const month = pad2(now.getMonth() + 1);
  return `${year}${month}`;
}

/** Validates the "YYYYMM" shape without asserting it's a real/sane calendar month beyond that. */
export function isValidPeriod(value) {
  return typeof value === "string" && /^\d{6}$/.test(value);
}

/**
 * `[start, end)` Date range spanning a "YYYYMM" period in local time — used
 * to filter locally-stored orders by the month they were created in (see
 * app/api/orders/quick/route.js, which lists from MongoDB rather than by
 * scanning tracking numbers). `Date`'s month-overflow behaviour (month 12
 * naturally rolls into January of the next year) is what makes December ->
 * January work here without any special-casing.
 */
export function periodDateRange(period) {
  const year = Number(period.slice(0, 4));
  const month = Number(period.slice(4, 6)); // 1-12
  const start = new Date(year, month - 1, 1, 0, 0, 0, 0);
  const end = new Date(year, month, 1, 0, 0, 0, 0);
  return { start, end };
}

/**
 * The prefix used in front of the tracking number — the same rule for every
 * provider.
 *
 *  - employee: their `username` — this is explicit, required behaviour.
 *  - merchant: merchants have no `username` (models/User.js reserves that
 *    field for employees only), so one is derived from the local part of
 *    their email. This is an architecture decision made here, not part of
 *    any preserved old behaviour — see the README's "Ozon Express" /
 *    "Quick Livraison" sections for why, and flag it for confirmation if a
 *    merchant-facing prefix needs to be something else (a chosen store
 *    handle, etc).
 */
export function trackingPrefixFor(user) {
  if (user?.username) {
    return user.username;
  }
  const local = String(user?.email ?? "").split("@")[0] ?? "";
  const sanitized = local.toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 20);
  return sanitized || "merchant";
}

/** `prefix + period + "01" + counter` — see the module comment for the format. */
export function buildFullTrackingNumber(prefix, period, counter) {
  return `${prefix}${period}${FIXED_DAY}${counter}`;
}
