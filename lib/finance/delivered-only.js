/**
 * "Net Profit — Delivered Only" order-level cost gate (see
 * lib/finance/calculate.js's module comment for the full metric). Pure,
 * symmetric for both product cost and shipping cost: a non-DELIVERED order
 * (returned/refused/cancelled/progress) never contributes its cost to this
 * metric — that cost is real and still charged in the EXISTING, unchanged
 * `profitCents`, just not in this second one, by definition. A DELIVERED
 * order contributes its already-resolved cost, or is flagged "missing"
 * when the cost is genuinely unresolved (never silently treated as 0 —
 * same "unconfigured, not free" rule the existing productCostCents/
 * shippingCostCents totals already follow).
 *
 * This is the ONE place that gate lives, so lib/finance/calculate.js and
 * its regression test can never drift.
 *
 * @param {{delivered:boolean, costCents:number|null}} args
 *   delivered  - resolveOrderDeliveredAt(order) != null (the same
 *                canonical signal calculate.js already computes).
 *   costCents  - the order's already-resolved product OR shipping cost in
 *                integer centimes, or `null` when not configured/resolved.
 *                Irrelevant (not read) when `delivered` is false.
 * @returns {{costCents:number, missing:number}}
 *   costCents - what this order adds to the delivered-only cost total.
 *   missing   - 1 when this is a delivered order with an unresolved cost
 *               (surfaced as a warning, same as the existing missing
 *               counters), 0 otherwise.
 */
export function deliveredOnlyCostContribution({ delivered, costCents }) {
  if (!delivered) return { costCents: 0, missing: 0 };
  if (costCents == null) return { costCents: 0, missing: 1 };
  return { costCents, missing: 0 };
}
