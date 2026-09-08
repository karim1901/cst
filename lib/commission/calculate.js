/**
 * Employee commission math. Pure functions, no I/O — see
 * lib/commission/report.js for the MongoDB query side that feeds these.
 *
 * The business rules below are preserved EXACTLY as specified; do not
 * "fix", normalize, or fill in the gaps they leave (see each function's
 * comment).
 */

/**
 * Commission units earned by ONE delivered order, from its price.
 *
 * These exact ranges — including the gap between 500 and 550, and the
 * boundary at exactly 350 — are the existing business rule, preserved
 * verbatim rather than normalized into a continuous scale. A price that
 * falls in a gap (e.g. exactly 350, or 501-549) matches none of the
 * conditions and earns 0 units; that is the specified behavior, not a bug.
 *
 * @param {number} price
 * @returns {number} commission units (0-4)
 */
export function commissionUnitsForPrice(price) {
  let units = 0;

  if (price < 350) {
    units = 1;
  }

  if (price > 350 && price <= 500) {
    units = 2;
  }

  if (price >= 550 && price <= 750) {
    units = 3;
  }

  if (price > 750) {
    units = 4;
  }

  return units;
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
 * @param {{commission:{threshold:number,commissionBelowThreshold:number,commissionAtOrAboveThreshold:number}}} employee
 * @param {Array<{price:number}>} deliveredOrders
 */
export function computeEmployeeCommission(employee, deliveredOrders) {
  const { threshold, commissionBelowThreshold, commissionAtOrAboveThreshold } = employee.commission;

  let commissionUnits = 0;
  const lineItems = deliveredOrders.map((order) => {
    const units = commissionUnitsForPrice(order.price);
    commissionUnits += units;
    return { ...order, commissionUnits: units };
  });

  const commissionRate =
    commissionUnits >= threshold ? commissionAtOrAboveThreshold : commissionBelowThreshold;
  const totalCommission = commissionUnits * commissionRate;

  return {
    deliveredOrders: deliveredOrders.length,
    commissionUnits,
    threshold,
    commissionRate,
    totalCommission,
    orders: lineItems,
  };
}
