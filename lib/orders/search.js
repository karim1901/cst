/**
 * Orders-page search (app/api/orders/search/route.js) — turns a raw phone
 * or tracking-number query into a MongoDB `Order.find` filter fragment.
 *
 * MongoDB is the local source of truth for the app's order list (see
 * models/Order.js), so search reads it DIRECTLY and never probes a provider
 * API: a lookup can't fan out into hundreds of tracking-number calls, and a
 * provider timeout / rate-limit / outage can never hide an order that
 * exists locally. The fragment this returns only ever narrows a query that
 * is already scoped, server-side, to the caller's own merchant + the
 * selected provider (+ employee) — it can't widen it.
 */

export const ORDER_SEARCH_MODES = Object.freeze(["phone", "tracking"]);

/** Minimum characters before a query is worth running (below this the API
 * returns the normal list instead of scanning). */
const MIN_TRACKING_CHARS = 2;
const MIN_PHONE_DIGITS = 3;

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Normalise a Moroccan phone to the exact shape order creation stores it in
 * (`lib/validation/orders.js`: `^(06|07)\d{8}$`). Accepts `+212…`, `212…`,
 * a bare `6…/7…`, and the usual separators (spaces, dashes, parens, dots).
 * Returns the local `0XXXXXXXXX` form when it can, otherwise just the digits
 * typed so far (for partial "contains" search).
 */
export function normalizeMoroccanPhone(raw) {
  let digits = String(raw ?? "").replace(/[^\d+]/g, "");
  digits = digits.replace(/^\+/, "");
  if (digits.startsWith("212")) {
    digits = `0${digits.slice(3)}`;
  } else if (digits.length === 9 && /^[67]/.test(digits)) {
    digits = `0${digits}`;
  }
  return digits;
}

/**
 * `{ phone: … }` or `{ trackingNumber: … }` for `Order.find`, or `null`
 * when `rawValue` is too short to be a meaningful search.
 *
 * - tracking: an ANCHORED prefix regex — matches the exact number and any
 *   useful partial ("user20260901"), and Mongo can serve it from an index
 *   range rather than a collection scan. Lower-cased because a tracking
 *   number's prefix is the employee's username, which is always stored
 *   lower-case (never confused with anything else — this only touches the
 *   `trackingNumber` field).
 * - phone: a full normalised number → exact match (index-friendly); a
 *   partial → a "contains" regex, still bounded by merchant + provider.
 *   Only ever touches the `phone` field, so it can't match an address /
 *   name / product by accident.
 */
export function buildOrderSearchFilter(mode, rawValue) {
  const value = String(rawValue ?? "").trim();
  if (!value) return null;

  if (mode === "tracking") {
    const prefix = value.toLowerCase();
    if (prefix.length < MIN_TRACKING_CHARS) return null;
    return { trackingNumber: { $regex: `^${escapeRegExp(prefix)}` } };
  }

  if (mode === "phone") {
    const normalized = normalizeMoroccanPhone(value);
    if (normalized.replace(/\D/g, "").length < MIN_PHONE_DIGITS) return null;
    if (/^0[67]\d{8}$/.test(normalized)) {
      return { phone: normalized };
    }
    return { phone: { $regex: escapeRegExp(normalized) } };
  }

  return null;
}
