/**
 * Employee commission math. Pure functions, no I/O — see
 * lib/commission/report.js for the MongoDB query side that feeds these.
 *
 * The business rules below are preserved EXACTLY as specified; do not
 * "fix", normalize, or fill in the gaps they leave (see each function's
 * comment).
 *
 * `commissionUnitsForPrice` is the SINGLE authoritative price -> units
 * function for the whole app — every commission report, dashboard,
 * employee/merchant view, per-provider calculation and the audit
 * (lib/commission/report.js#auditEmployeeCommission) call THIS, never a
 * re-implemented copy of the brackets.
 */

/**
 * Is `price` a value we can honestly run the commission brackets on?
 *
 * TRUE only for a genuine, finite, strictly-positive amount (a real
 * number, or a numeric string like "400" / "400.00"). FALSE for a missing
 * price (`null`/`undefined`/`""`), `0`, a negative number, `NaN`, or a
 * non-numeric string.
 *
 * Why `0` counts as "not usable" and not as "a real order under 350 DH":
 * a stored `price` of `0` in this app is never a real 0 DH sale — it is
 * the sentinel a sync path leaves when the provider's response carried no
 * amount at all (Quick Livraison's `getParcelDetails` has no `amount`
 * field for this account — see lib/quick/sync-order.js). Treating that as
 * a legitimate "< 350 -> 1 unit" order is exactly the "silently treat an
 * invalid/missing price as 1 unit" mistake this must never make.
 */
export function isUsableCommissionPrice(price) {
  const value = typeof price === "number" ? price : Number(String(price ?? "").trim());
  return Number.isFinite(value) && value > 0;
}

/**
 * The PRICE BRACKETS ONLY — how many commission units a given amount is
 * worth, ignoring delivery status. This is NOT the per-order unit count;
 * `commissionUnitsForOrder` below is (it layers the "a delivered order is
 * always worth >= 1" business rule on top of this). Kept as its own
 * function because the per-order audit still reports "what the price alone
 * says" next to the effective figure.
 *
 * The four brackets — including the intentional gap between 500 and 550,
 * and the boundary at exactly 350 — are the existing business rule,
 * preserved VERBATIM. A real price that falls in a gap (exactly 350, or
 * 501-549) matches none and earns 0 here; that is the specified
 * behaviour, not a bug.
 *
 * A price that is NOT a usable amount (missing / 0 / negative / NaN /
 * non-numeric — see `isUsableCommissionPrice`) earns 0 here — the caller
 * decides what an unknown price means (for a DELIVERED order that is 1
 * unit, the floor; see `commissionUnitsForOrder`).
 *
 * @param {number|string|null|undefined} price
 * @returns {number} commission units from the price brackets (0-4)
 */
export function commissionUnitsForPrice(price) {
  if (!isUsableCommissionPrice(price)) return 0;

  const value = typeof price === "number" ? price : Number(String(price).trim());
  let units = 0;

  if (value < 350) {
    units = 1;
  }

  if (value > 350 && value <= 500) {
    units = 2;
  }

  if (value >= 550 && value <= 750) {
    units = 3;
  }

  if (value > 750) {
    units = 4;
  }

  return units;
}

/**
 * Commission units for ONE order — the SINGLE place the business rules
 * about a per-order unit count live.
 *
 *   NOT DELIVERED             -> 0 units. An order that never delivered
 *                               never counts, whatever its price.
 *   DELIVERED, price usable   -> the existing price brackets exactly
 *                               (`commissionUnitsForPrice`): <350 -> 1,
 *                               350<..<=500 -> 2, 550<=..<=750 -> 3,
 *                               >750 -> 4, and the intentional 350 /
 *                               501-549 gaps keep their existing 0 — the
 *                               known-price edge cases are NOT modified.
 *   DELIVERED, price unusable -> 1 unit (the floor). "Every delivered
 *                               order represents at least one product":
 *                               a missing / unknown / 0 (Quick historical
 *                               orders whose amount the Quick API never
 *                               returns) / null / NaN price must never turn
 *                               a delivered order into 0 units. If a real
 *                               price is recovered later, the brackets
 *                               above raise it (e.g. 600 -> 3)
 *                               automatically, with no status change.
 *
 * The caller passes `delivered` explicitly — the delivery check happens
 * before the unit math, so this can never be misread as "a non-delivered
 * order is worth 1".
 *
 * @param {{delivered: boolean, price: number|string|null|undefined}} order
 * @returns {number} effective commission units for this one order (0-4)
 */
export function commissionUnitsForOrder({ delivered, price }) {
  if (!delivered) return 0;
  if (!isUsableCommissionPrice(price)) return 1;
  return commissionUnitsForPrice(price);
}

/**
 * One employee's commission for a month, from their ALREADY-FILTERED
 * delivered orders (delivered, this employee's, within the selected month —
 * see lib/commission/report.js).
 *
 * NOT a progressive/tiered calculation: every unit is paid at ONE rate,
 * chosen by comparing the employee's TOTAL units for the month against
 * their threshold — never split into "first N units at rate A, the rest at
 * rate B".
 *
 * Every order here is DELIVERED by contract, so each is worth at least 1
 * unit (`commissionUnitsForOrder`); a usable price raises it via the
 * existing brackets.
 *
 * @param {{commission:{threshold:number,commissionBelowThreshold:number,commissionAtOrAboveThreshold:number}}} employee
 * @param {Array<{price:number}>} deliveredOrders
 */
export function computeEmployeeCommission(employee, deliveredOrders) {
  const { threshold, commissionBelowThreshold, commissionAtOrAboveThreshold } = employee.commission;

  let commissionUnits = 0;
  // Delivered orders whose stored price is not a usable amount (missing /
  // 0 / invalid). Each still counts as the 1-unit floor (a delivered order
  // is at least one product) — surfaced here so the report can SHOW how
  // many rows are running on that floor rather than a real price.
  let unknownPriceOrders = 0;
  const lineItems = deliveredOrders.map((order) => {
    const units = commissionUnitsForOrder({ delivered: true, price: order.price });
    const priceUsable = isUsableCommissionPrice(order.price);
    if (!priceUsable) unknownPriceOrders += 1;
    commissionUnits += units;
    return { ...order, commissionUnits: units, priceUsable };
  });

  const commissionRate =
    commissionUnits >= threshold ? commissionAtOrAboveThreshold : commissionBelowThreshold;
  const totalCommission = commissionUnits * commissionRate;

  return {
    deliveredOrders: deliveredOrders.length,
    unknownPriceOrders,
    commissionUnits,
    threshold,
    commissionRate,
    totalCommission,
    orders: lineItems,
  };
}
