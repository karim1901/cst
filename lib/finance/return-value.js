/**
 * "Return Value" / "Validated Return Value" — the total monetary VALUE of
 * the return-category orders (Returned / Refused / Cancelled per
 * lib/orders/status-groups.js#classifyReturnReason) split by the
 * merchant's own internal "did I physically get this parcel back?" state
 * (`Order.returnValidationStatus` — see models/Order.js /
 * lib/returns/constants.js). Neither is a count, and neither is the cost
 * of handling a return (shipping / product / loss) — both are
 * `SUM(order.price)` over a subset of the Return bucket:
 *
 *   - Return Value           = Return bucket AND returnValidationStatus
 *                               !== "validated" (pending, or a legacy row
 *                               with no value at all — never treated as
 *                               validated).
 *   - Validated Return Value = Return bucket AND returnValidationStatus
 *                               === "validated".
 *
 * Together they exactly partition the Return bucket's KNOWN-price value:
 * Return Value + Validated Return Value === SUM(price) over every
 * return-bucket order whose price is usable. A validated return is
 * STILL a return order (item 16) — it is simply money the merchant has
 * already reconciled, not evidence the shipment was ever delivered; it
 * must never be confused with (or made to imply) `deliveredAt` being set.
 * The provider's own status (`lastKnownStatus`) is never touched by
 * validation and is irrelevant to either figure.
 *
 * These two pure helpers are the ONE place the "which returns count, in
 * which bucket" rule lives, so lib/finance/calculate.js and its
 * regression tests can never drift. The caller supplies already-decided
 * facts:
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
 *                 UNKNOWN and must NEVER be fabricated as a real 0 DH, in
 *                 EITHER figure.
 *   priceCents  - dhToCents(order.price) ?? 0 (only used when priceUsable).
 * @returns {{valueCents:number, unknownPriceOrders:number}}
 *   valueCents        - what this order adds to the respective total.
 *   unknownPriceOrders - 1 when this order is IN this bucket (pending for
 *                        returnValueContribution, validated for
 *                        validatedReturnValueContribution) with an unknown
 *                        price (surfaced as a warning), 0 otherwise.
 */
function returnBucketValueContribution({ isReturn, inThisBucket, priceUsable, priceCents }) {
  if (!isReturn || !inThisBucket) return { valueCents: 0, unknownPriceOrders: 0 };
  if (!priceUsable) return { valueCents: 0, unknownPriceOrders: 1 };
  return { valueCents: priceCents, unknownPriceOrders: 0 };
}

/** Return Value — pending (not yet validated) return-bucket orders. */
export function returnValueContribution({ isReturn, isValidated, priceUsable, priceCents }) {
  return returnBucketValueContribution({ isReturn, inThisBucket: !isValidated, priceUsable, priceCents });
}

/** Validated Return Value — already-validated return-bucket orders. */
export function validatedReturnValueContribution({ isReturn, isValidated, priceUsable, priceCents }) {
  return returnBucketValueContribution({ isReturn, inThisBucket: isValidated, priceUsable, priceCents });
}
