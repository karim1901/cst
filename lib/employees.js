import { connectToDatabase } from "@/lib/mongodb";
import User, { USER_ROLES } from "@/models/User";

/**
 * Shape returned for an employee row — used by both the Employees page (a
 * server component that queries the DB directly) and `GET /api/employees`.
 * Never includes the password hash or the Quick Livraison API key itself,
 * only whether one is configured.
 */
export function toEmployeeSummary(userDoc) {
  return {
    id: String(userDoc._id),
    name: userDoc.name,
    username: userDoc.username ?? null,
    phone: userDoc.phone ?? null,
    isActive: userDoc.isActive,
    commission: userDoc.commission
      ? {
          threshold: userDoc.commission.threshold,
          commissionBelowThreshold: userDoc.commission.commissionBelowThreshold,
          commissionAtOrAboveThreshold: userDoc.commission.commissionAtOrAboveThreshold,
        }
      : null,
    hasQuickLivraisonApiKey: Boolean(userDoc.hasQuickLivraisonApiKey),
    createdAt: userDoc.createdAt,
    updatedAt: userDoc.updatedAt,
  };
}

/** All employees belonging to one merchant, newest first. Server-side only. */
export async function listEmployeesForMerchant(merchantId) {
  await connectToDatabase();
  const employees = await User.find({ merchantId, role: USER_ROLES.EMPLOYEE })
    .sort({ createdAt: -1 })
    .exec();
  return employees.map(toEmployeeSummary);
}

/**
 * One employee, but ONLY if it actually belongs to `merchantId` — the one
 * ownership check every "merchant acts on one of their employees" endpoint
 * needs (order listing/filters, employee edit, impersonation, ...). An id
 * that isn't a real, owned employee resolves to `null` exactly like one
 * that doesn't exist at all, so callers never need a separate "not mine"
 * branch that could leak whether an id exists under another merchant.
 */
export async function findOwnedEmployee(employeeId, merchantId, projection = "_id") {
  if (!employeeId || !/^[0-9a-fA-F]{24}$/.test(String(employeeId))) {
    return null;
  }
  await connectToDatabase();
  return User.findOne({ _id: employeeId, merchantId, role: USER_ROLES.EMPLOYEE })
    .select(projection)
    .lean();
}

/** "Below 60: 10 DH · At/above 60: 15 DH" — compact, human-readable summary. */
export function formatCommission(commission) {
  if (!commission) {
    return "Not configured";
  }
  const { threshold, commissionBelowThreshold, commissionAtOrAboveThreshold } = commission;
  return `Below ${threshold}: ${commissionBelowThreshold} DH · At/above ${threshold}: ${commissionAtOrAboveThreshold} DH`;
}
