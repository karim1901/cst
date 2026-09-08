import { cookies } from "next/headers";

import { SESSION_COOKIE, SESSION_MAX_AGE_SECONDS } from "@/lib/auth/constants";

/**
 * Session cookie helpers for the Node.js runtime (route handlers and server
 * actions). The cookie is:
 *
 *  - httpOnly  -> not readable from JavaScript, mitigates XSS token theft
 *  - secure    -> HTTPS-only in production
 *  - sameSite  -> "lax", mitigates CSRF while allowing top-level navigation
 *  - path "/"  -> sent for the whole app
 */
export function sessionCookieOptions() {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_MAX_AGE_SECONDS,
  };
}

export async function setSessionCookie(token) {
  const store = await cookies();
  store.set(SESSION_COOKIE, token, sessionCookieOptions());
}

export async function clearSessionCookie() {
  const store = await cookies();
  store.set(SESSION_COOKIE, "", { ...sessionCookieOptions(), maxAge: 0 });
}

export async function readSessionToken() {
  const store = await cookies();
  return store.get(SESSION_COOKIE)?.value ?? null;
}
