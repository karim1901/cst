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
 */

const PROTECTED_PREFIXES = ["/dashboard"];
const AUTH_ONLY_PAGES = ["/login", "/register"];

export async function proxy(request) {
  const { pathname } = request.nextUrl;

  const token = request.cookies.get(SESSION_COOKIE)?.value ?? null;
  const payload = await verifySessionToken(token);
  const isAuthenticated = Boolean(payload?.sub);

  const isProtected = PROTECTED_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`)
  );

  if (isProtected && !isAuthenticated) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.search = "";
    url.searchParams.set("next", pathname);
    return NextResponse.redirect(url);
  }

  if (AUTH_ONLY_PAGES.includes(pathname) && isAuthenticated) {
    const url = request.nextUrl.clone();
    url.pathname = "/dashboard";
    url.search = "";
    return NextResponse.redirect(url);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/dashboard/:path*", "/login", "/register"],
};
