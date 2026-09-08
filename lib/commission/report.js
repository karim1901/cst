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
import { computeEmployeeCommission } from "@/lib/commission/calculate";
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
 * @param {{merchantId:string, period:string, employeeId?:string}} args
 */
export async function computeCommissionReport({ merchantId, period, employeeId }) {
  if (!isValidPeriod(period)) {
    throw Object.assign(new Error("period must be a valid \"YYYYMM\" string."), { statusCode: 400 });
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
    employeeId: { $in: employeeIds },
    deliveredAt: { $ne: null },
    numericTrackingNumber: { $regex: `^${period}` },
  })
    .select("employeeId provider trackingNumber numericTrackingNumber receiverName price deliveredAt")
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
      configured: true,
      ...result,
    };
  });
}
