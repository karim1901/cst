import { NextResponse } from "next/server";

import { getCurrentUser } from "@/lib/auth/current-user";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Returns the current authenticated user (sanitized) or 401. */
export async function GET() {
  const user = await getCurrentUser();

  if (!user) {
    return NextResponse.json({ user: null }, { status: 401 });
  }

  return NextResponse.json({ user });
}
