/**
 * Helpers for reading an Ozon Express order's tracking "history".
 *
 * Preserved from the old implementation: the API returns history steps as
 * numeric string keys on the merged order object (order["2"], order["3"],
 * ...). The step count is NOT fixed — a parcel that gets rescheduled
 * ("Reporté") several times can easily exceed 20 steps (a real observed
 * case had 22, with its actual "Livré" entries at indices 20-22) — so this
 * scans EVERY present numeric key, in order, rather than a hardcoded
 * range. A fixed upper bound silently drops history entries (and whatever
 * status/date they represent) for any parcel with an unusually long
 * history, with no error or warning — see lib/commission/sync-status.js's
 * consumer, findDeliveredAt, for why that specifically matters for
 * commission.
 */

import { ORDER_STATUS } from "@/lib/ozon/status";

const HISTORY_START = 2;

/**
 * Find the first history entry whose STATUT matches `predicate`.
 * @returns {{ entry: object, index: number } | null}
 */
export function findHistoryEntry(order, predicate) {
  if (!order) return null;
  const numericKeys = Object.keys(order)
    .filter((key) => /^\d+$/.test(key) && Number(key) >= HISTORY_START)
    .sort((a, b) => Number(a) - Number(b));
  for (const key of numericKeys) {
    const entry = order[key];
    if (entry && predicate(String(entry.STATUT))) {
      return { entry, index: Number(key) };
    }
  }
  return null;
}

export const historyHasStatus = (order, status) =>
  findHistoryEntry(order, (value) => value === status) !== null;

/**
 * Resolve the status to *display* for an order: if the history contains
 * "Livré" that wins, otherwise "Retourné" wins, otherwise the order's own
 * STATUT is used. Preserved from the old implementation.
 */
export function resolveDisplayStatus(order) {
  if (historyHasStatus(order, ORDER_STATUS.DELIVERED)) return ORDER_STATUS.DELIVERED;
  if (historyHasStatus(order, ORDER_STATUS.RETURNED)) return ORDER_STATUS.RETURNED;
  return order?.STATUT;
}

/**
 * The REAL moment Ozon recorded this parcel as delivered (the "Livré"
 * history step's own `TIME`, a Unix seconds timestamp — not "whenever our
 * app happened to next check"). Used by lib/commission/sync-status.js so a
 * delivery observed several days late still gets attributed to the month it
 * actually happened in, not the month it was noticed in. Returns `null` if
 * there is no "Livré" step (order not delivered, or a shape this doesn't
 * recognize).
 */
export function findDeliveredAt(order) {
  const found = findHistoryEntry(order, (value) => value === ORDER_STATUS.DELIVERED);
  if (!found) return null;
  const seconds = Number(found.entry.TIME);
  if (!Number.isFinite(seconds) || seconds <= 0) return null;
  return new Date(seconds * 1000);
}

/**
 * The REAL moment Ozon registered this parcel — the EARLIEST tracking-
 * history step's own `TIME` (Unix seconds; step "2" is the first real
 * event, always the creation/registration one — see this module's own
 * comment on how history steps are keyed). This is the order's BUSINESS
 * creation date (models/Order.js#orderDate), distinct from `createdAt`
 * (our DB insert time — the sync run's date for a historically-discovered
 * order). Returns `null` when there is no usable history step — never
 * invented.
 */
export function findCreatedAt(order) {
  const found = findHistoryEntry(order, () => true);
  if (!found) return null;
  const seconds = Number(found.entry.TIME);
  if (!Number.isFinite(seconds) || seconds <= 0) return null;
  return new Date(seconds * 1000);
}

const LIVREUR_COMMENT_RE =
  /(?:\bTéléphone[: ]*<\/?b>?\s*|\bTéléphone[: ]*)?(?:\+212|0)[\d\s\-]{8,}/i;
const LIVREUR_DISPLAY_RE = /(?:\+212|0)[\s\-]?\d(?:[\s\-]?\d){8}/;

/**
 * Extract the courier (livreur) phone number from the "Mise en distribution"
 * / "Programmé" history step's comment. Preserved from the old
 * implementation. Returns a digits-only string or "".
 */
export function extractLivreurPhone(order) {
  const found = findHistoryEntry(
    order,
    (value) => value === ORDER_STATUS.DISPATCHED || value === ORDER_STATUS.SCHEDULED
  );
  if (!found) return "";

  const comment = found.entry.COMMENT ?? "";
  const match = comment.match(LIVREUR_COMMENT_RE);
  return match ? match[0].replace(/[^+\d]/g, "") : "";
}

/** The courier phone formatted for display. Returns "" when nothing matches. */
export function getLivreurDisplayPhone(order) {
  const phone = extractLivreurPhone(order);
  const match = phone.match(LIVREUR_DISPLAY_RE);
  return match ? match[0] : "";
}
