/**
 * Cross-provider "Retour" classification for order statistics (see
 * app/dashboard/page.jsx and lib/orders/dashboard-stats.js). This is the one
 * place that decides which raw provider status strings count as a return,
 * so the business rule is never duplicated across dashboard components.
 *
 * `Order.lastKnownStatus` (models/Order.js) stores each provider's own
 * status string verbatim — Ozon Express's French history statuses (see
 * lib/ozon/status.js) or Quick Livraison's own vocabulary. Comparisons here
 * are normalized (lowercase, accents stripped, trimmed) so a status stored
 * with different capitalization/accents/whitespace is still classified
 * correctly, without needing to know exactly how it was written.
 */

import { ORDER_STATUS as OZON_STATUS } from "@/lib/ozon/status";

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
// is simply not counted as a return.
const RETURN_STATUS_TOKENS = new Set(
  [
    OZON_STATUS.CANCELLED,
    OZON_STATUS.RETURNED,
    OZON_STATUS.REFUSED,
    "cancelled",
    "canceled",
    "returned",
    "refused",
    "return",
  ].map(normalizeStatus)
);

/** @param {string|null} status a provider's raw display status string */
export function isReturnStatus(status) {
  if (!status) return false;
  return RETURN_STATUS_TOKENS.has(normalizeStatus(status));
}
