/**
 * Server-side commission report: MongoDB -> per-employee monthly commission
 * (see lib/commission/calculate.js for the actual math). Never calls Ozon or
 * Quick — everything comes from the local `Order`/`User` collections, which
 * lib/commission/sync-status.js keeps fed (see its module comment for how
 * `deliveredAt` gets populated).
 *
 * An order's commission MONTH comes SOLELY from its own tracking number
 * (see lib/commission/resolve-commission-period.js) — never from
 * `createdAt`, never from `deliveredAt`. Whether it counts AT ALL is a
 * separate question, answered by lib/commission/resolve-delivery-date.js
 * (was it ever observed delivered). An order tracking-numbered for August
 * that happened to be delivered in September still belongs to AUGUST's
 * commission, not September's — see the README's "Commission" section.
 */

import { connectToDatabase } from "@/lib/mongodb";
import User, { USER_ROLES } from "@/models/User";
import Order from "@/models/Order";
import { isValidPeriod } from "@/lib/tracking/counter";
import { SHIPPING_PROVIDER_VALUES } from "@/lib/shipping/providers";
import {
  computeEmployeeCommission,
  commissionUnitsForOrder,
  commissionUnitsForPrice,
  isUsableCommissionPrice,
} from "@/lib/commission/calculate";
import { resolveOrderDeliveredAt } from "@/lib/commission/resolve-delivery-date";
import { commissionPeriodFromOrder } from "@/lib/commission/resolve-commission-period";

/**
 * Every employee of one merchant, each with their commission for `period`
 * ("YYYYMM"). One employee never sees another's orders — orders are grouped
 * strictly by `employeeId`, and only orders under this same `merchantId` are
 * ever considered.
 *
 * `employeeId` is an OPTIONAL extra narrowing filter, not a second code
 * path: passing it (see app/api/commission/route.js's employee branch)
 * narrows the very same query/calculation down to one employee instead of
 * every employee of the merchant — nothing about the math, the tracking-
 * number month rule, or the delivered-status rule changes. Omitting it
 * (the merchant view) behaves exactly as before this parameter existed.
 * The caller — never the client — decides whose id this is.
 *
 * `provider` is REQUIRED — Ozon Express and Quick Livraison commission are
 * calculated COMPLETELY SEPARATELY (item: "no mixed totals", the
 * Commission page's own explicit requirement). This narrows which orders
 * are even considered BEFORE the threshold/unit/rate math ever runs —
 * every existing rule (unit brackets, threshold-decides-the-rate-for-ALL-
 * units, tracking-number month) is applied unchanged, just to a
 * provider-scoped order set instead of a merchant-wide one. Selecting
 * "Ozon Express" can never show a Quick-derived number, and vice versa.
 *
 * @param {{merchantId:string, period:string, provider:string, employeeId?:string}} args
 */
export async function computeCommissionReport({ merchantId, period, provider, employeeId }) {
  if (!isValidPeriod(period)) {
    throw Object.assign(new Error("period must be a valid \"YYYYMM\" string."), { statusCode: 400 });
  }
  if (!SHIPPING_PROVIDER_VALUES.includes(provider)) {
    throw Object.assign(new Error("provider must be a valid shipping provider."), { statusCode: 400 });
  }

  await connectToDatabase();

  const employeeFilter = { merchantId, role: USER_ROLES.EMPLOYEE };
  if (employeeId) employeeFilter._id = employeeId;

  const employees = await User.find(employeeFilter)
    .select("name username commission")
    .sort({ createdAt: -1 })
    .lean();

  // Employees with no commission configuration can't be calculated (the
  // User schema normally requires one, but this stays defensive rather than
  // throwing — an employee row is still worth showing as "not configured").
  const employeeIds = employees.map((e) => e._id);

  // Two INDEPENDENT questions, deliberately not conflated (see
  // lib/commission/resolve-commission-period.js's module comment):
  //
  //   A. Which month does this order belong to?
  //      -> the order's OWN tracking number (numericTrackingNumber's
  //         leading "YYYYMM") — never createdAt, never deliveredAt.
  //   B. Does this order count for commission at all?
  //      -> was it ever observed delivered (deliveredAt is set)?
  //
  // The Mongo-level filter below narrows on both at once for efficiency —
  // `numericTrackingNumber` starts with the exact 6-digit period (an
  // anchored regex, so it can use the index below), and `deliveredAt` must
  // be set (any non-null value; which month it falls in is irrelevant here,
  // only whether a delivery ever happened) — then every match is
  // re-verified through the two shared resolvers below rather than trusted
  // blindly, so a corrupt/legacy document can only ever be dropped, never
  // mis-bucketed.
  const candidateOrders = await Order.find({
    merchantId,
    provider,
    employeeId: { $in: employeeIds },
    deliveredAt: { $ne: null },
    numericTrackingNumber: { $regex: `^${period}` },
  })
    .select("employeeId provider trackingNumber numericTrackingNumber receiverName price priceSource deliveredAt")
    .sort({ deliveredAt: -1 })
    .lean();

  const ordersByEmployee = new Map();
  for (const order of candidateOrders) {
    // A. Which month — re-derived from the tracking number, not trusted
    // from the query match alone.
    if (commissionPeriodFromOrder(order) !== period) continue;
    // B. Delivered at all — re-derived through the shared resolver; its
    // returned Date is shown for audit/display only, never used to decide
    // which month this order belongs to.
    const deliveredAt = resolveOrderDeliveredAt(order);
    if (!deliveredAt) continue;

    const key = String(order.employeeId);
    if (!ordersByEmployee.has(key)) ordersByEmployee.set(key, []);
    ordersByEmployee.get(key).push({
      id: String(order._id),
      provider: order.provider,
      trackingNumber: order.trackingNumber,
      receiverName: order.receiverName,
      price: order.price,
      priceSource: order.priceSource ?? null,
      deliveredAt,
    });
  }

  return employees.map((employee) => {
    const employeeOrders = ordersByEmployee.get(String(employee._id)) ?? [];

    if (!employee.commission) {
      // Defensive fallback only — the schema requires this for every
      // employee, so this path should not normally be reachable.
      return {
        employeeId: String(employee._id),
        employeeName: employee.name,
        username: employee.username,
        month: period,
        provider,
        deliveredOrders: employeeOrders.length,
        commissionUnits: null,
        threshold: null,
        commissionRate: null,
        totalCommission: null,
        orders: employeeOrders,
        configured: false,
      };
    }

    const result = computeEmployeeCommission(employee, employeeOrders);

    return {
      employeeId: String(employee._id),
      employeeName: employee.name,
      username: employee.username,
      month: period,
      provider,
      configured: true,
      ...result,
    };
  });
}

