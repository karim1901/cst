/**
 * "Return Value" / "Validated Return Value" — the total monetary VALUE of
 * the PRODUCT(S) in return-category orders (Returned / Refused / Cancelled
 * per lib/orders/status-groups.js#classifyReturnReason), split by the
 * merchant's own internal "did I physically get this parcel back?" state
 * (`Order.returnValidationStatus` — see models/Order.js /
 * lib/returns/constants.js).
 *
 * ROOT-CAUSE FIX: this used to be `SUM(order.price)` — the customer's full
 * SELLING price. That is wrong: these two cards exist to answer "how much
 * product cost is sitting in returns I haven't/have physically gotten
 * back", not "how much would these orders have sold for". A 220 DH order
 * for a product that costs 70 DH to source represents 70 DH of value at
 * risk in a return, not 220. Both are now
 * `SUM(ProductCost.costPerUnitCents × order.quantity)` — the EXACT same
 * per-order product-cost figure lib/finance/calculate.js already computes
 * for the `productCostCents` total (ProductCost matched against
 * `Order.productNature`, case/accent-insensitive — see that module and
 * models/ProductCost.js) — reused here, never a second/different
 * resolution.
 *
 *   - Return Value           = Return bucket AND returnValidationStatus
 *                               !== "validated" (pending, or a legacy row
 *                               with no value at all — never treated as
 *                               validated).
 *   - Validated Return Value = Return bucket AND returnValidationStatus
 *                               === "validated".
 *
 * Together they exactly partition the Return bucket's KNOWN-product-cost
 * value: Return Value + Validated Return Value === SUM(productCostCents)
 * over every return-bucket order whose product cost is configured. A
 * VALIDATED return is STILL a return order (item 16 of the original
 * classification rule) — it is simply a return the merchant has already
 * physically reconciled, not evidence the shipment was ever delivered; it
 * must never be confused with (or made to imply) `deliveredAt` being set.
 * The provider's own status (`lastKnownStatus`) is never touched by
 * validation and is irrelevant to either figure. `order.price` (the selling
 * price) is NEVER read by this module — Revenue and every other Finance
 * figure that legitimately uses the selling price are computed elsewhere,
 * untouched by this fix.
 *
 * These two pure helpers are the ONE place the "which returns count, in
 * which bucket" rule lives, so lib/finance/calculate.js and its
 * regression tests can never drift. The caller supplies already-decided
 * facts:
 *
 * @param {{isReturn:boolean, isValidated:boolean, costUsable:boolean, costCents:number}} order
 *   isReturn    - the order is in the Return bucket (bucket === RETURN in
 *                 calculate.js: not delivered AND classifyReturnReason
 *                 matched). Delivered / Progress orders pass `false`.
 *   isValidated - order.returnValidationStatus === "validated" (a legacy
 *                 row with no value is NOT validated -> pass `false`).
 *   costUsable  - the order's product cost resolved to a real number
 *                 (`productCostCents != null` — i.e. `ProductCost` has a
 *                 matching `productName` document for this order; a
 *                 genuinely configured 0 DH cost IS usable, that's a real
 *                 zero, not a missing one). FALSE when the product cannot
 *                 be matched to any `ProductCost` document — the value is
 *                 UNKNOWN and must NEVER be fabricated from `order.price`,
 *                 in EITHER figure (item 11).
 *   costCents   - productCostCents (costPerUnitCents × quantity), only used
 *                 when costUsable.
 * @returns {{valueCents:number, unknownCostOrders:number}}
 *   valueCents        - what this order adds to the respective total.
 *   unknownCostOrders - 1 when this order is IN this bucket (pending for
 *                        returnValueContribution, validated for
 *                        validatedReturnValueContribution) with an unknown
 *                        (unconfigured) product cost (surfaced as a
 *                        warning), 0 otherwise. Exposed to callers under the
 *                        existing `returnValueUnknownPriceOrders` /
 *                        `validatedReturnValueUnknownPriceOrders` field
 *                        names (kept as-is — item 20/21 — even though the
 *                        underlying cause is now an unresolved PRODUCT COST,
 *                        not an unresolved selling price).
 */
function returnBucketValueContribution({ isReturn, inThisBucket, costUsable, costCents }) {
  if (!isReturn || !inThisBucket) return { valueCents: 0, unknownCostOrders: 0 };
  if (!costUsable) return { valueCents: 0, unknownCostOrders: 1 };
  return { valueCents: costCents, unknownCostOrders: 0 };
}

/** Return Value — pending (not yet validated) return-bucket orders. */
export function returnValueContribution({ isReturn, isValidated, costUsable, costCents }) {
  return returnBucketValueContribution({ isReturn, inThisBucket: !isValidated, costUsable, costCents });
}

/** Validated Return Value — already-validated return-bucket orders. */
export function validatedReturnValueContribution({ isReturn, isValidated, costUsable, costCents }) {
  return returnBucketValueContribution({ isReturn, inThisBucket: isValidated, costUsable, costCents });
}
