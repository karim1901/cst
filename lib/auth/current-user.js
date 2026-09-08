import { cache } from "react";

import { connectToDatabase } from "@/lib/mongodb";
import User from "@/models/User";
import { readSessionToken } from "@/lib/auth/session";
import { verifySessionToken } from "@/lib/auth/jwt";

/**
 * Shape returned to the rest of the app. Never contains the password hash or
 * any other sensitive field.
 *
 * `impersonatorId` (optional second arg) is threaded in from the verified
 * JWT payload, never the DB document — see `getCurrentUser()` below and
 * app/api/auth/impersonate/route.js. `null` for a normal session.
 */
export function toPublicUser(userDoc, impersonatorId = null) {
  return {
    id: String(userDoc._id),
    name: userDoc.name,
    // merchants/super admins have an email; employees have a username instead.
    email: userDoc.email ?? null,
    username: userDoc.username ?? null,
    role: userDoc.role,
    // null for super admins and merchants; the owning merchant for employees.
    merchantId: userDoc.merchantId ? String(userDoc.merchantId) : null,
    isActive: userDoc.isActive,
    createdAt: userDoc.createdAt,
    updatedAt: userDoc.updatedAt,
    // Set only while a merchant is viewing the app as this employee — the
    // merchant's own id, cryptographically signed into the current session
    // token (see lib/auth/jwt.js). Never derived from anything the client
    // could tamper with.
    impersonatorId,
  };
}

/**
 * The current authenticated user, or `null`.
 *
 * The role and every other attribute come from the freshly-loaded database
 * record — never from the client and never solely from the JWT — so a user
 * cannot elevate their role or change their merchant by tampering with a
 * request. Inactive accounts resolve to `null`, which invalidates any
 * existing session.
 *
 * Wrapped in `cache()` so multiple calls within one request hit the DB once.
 */
export const getCurrentUser = cache(async () => {
  const token = await readSessionToken();
  const payload = await verifySessionToken(token);

  if (!payload?.sub) {
    return null;
  }

  await connectToDatabase();

  let userDoc;
  try {
    userDoc = await User.findById(payload.sub).exec();
  } catch {
    return null; // malformed id in a forged token, etc.
  }

  if (!userDoc || !userDoc.isActive) {
    return null;
  }

  return toPublicUser(userDoc, payload.impersonatorId ?? null);
});

/** True when there is a valid, active session. */
export async function isAuthenticated() {
  return (await getCurrentUser()) !== null;
}
