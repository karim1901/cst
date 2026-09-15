import { NextResponse } from "next/server";

import { connectToDatabase } from "@/lib/mongodb";
import { getCurrentUser } from "@/lib/auth/current-user";
import { USER_ROLES } from "@/models/User";
import { isValidPeriod } from "@/lib/tracking/counter";
import { auditOzonReconciliation } from "@/lib/ozon/reconciliation-audit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// A full audit re-fetches this merchant's complete Ozon inventory live
// (same cost class as a "Sync now") — a diagnostic action, not a page
// load, so it gets a longer ceiling than the platform default.
export const maxDuration = 120;

/**
 * On-demand Ozon reconciliation report — see lib/ozon/reconciliation-audit.js
 * for what it computes and why it exists (item 25: a reusable diagnostic,
 * not a one-off script). Merchant-only, and ALWAYS scoped to the caller's
 * OWN merchantId — never accepted from the client, so this can never be
 * used to inspect another merchant's data (item 21/23). Read-only: makes
 * no changes to the database or to Ozon; see app/api/returns/sync (or the
 * automatic cron/Orders-page paths) for the action that actually repairs
 * what this reports.
 */
export async function GET(request) {
  const currentUser = await getCurrentUser();
  if (!currentUser) {
    return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  }
  if (currentUser.role !== USER_ROLES.MERCHANT) {
    return NextResponse.json({ error: "Only merchants can run this audit." }, { status: 403 });
  }

  const requestedPeriod = new URL(request.url).searchParams.get("period");
  const period = requestedPeriod && isValidPeriod(requestedPeriod) ? requestedPeriod : undefined;

  await connectToDatabase();

  try {
    const report = await auditOzonReconciliation({ merchantId: currentUser.id, period });
    return NextResponse.json(report);
  } catch (error) {
    console.error("[GET /api/ozon/reconciliation-audit]", error?.message);
    return NextResponse.json({ error: "Reconciliation audit failed." }, { status: 500 });
  }
}
