import { NextResponse } from "next/server";

import { getCurrentUser } from "@/lib/auth/current-user";
import { USER_ROLES } from "@/models/User";
import { fetchCities } from "@/lib/ozon/client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Proxy for Ozon Express's public city list (`GET /cities` — no credentials
 * involved). Preserved from the old implementation; only used by the
 * authenticated order-creation flow, so any authenticated merchant/employee
 * can read it.
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
    return NextResponse.json(data);
  } catch (error) {
    if (error?.name === "AbortError") throw error;
    console.error("[GET /api/orders/ozon/cities]", error?.message);
    return NextResponse.json(
      { error: "Could not reach Ozon Express." },
      { status: error?.statusCode || 502 }
    );
  }
}
