import { NextResponse } from "next/server";

import { getCurrentUser } from "@/lib/auth/current-user";
import { USER_ROLES } from "@/models/User";
import { fetchCities } from "@/lib/quick/client";
import { normalizeQuickCities } from "@/lib/quick/parse";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Proxy for Quick Livraison's public city/district list (`GET
 * getCityIDs` — no credentials involved). Normalized to `{ cities: [{id,
 * name}] }` for the frontend selector — see lib/quick/parse.js for why the
 * normalization is best-effort.
 */
export async function GET(request) {
  const currentUser = await getCurrentUser();
  if (!currentUser) {
    return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  }
  if (currentUser.role !== USER_ROLES.MERCHANT && currentUser.role !== USER_ROLES.EMPLOYEE) {
    return NextResponse.json({ error: "Not allowed." }, { status: 403 });
  }

  try {
    const data = await fetchCities(request.signal);
    return NextResponse.json({ cities: normalizeQuickCities(data) });
  } catch (error) {
    if (error?.name === "AbortError") throw error;
    console.error("[GET /api/orders/quick/cities]", error?.message);
    return NextResponse.json(
      { error: "Could not reach Quick Livraison." },
      { status: error?.statusCode || 502 }
    );
  }
}
