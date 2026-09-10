import { NextResponse } from "next/server";

import { SESSION_COOKIE } from "@/lib/auth/constants";
import { verifySessionToken } from "@/lib/auth/jwt";

/**
 * Request proxy (Next.js 16 — the convention previously called "middleware").
 * First line of route protection.
 *
 * It only checks that the session token is present and cryptographically
 * valid; it does NOT touch the database. Pages and API routes still call
 * `getCurrentUser()` for the authoritative check (active account, real role,
 * merchant ownership). Defense in depth, not the only gate.
 *
 * IMPORTANT — why this proxy never *force-redirects an "authenticated" user
 * away from* /login or /register:
 *
 *   The two auth checks in this app answer different questions. This proxy
 *   asks "is the JWT well-formed and unexpired?" (no DB). `getCurrentUser()`
 *   asks "does that JWT map to a real, ACTIVE account?" (DB). They diverge
 *   for a "zombie session" — a still-unexpired token whose account was since
 *   deleted or deactivated (e.g. a demo/test account, a removed employee, an
 *   impersonation target that was later deleted).
 *
 *   If this proxy bounced such a request off /login to /dashboard on the
 *   strength of the JWT alone, the dashboard's server-side
 *   `getCurrentUser()` gate would send it straight back to /login, and the
 *   proxy would bounce it again: an infinite /login <-> /dashboard 307 loop.
 *   A desktop browser surfaces that as "redirected too many times" and the
 *   user can usually clear cookies to escape; an installed iOS PWA has no
 *   address bar and no easy cookie reset, so the app simply "won't open".
 *
 *   The redundant edge bounce added no protection (keeping an authenticated
 *   user *on* the login page is harmless), so it is gone. The authoritative,
 *   DB-backed redirect for a genuinely signed-in user lives in
 *   app/login/page.jsx / app/register/page.jsx, which cannot loop because it
 *   only ever redirects when the account is real.
 */

const PROTECTED_PREFIXES = ["/dashboard"];

function redirectTo(request, pathname, { next } = {}) {
  const url = request.nextUrl.clone();
  url.pathname = pathname;
  url.search = "";
  if (next) url.searchParams.set("next", next);
  return NextResponse.redirect(url);
}

export async function proxy(request) {
  const { pathname } = request.nextUrl;

  const token = request.cookies.get(SESSION_COOKIE)?.value ?? null;
  const payload = await verifySessionToken(token);
  const hasValidToken = Boolean(payload?.sub);

  // "/" is never a real page — it only ever redirects. A zombie JWT here
  // resolves in at most two hops: "/" -> "/dashboard" (this proxy) ->
  // "/login" (the dashboard's own getCurrentUser() gate). No loop, because
  // /login is no longer bounced back.
  if (pathname === "/") {
    return redirectTo(request, hasValidToken ? "/dashboard" : "/login");
  }

  const isProtected = PROTECTED_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`)
  );

  if (isProtected && !hasValidToken) {
    const response = redirectTo(request, "/login", { next: pathname });
    // A present-but-unusable cookie (malformed, expired, bad signature)
    // should not linger and keep failing every request — clear it as we
    // send the user to log in again.
    if (token) {
      response.cookies.set(SESSION_COOKIE, "", { path: "/", maxAge: 0 });
    }
    return response;
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/", "/dashboard/:path*", "/login", "/register"],
};
