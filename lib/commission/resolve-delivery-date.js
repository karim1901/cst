/**
 * The authoritative "WAS this order ever delivered, and when?" resolver —
 * one place, so every consumer agrees on the same fallback order instead of
 * each re-deriving it.
 *
 * IMPORTANT — this answers a narrower question than it might look like:
 * "did a delivery happen at all" (used as the delivered/not-delivered gate
 * for commission eligibility), NOT "which month's commission does this
 * order belong to". That second question is answered ONLY by
 * lib/commission/resolve-commission-period.js, from the order's tracking
 * number — never from this function's return value. An order tracking-
 * numbered for August that this function reports as delivered in September
 * still belongs to AUGUST's commission; see that module's comment and the
 * README's "Commission" section for the full rationale/worked example.
 *
 * Today `Order.deliveredAt` (see models/Order.js) is the ONLY delivery date
 * this app persists locally — it is set once, atomically, the first time
 * either provider's live status is observed as delivered (see
 * lib/commission/sync-status.js), and never moved afterward. There is
 * currently no second local source (e.g. a stored status-history array) to
 * fall back to. If one is ever added, extend the chain here — every other
 * commission code path already goes through this function, not
 * `order.deliveredAt` directly, so nothing else needs to change.
 *
 * Deliberately never invents a date: an order with no resolvable delivery
 * date returns `null` (not `new Date()`, not `createdAt`) — callers must
 * treat that as "never delivered, does not qualify for any month's
 * commission", never as "today".
 *
 * @param {{deliveredAt?: Date|string|null}} order
 * @returns {Date|null}
 */
export function resolveOrderDeliveredAt(order) {
  if (order?.deliveredAt) {
    const date = order.deliveredAt instanceof Date ? order.deliveredAt : new Date(order.deliveredAt);
    if (!Number.isNaN(date.getTime())) return date;
  }
  return null;
}
