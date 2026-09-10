/**
 * "Return Value" — the total monetary VALUE of the return-category orders
 * (Returned / Refused / Cancelled) that have NOT yet been physically
 * validated/received by the merchant. This is NOT a count, and NOT the
 * cost of handling a return (shipping / product / loss) — it is
 * `SUM(order.price)` over the orders that are BOTH:
 *   - in the Return bucket (lib/orders/status-groups.js#classifyReturnReason
 *     matched), AND
 *   - `returnValidationStatus !== "validated"` — the merchant's own
 *     internal "did I physically get this parcel back?" state (see
 *     models/Order.js#returnValidationStatus / lib/returns/constants.js).
 *     A VALIDATED return is money already accounted for — it drops out of
 *     this figure entirely (its value AND its unknown-price flag). The
 *     provider's own status (`lastKnownStatus`) is never touched by
 *     validation and is irrelevant here.
 *
 * This pure helper is the ONE place the "which returns count" rule lives,
 * so lib/finance/calculate.js and its regression test can never drift. The
 * caller supplies already-decided facts:
 *
 * @param {{isReturn:boolean, isValidated:boolean, priceUsable:boolean, priceCents:number}} order
 *   isReturn    - the order is in the Return bucket (bucket === RETURN in
 *                 calculate.js: not delivered AND classifyReturnReason
 *                 matched). Delivered / Progress orders pass `false`.
 *   isValidated - order.returnValidationStatus === "validated" (a legacy
 *                 row with no value is NOT validated -> pass `false`).
 *   priceUsable - isUsableCommissionPrice(order.price): a real, finite,
 *                 strictly-positive amount. FALSE for a Quick historical
 *                 return whose amount the provider never returned
 *                 (price 0 / priceSource "unknown") — its value is
 *                 UNKNOWN and must NEVER be fabricated as a real 0 DH.
 *   priceCents  - dhToCents(order.price) ?? 0 (only used when priceUsable).
 * @returns {{valueCents:number, unknownPriceOrders:number}}
 *   valueCents        - what this order adds to the Return Value total.
 *   unknownPriceOrders - 1 when it is a PENDING return with an unknown
 *                        price (surfaced as a warning), 0 otherwise.
 */
export function returnValueContribution({ isReturn, isValidated, priceUsable, priceCents }) {
  if (!isReturn || isValidated) return { valueCents: 0, unknownPriceOrders: 0 };
  if (!priceUsable) return { valueCents: 0, unknownPriceOrders: 1 };
  return { valueCents: priceCents, unknownPriceOrders: 0 };
}
