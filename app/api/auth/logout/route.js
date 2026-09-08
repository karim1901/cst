import { NextResponse } from "next/server";

import { clearSessionCookie } from "@/lib/auth/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Clears the session cookie. Safe to call whether or not a session exists. */
export async function POST() {
  await clearSessionCookie();
  return NextResponse.json({ ok: true });
}
