/**
 * Ozon Express order-status values and the logic that classifies them.
 *
 * Preserved from the old implementation: the raw values come from the Ozon
 * API in French and are kept here as constants so nothing else in the
 * codebase hard-codes the strings. Do not invent new statuses — anything
 * unrecognized falls back to being treated as "in progress".
 */

export const ORDER_STATUS = {
  DELIVERED: "Livré",
  RETURNED: "Retourné",
  CANCELLED: "Annulé",
  REFUSED: "Refusé",
  DISPATCHED: "Mise en distribution",
  NEW: "Nouveau Colis",
  SCHEDULED: "Programmé",
  AWAITING_PICKUP: "Attente De Ramassage",
  RECEIVED: "Reçu",
};

/** Statuses that count as a returned / failed delivery. */
export const RETURN_STATUSES = [
  ORDER_STATUS.CANCELLED,
  ORDER_STATUS.RETURNED,
  ORDER_STATUS.REFUSED,
];

export const isDelivered = (status) => status === ORDER_STATUS.DELIVERED;
export const isReturned = (status) => RETURN_STATUSES.includes(status);

/** Statuses for which the free-text COMMENT should NOT be shown on a card. */
const HIDDEN_COMMENT_STATUSES = [
  ORDER_STATUS.DISPATCHED,
  ORDER_STATUS.NEW,
  ORDER_STATUS.DELIVERED,
  ORDER_STATUS.AWAITING_PICKUP,
  ORDER_STATUS.RECEIVED,
];

export const shouldShowComment = (status) => !HIDDEN_COMMENT_STATUSES.includes(status);

const BADGE_KNOWN_STATUSES = [
  ORDER_STATUS.CANCELLED,
  ORDER_STATUS.RETURNED,
  ORDER_STATUS.REFUSED,
  ORDER_STATUS.DELIVERED,
  ORDER_STATUS.NEW,
  ORDER_STATUS.DISPATCHED,
];

/** Semantic color for a status badge — not from the reference design, functional (green=delivered, red=returned, ...). */
export function statusBadgeTone(status) {
  if (RETURN_STATUSES.includes(status)) return "red";
  if (status === ORDER_STATUS.DISPATCHED) return "blue";
  if (status === ORDER_STATUS.NEW) return "sky";
  if (status === ORDER_STATUS.DELIVERED) return "green";
  if (!BADGE_KNOWN_STATUSES.includes(status)) return "amber";
  return "zinc";
}
