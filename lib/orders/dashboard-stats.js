/**
 * Dashboard delivery statistics — Livré / Retour counts and the delivered
 * rate between them (see app/dashboard/page.jsx). Reads only the local
 * `Order` collection (never calls Ozon/Quick live) so opening the dashboard
 * never triggers provider API traffic, the same constraint already applied
 * to the commission report (see lib/commission/report.js).
 *
 *  - "Livré" = `deliveredAt` is set — the same authoritative, set-once
 *    signal the commission system uses (see models/Order.js's field
 *    comment); never re-derived from `lastKnownStatus` text.
 *  - "Retour" = `lib/orders/status-groups.js#isReturnStatus` applied to
 *    `lastKnownStatus`, restricted to orders that were never delivered
 *    (delivery and return are mutually exclusive terminal states, so this
 *    also guards against double-counting a stale status left over from
 *    before a late delivery was observed).
 *
 * Orders still in progress (neither delivered nor returned) are counted in
 * `total` but excluded from `deliveredRate`, which is only ever computed
 * over the delivered+returned subset — an order still in transit has no
 * outcome yet to weigh in a "delivered vs. returned" rate.
 */

import Order from "@/models/Order";
import { isReturnStatus } from "@/lib/orders/status-groups";

/**
 * @param {{merchantId: string, employeeId?: string|null}} scope
 *   `employeeId` narrows to one employee's own orders (self-view); omitted
 *   (or null), a merchant sees every order under their `merchantId`,
 *   including their employees' — the same scoping rule already used by
 *   lib/commission/report.js.
 */
export async function computeOrderDeliveryStats({ merchantId, employeeId = null }) {
  const baseMatch = { merchantId };
  if (employeeId) baseMatch.employeeId = employeeId;

  const [totalOrders, delivered, undeliveredStatuses] = await Promise.all([
    Order.countDocuments(baseMatch),
    Order.countDocuments({ ...baseMatch, deliveredAt: { $ne: null } }),
    Order.find({ ...baseMatch, deliveredAt: null, lastKnownStatus: { $ne: null } })
      .select("lastKnownStatus")
      .lean(),
  ]);

  const returned = undeliveredStatuses.filter((doc) => isReturnStatus(doc.lastKnownStatus)).length;
  const resolved = delivered + returned;

  return {
    totalOrders,
    delivered,
    returned,
    // Fraction in [0, 1], or `null` when there is nothing resolved yet to
    // compute a rate from (no orders, or all still in progress) — the
    // caller must render a "no data" state rather than treating this as 0%.
    deliveredRate: resolved > 0 ? delivered / resolved : null,
  };
}
