/**
 * Cross-provider order-status classification — the ONE place that decides
 * which raw provider status strings mean "delivered", "return", or
 * "in progress", reused everywhere this app needs it: the Dashboard's
 * Livré/Retour cards (lib/orders/dashboard-stats.js), the Orders page's
 * status filter (Tous/Livré/Progress/Retour — app/_components/orders/
 * StatusFilter.jsx and every order-list component), and GET /api/orders'
 * server-side filtering. Client-safe (no mongoose import chain) so it can
 * be imported from client components directly.
 *
 * `Order.lastKnownStatus` (models/Order.js) stores each provider's own
 * status string verbatim — Ozon Express's French history statuses (see
 * lib/ozon/status.js) or Quick Livraison's own vocabulary. Comparisons here
 * are normalized (lowercase, accents stripped, trimmed) so a status stored
 * with different capitalization/accents/whitespace is still classified
 * correctly, without needing to know exactly how it was written.
 */

import { ORDER_STATUS as OZON_STATUS } from "@/lib/ozon/status";
import { isDeliveredDisplayStatus } from "@/lib/commission/status";

const COMBINING_DIACRITICS = new RegExp("[\\u0300-\\u036f]", "g");

function normalizeStatus(value) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(COMBINING_DIACRITICS, "") // strip accents (Retourné -> retourne, Refusé -> refuse)
    .trim()
    .toLowerCase();
}

// Ozon's own return statuses, plus their plain-English equivalents in case
// Quick Livraison (whose exact vocabulary is unconfirmed — see
// lib/quick/parse.js's module comment) or a future provider uses those
// instead. Never invents new statuses beyond this — an unrecognized status
// is simply not counted as a return. Split by REASON (cancelled/refused/
// returned) for the Returns page's own shipping-status filter
// (app/dashboard/returns — see lib/returns/constants.js's
// SHIPPING_STATUS_FILTERS, which these keys match 1:1); `RETURN_STATUS_RAW_TOKENS`
// (any reason) is derived from this, not defined separately, so there is
// exactly one place that lists every recognized return token. Kept as the
// literal (un-normalized) source lists so a MongoDB query can use the same
// sets with a case/accent-insensitive collation instead of a second,
// parallel normalization implementation in query language.
export const RETURN_REASON_RAW_TOKENS = Object.freeze({
  cancelled: [OZON_STATUS.CANCELLED, "cancelled", "canceled"],
  refused: [OZON_STATUS.REFUSED, "refused"],
  returned: [OZON_STATUS.RETURNED, "returned", "return"],
});

export const RETURN_STATUS_RAW_TOKENS = Object.values(RETURN_REASON_RAW_TOKENS).flat();

const RETURN_STATUS_TOKENS = new Set(RETURN_STATUS_RAW_TOKENS.map(normalizeStatus));

// reason -> Set of its normalized tokens, built once — the lookup
// `classifyReturnReason` below uses for a single order's status string.
const RETURN_REASON_TOKEN_SETS = Object.freeze(
  Object.fromEntries(
    Object.entries(RETURN_REASON_RAW_TOKENS).map(([reason, tokens]) => [
      reason,
      new Set(tokens.map(normalizeStatus)),
    ])
  )
);

/** @param {string|null} status a provider's raw display status string */
export function isReturnStatus(status) {
  if (!status) return false;
  return RETURN_STATUS_TOKENS.has(normalizeStatus(status));
}

/**
 * The 3 user-facing buckets the Orders page's status filter and the
 * Dashboard both group every real status into. "all" is the 4th filter
 * option (no classification — everything matches).
 */
export const ORDER_STATUS_FILTERS = Object.freeze({
  ALL: "all",
  DELIVERED: "delivered",
  PROGRESS: "progress",
  RETURN: "return",
});

export const ORDER_STATUS_FILTER_VALUES = Object.freeze(Object.values(ORDER_STATUS_FILTERS));

/**
 * Classify ONE order's live display status text into a bucket —
 * "delivered" / "return" / "progress" (never "all", that's a filter
 * choice, not a classification). Provider-aware for the delivered check
 * (Ozon vs. Quick speak different vocabularies for the same event — see
 * lib/commission/status.js), same as everywhere else in this app that
 * needs to know "was this delivered".
 *
 * @param {string} provider one of SHIPPING_PROVIDERS
 * @param {string|null} status
 */
export function classifyOrderStatus(provider, status) {
  if (isDeliveredDisplayStatus(provider, status)) return ORDER_STATUS_FILTERS.DELIVERED;
  if (isReturnStatus(status)) return ORDER_STATUS_FILTERS.RETURN;
  return ORDER_STATUS_FILTERS.PROGRESS;
}

/**
 * Does this order (by its live/best-known status text) match the given
 * status filter? Used by the two LIVE order-list surfaces (Ozon/Quick),
 * client-side and server-side alike, to filter by the same rule the
 * classification above defines. `filterValue === "all"` always matches.
 */
export function matchesStatusFilter(provider, status, filterValue) {
  if (!filterValue || filterValue === ORDER_STATUS_FILTERS.ALL) return true;
  return classifyOrderStatus(provider, status) === filterValue;
}

/**
 * Which of the 3 return REASONS (not just "is this a return") a raw status
 * string represents — "cancelled" | "refused" | "returned" | `null` (not a
 * return status at all). The one place the Returns page's shipping-status
 * filter (lib/returns/constants.js's SHIPPING_STATUS_FILTERS) is decided
 * from — never re-implemented per-provider in the UI (see this module's own
 * comment on why everything return-related is centralized here).
 */
export function classifyReturnReason(status) {
  if (!status) return null;
  const normalized = normalizeStatus(status);
  for (const [reason, tokens] of Object.entries(RETURN_REASON_TOKEN_SETS)) {
    if (tokens.has(normalized)) return reason;
  }
  return null;
}
