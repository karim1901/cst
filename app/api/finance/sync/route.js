import { NextResponse } from "next/server";

import { connectToDatabase } from "@/lib/mongodb";
import { getCurrentUser } from "@/lib/auth/current-user";
import { USER_ROLES } from "@/models/User";
import { SHIPPING_PROVIDER_VALUES } from "@/lib/shipping/providers";
import { isValidPeriod } from "@/lib/tracking/counter";
import { ensurePeriodSynced } from "@/lib/sync/period-sync";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * On-demand freshness check + (if needed) targeted sync for the EXACT
 * (provider, period) a merchant currently has selected on the Finance page —
 * see lib/sync/period-sync.js for the full root-cause story and the
 * freshness/coordination rules this wraps. `merchantId` is always the
 * AUTHENTICATED session's own id — never accepted from the request body, so
 * a merchant can only ever trigger a sync scoped to their own data.
 *
 * Called from app/_components/finance/FinancePageClient.jsx whenever the
 * selected provider/period changes (in addition to the existing
 * current-month-only background trigger every dashboard page already
 * fires) — NOT a replacement for that trigger, an addition that removes the
 * "selected month" restriction for Finance specifically.
 */
export async function POST(request) {
  const currentUser = await getCurrentUser();
  if (!currentUser) {
    return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  }
  if (currentUser.role !== USER_ROLES.MERCHANT) {
    return NextResponse.json({ error: "Only merchants can trigger Finance synchronization." }, { status: 403 });
  }

  let body = null;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  const provider = body?.provider;
  if (!SHIPPING_PROVIDER_VALUES.includes(provider)) {
    return NextResponse.json({ error: "A valid provider is required." }, { status: 400 });
  }

  const period = body?.period;
  if (!isValidPeriod(period)) {
    return NextResponse.json({ error: "A valid period (YYYYMM) is required." }, { status: 400 });
  }

  await connectToDatabase();

  try {
    const result = await ensurePeriodSynced({
      merchantId: currentUser.id,
      provider,
      period,
      signal: request.signal,
    });
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    if (err?.name === "AbortError") {
      return NextResponse.json({ error: "Aborted." }, { status: 499 });
    }
    console.error("[POST /api/finance/sync]", err?.message);
    return NextResponse.json({ error: "Synchronization failed." }, { status: 500 });
  }
}
