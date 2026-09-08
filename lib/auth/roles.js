/**
 * Human-readable labels for the three roles. Kept independent of the Mongoose
 * model so it can be imported from client components without pulling in the
 * database layer.
 */
export const ROLE_LABELS = Object.freeze({
  super_admin: "Super Admin",
  merchant: "Merchant",
  employee: "Employee",
});

export function roleLabel(role) {
  return ROLE_LABELS[role] ?? role;
}
