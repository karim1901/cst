import { NextResponse } from "next/server";

import { connectToDatabase } from "@/lib/mongodb";
import { reconcileAllMerchantsOzonOrders } from "@/lib/ozon/auto-reconcile";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// A full run (every merchant, every employee, one Ozon lookup per local
// order the current month's own discovery pass didn't already confirm) can
// take a while on a large account base — this is a background job, not a
// page request, so it gets Vercel's serverless function ceiling rather than
// the platform default.
export const maxDuration = 300;

/**
 * Scheduled entry point for AUTOMATIC Ozon reconciliation — the mechanism
 * item 2/27/28 asks for: deletion detection that runs on its own, without a
 * merchant ever opening the Orders/Returns page. Triggered by a scheduler
 * (see vercel.json's `crons` entry, or any other cron-capable host pointed
 * at this URL with the same secret) rather than a user action — this file
 * contains NO reconciliation logic of its own; it only authenticates the
 * caller and delegates to lib/ozon/auto-reconcile.js, the SAME sync
 * architecture (lib/commission/sync-historical-orders.js /
 * lib/orders/reconcile-stale-orders.js) the Returns page's own background
 * sync already uses (item 10 — one engine, not two).
 *
 * SECURITY (item 29): requires `Authorization: Bearer <CRON_SECRET>` —
 * exactly the header Vercel Cron sends automatically once `CRON_SECRET` is
 * set as a project environment variable (see
 * https://vercel.com/docs/cron-jobs/manage-cron-jobs#securing-cron-jobs).
 * No `CRON_SECRET` configured -> every request is refused; there is no
 * insecure fallback. Never logs the secret, never accepts it from a query
 * string (which URLs/logs can leak), only the Authorization header.
 * Ozon credentials are decrypted per-merchant, server-side only, inside
 * lib/commission/sync-historical-orders.js — never returned in this
 * response, never logged.
 */
export async function GET(request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    console.error("[cron/reconcile-ozon] CRON_SECRET is not configured — refusing all requests.");
    return NextResponse.json({ error: "Not configured." }, { status: 503 });
  }

  const authHeader = request.headers.get("authorization") ?? "";
  if (authHeader !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  await connectToDatabase();

  try {
    const summary = await reconcileAllMerchantsOzonOrders({ signal: request.signal });
    console.log(
      "[cron/reconcile-ozon] merchants:",
      summary.merchantsProcessed,
      "staleDeleted:",
      summary.totalStaleDeleted,
      "errors:",
      summary.totalErrors
    );
    return NextResponse.json({
      ok: true,
      merchantsProcessed: summary.merchantsProcessed,
      totalStaleDeleted: summary.totalStaleDeleted,
      totalErrors: summary.totalErrors,
    });
  } catch (error) {
    if (error?.name === "AbortError") {
      return NextResponse.json({ error: "Aborted." }, { status: 499 });
    }
    console.error("[cron/reconcile-ozon] run failed:", error?.message);
    return NextResponse.json({ error: "Reconciliation run failed." }, { status: 500 });
  }
}
