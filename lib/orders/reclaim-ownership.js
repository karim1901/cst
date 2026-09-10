/**
 * Stale-owner detection for the historical-sync path.
 *
 * A historical-sync run (lib/commission/sync-historical-orders.js) walks
 * tracking numbers built from ONE actor's username-derived prefix
 * (lib/tracking/counter.js#trackingPrefixFor — for an employee this is
 * literally their `username`, which is globally unique, see
 * app/api/employees/route.js). Every order it rediscovers under that prefix
 * therefore provably belongs to that one actor.
 *
 * If the local `Order` mirror for such a tracking number is still linked to
 * a DIFFERENT `employeeId`, that link is stale — the usual cause is an
 * employee record being removed and a fresh one created for the same person
 * (a new `_id`), which orphans every order the old record owned. Commission,
 * Dashboard, Returns and Finance all scope strictly by the CURRENT
 * employee's `_id`, so those orphaned orders silently drop to zero
 * everywhere until the link is repaired.
 *
 * This never runs for a merchant acting directly: a merchant's own orders
 * carry `employeeId: null` by design (models/Order.js), and their prefix is
 * derived from their email, not a username.
 *
 * Pure and dependency-free so it is the single shared rule for both the
 * live sync (lib/commission/sync-historical-orders.js,
 * lib/quick/sync-order.js) and the one-off repair
 * (scripts/relink-orphaned-orders.mjs), and is unit-testable in isolation.
 *
 * @param {{
 *   syncEmployeeId: string|null|undefined,   // the employee this sync run is for (null for a merchant)
 *   syncMerchantId: string,                  // that actor's merchant scope
 *   orderEmployeeId: unknown,                // the local Order's current employeeId
 *   orderMerchantId: unknown,                // the local Order's merchantId
 * }} args
 * @returns {boolean} true only when re-pointing `orderEmployeeId` at
 *   `syncEmployeeId` is both safe and needed.
 */
export function shouldReclaimOrderOwnership({
  syncEmployeeId,
  syncMerchantId,
  orderEmployeeId,
  orderMerchantId,
}) {
  // Only an employee-scoped run can (re)claim ownership — a merchant-scoped
  // run must leave `employeeId: null` alone.
  if (!syncEmployeeId) return false;
  // Never move an order between merchants — the prefix walk already implies
  // one merchant, this is defence in depth.
  if (String(orderMerchantId ?? "") !== String(syncMerchantId ?? "")) return false;
  // Already owned by this employee — nothing to do (keeps the sync idempotent).
  return String(orderEmployeeId ?? "") !== String(syncEmployeeId);
}