/**
 * Per-order commission AUDIT for ONE employee + ONE provider + ONE month —
 * the "prove exactly where every unit comes from" view (item 3/13).
 *
 * Uses the EXACT SAME order query, the SAME month rule
 * (`commissionPeriodFromOrder`), the SAME delivered rule
 * (`resolveOrderDeliveredAt`), and the SAME per-order unit function
 * (`commissionUnitsForOrder`) as `computeCommissionReport` above — it is a
 * transparency layer over that one calculation, NOT a second algorithm.
 *
 * `included` orders are the ones that feed `computeEmployeeCommission`;
 * `excluded` are candidates the shared resolvers dropped (a
 * tracking-number month that doesn't actually match, an unresolvable
 * delivery date). An order with an unusable price stays INCLUDED (it is a
 * real delivered order) and contributes the 1-unit floor, flagged
 * `priceUsable: false`; `priceUnits` shows what its price bracket alone
 * would say (0 when unknown) next to the effective `units`.
 *
 * @param {{merchantId:string, employeeId:string, provider:string, period:string}} args
 */
export async function auditEmployeeCommission({ merchantId, employeeId, provider, period }) {
  if (!isValidPeriod(period)) {
    throw Object.assign(new Error('period must be a valid "YYYYMM" string.'), { statusCode: 400 });
  }
  if (!SHIPPING_PROVIDER_VALUES.includes(provider)) {
    throw Object.assign(new Error("provider must be a valid shipping provider."), { statusCode: 400 });
  }

  await connectToDatabase();

  const employee = await User.findOne({ _id: employeeId, merchantId, role: USER_ROLES.EMPLOYEE })
    .select("name username commission")
    .lean();
  if (!employee) {
    throw Object.assign(new Error("Employee not found."), { statusCode: 404 });
  }

  const candidateOrders = await Order.find({
    merchantId,
    provider,
    employeeId,
    deliveredAt: { $ne: null },
    numericTrackingNumber: { $regex: `^${period}` },
  })
    .select(
      "provider trackingNumber numericTrackingNumber price priceSource lastKnownStatus deliveredAt"
    )
    .sort({ deliveredAt: -1 })
    .lean();

  const included = [];
  const excluded = [];

  for (const order of candidateOrders) {
    const trackingMonth = commissionPeriodFromOrder(order);
    if (trackingMonth !== period) {
      excluded.push({
        trackingNumber: order.trackingNumber,
        provider: order.provider,
        reason: `tracking-number month ${trackingMonth ?? "unparseable"} != ${period}`,
      });
      continue;
    }
    if (!resolveOrderDeliveredAt(order)) {
      excluded.push({
        trackingNumber: order.trackingNumber,
        provider: order.provider,
        reason: "delivery date not resolvable",
      });
      continue;
    }
    included.push({
      trackingNumber: order.trackingNumber,
      provider: order.provider,
      price: order.price,
      priceSource: order.priceSource ?? null,
      priceUsable: isUsableCommissionPrice(order.price),
      status: order.lastKnownStatus ?? null,
      month: trackingMonth,
      // Effective per-order units: a delivered order is always >= 1
      // (`commissionUnitsForOrder`); `priceUnits` is what the price
      // bracket alone says (0 when the amount is unknown).
      units: commissionUnitsForOrder({ delivered: true, price: order.price }),
      priceUnits: commissionUnitsForPrice(order.price),
      included: true,
    });
  }

  const units = included.reduce((sum, o) => sum + o.units, 0);
  const unknownPriceOrders = included.filter((o) => !o.priceUsable).length;
  const commission = employee.commission
    ? computeEmployeeCommission(employee, included.map((o) => ({ price: o.price })))
    : null;

  return {
    employeeId: String(employee._id),
    username: employee.username,
    provider,
    month: period,
    deliveredCount: included.length,
    units,
    unknownPriceOrders,
    threshold: employee.commission?.threshold ?? null,
    commissionRate: commission?.commissionRate ?? null,
    totalCommission: commission?.totalCommission ?? null,
    orders: included,
    excludedOrders: excluded,
  };
}
