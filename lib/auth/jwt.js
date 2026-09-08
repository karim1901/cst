// Import the specific entry points rather than the "jose" barrel so the Edge
// middleware bundle never pulls in the JWE/decompression code path.
import { SignJWT } from "jose/jwt/sign";
import { jwtVerify } from "jose/jwt/verify";

import { JWT_ALG, JWT_EXPIRES_IN } from "@/lib/auth/constants";

/**
 * JWT helpers built on `jose` so they run in both the Node.js runtime
 * (route handlers, server components) and the Edge runtime (middleware).
 */

function getSecretKey() {
  const secret = process.env.JWT_SECRET;

  if (!secret || secret.length < 32) {
    throw new Error(
      "JWT_SECRET is missing or too short. Set a random value of at least 32 characters (see .env.example)."
    );
  }

  return new TextEncoder().encode(secret);
}

/**
 * Sign a session token. The payload is intentionally minimal — the
 * authoritative user record is always re-read from the database by
 * `getCurrentUser()`; the claims here are only hints / fast-path data.
 *
 * `impersonatorId`: set only while a merchant is viewing the app as one of
 * their employees (see app/api/auth/impersonate/route.js) — the merchant's
 * own id, signed into the token so "return to merchant"
 * (stop-impersonating) can trust it without the client supplying anything.
 * Absent/`null` for a normal session.
 */
export async function signSessionToken({ userId, role, merchantId = null, impersonatorId = null }) {
  return new SignJWT({
    role,
    merchantId: merchantId ? String(merchantId) : null,
    impersonatorId: impersonatorId ? String(impersonatorId) : null,
  })
    .setProtectedHeader({ alg: JWT_ALG })
    .setSubject(String(userId))
    .setIssuedAt()
    .setExpirationTime(JWT_EXPIRES_IN)
    .sign(getSecretKey());
}

/**
 * Verify a session token. Returns the decoded payload, or `null` when the
 * token is missing, malformed, expired or has a bad signature.
 */
export async function verifySessionToken(token) {
  if (!token) {
    return null;
  }

  try {
    const { payload } = await jwtVerify(token, getSecretKey(), {
      algorithms: [JWT_ALG],
    });
    return payload;
  } catch {
    return null;
  }
}
