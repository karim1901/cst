import { NextResponse } from "next/server";

import { connectToDatabase } from "@/lib/mongodb";
import { reconcileAllMerchantsOzonOrders } from "@/lib/ozon/auto-reconcile";
import { reconcileAllMerchantsQuickOrders } from "@/lib/quick/auto-reconcile";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// Verified against Vercel's current published limits (docs, fetched
// 2026-09-15): with Fluid compute (default), Hobby's max AND default
// function duration is 300s — this is already at that ceiling, not over it.
// MEASURED LIVE against this project's real test merchant: running Ozon and
// Quick's full sweeps SEQUENTIALLY (the first version of this fix) took
// 325s end-to-end for a SINGLE merchant — already over the 300s ceiling on
// real data, not just a theoretical risk. Fixed by (1) running the two
// providers CONCURRENTLY below, so their wall-clock time overlaps instead
// of summing, (2) batching Ozon's city-pricing upserts into one bulkWrite
// instead of 800+ sequential round trips (lib/finance/sync-city-pricing.js
// — this alone was a large share of the original 325s), and (3) each
// provider's own fan-out (lib/ozon/auto-reconcile.js /
// lib/quick/auto-reconcile.js) stopping itself at a ~4-minute internal
// budget and deferring whatever didn't fit to tomorrow's run rather than
// risk Vercel killing this function mid-write.
export const maxDuration = 300;

/**
 * RENAMED from app/api/cron/reconcile-ozon (Vercel Hobby deployment-failure
 * fix — see vercel.json's own comment for the full story): this is now the
 * SINGLE once-daily scheduled entry point for FULL provider reconciliation,
 * covering BOTH Ozon and Quick (kept as two separate, provider-isolated
 * calls below — Quick's results/errors can never affect Ozon's or vice
 * versa) plus Ozon's city/pricing cache. Nothing here duplicates existing
 * sync logic: this only decides WHEN a `full: true` pass runs and delegates
 * everything else to lib/ozon/auto-reconcile.js / lib/quick/auto-reconcile.js
 * (which themselves delegate to lib/commission/sync-historical-orders.js —
 * one engine, not several).
 *
 * WHY A DAILY CRON IS STILL SUFFICIENT for full reconciliation even though
 * it only runs once a day: this is deliberately NOT the mechanism that
 * keeps Ozon/Quick status changes (e.g. Progress -> Delivered) fresh for
 * merchants using the app day to day — that job now belongs to
 * app/_components/shared/useBackgroundProviderSync.js, wired into every
 * page that reads the local order mirror (Orders/Dashboard/Commission/
 * Finance), which triggers the SAME underlying sync with `full: false`
 * (current month only) on every ordinary page view, regardless of cron
 * schedule or plan tier. This daily cron is the DEEPER backstop for the
 * cases page-driven sync can miss: a change in a month nobody has revisited
 * recently, or nobody on the merchant's team opening the app at all for a
 * stretch of time.
 *
 * SCHEDULE (vercel.json's `crons` entry): `"0 2 * * *"` — 02:00 UTC, once
 * daily, the maximum frequency Vercel Hobby allows (confirmed against
 * Vercel's own current published limits, fetched 2026-09-15: Hobby = once
 * per day, ±59 minutes of scheduling imprecision — a job set for 02:00 UTC
 * may actually fire any time in the 02:00-02:59 UTC hour; this is a Vercel
 * platform guarantee, not something this code controls). Chosen as a
 * low-traffic overnight window for this app's real users: Morocco
 * (Africa/Casablanca, this app's established business timezone — see
 * lib/finance/business-date.js) is UTC+1 for most of the year, making
 * 02:00 UTC = ~03:00 local; during the few weeks around Ramadan when
 * Morocco reverts to UTC+0, that becomes 02:00 local — still overnight
 * either way, so no DST-style special-casing is needed here.
 *
 * SECURITY: unchanged from the previous route — requires
 * `Authorization: Bearer <CRON_SECRET>`, exactly the header Vercel Cron
 * sends automatically once `CRON_SECRET` is a configured project
 * environment variable. No `CRON_SECRET` -> every request refused, no
 * insecure fallback. Never logs the secret, never accepts it from a query
 * string. Ozon/Quick credentials are decrypted per-merchant, server-side
 * only, inside lib/commission/sync-historical-orders.js — never returned in
 * this response, never logged.
 */
export async function GET(request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    console.error("[cron/daily-reconcile] CRON_SECRET is not configured — refusing all requests.");
    return NextResponse.json({ error: "Not configured." }, { status: 503 });
  }

  const authHeader = request.headers.get("authorization") ?? "";
  if (authHeader !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  await connectToDatabase();

  try {
    // CONCURRENT (see maxDuration's own comment for why this changed from
    // an earlier sequential version that measured over budget on real
    // data): the two providers' merchant-wide sweeps run together, so this
    // job's wall-clock time is close to max(ozonTime, quickTime) instead of
    // their sum. Each provider's own fan-out already uses controlled
    // concurrency internally (lib/ozon/auto-reconcile.js /
    // lib/quick/auto-reconcile.js) and decrypts only its OWN provider's
    // credentials per merchant, so running both at once never mixes Ozon
    // and Quick data — a failure in one provider's sweep never prevents or
    // corrupts the other's: each is independently caught and reported.
    // Both started BEFORE either is awaited — this is what makes them
    // actually run concurrently, not just look concurrent.
    const ozonPromise = reconcileAllMerchantsOzonOrders({ signal: request.signal, full: true })
      .then((summary) => [summary, null])
      .catch((err) => [null, err]);
    const quickPromise = reconcileAllMerchantsQuickOrders({ signal: request.signal, full: true })
      .then((summary) => [summary, null])
      .catch((err) => [null, err]);
    const [[ozonSummary, ozonError], [quickSummary, quickError]] = await Promise.all([ozonPromise, quickPromise]);

    if (ozonError?.name === "AbortError" || quickError?.name === "AbortError") {
      return NextResponse.json({ error: "Aborted." }, { status: 499 });
    }

    console.log(
      "[cron/daily-reconcile] ozon merchants:",
      ozonSummary?.merchantsProcessed ?? 0,
      "skipped:",
      ozonSummary?.merchantsSkipped ?? 0,
      "staleDeleted:",
      ozonSummary?.totalStaleDeleted ?? 0,
      "citiesSynced:",
      ozonSummary?.totalCitiesSynced ?? 0,
      "errors:",
      ozonSummary?.totalErrors ?? 0,
      ozonError ? `(FAILED: ${ozonError.message})` : "",
      "| quick merchants:",
      quickSummary?.merchantsProcessed ?? 0,
      "skipped:",
      quickSummary?.merchantsSkipped ?? 0,
      "staleDeleted:",
      quickSummary?.totalStaleDeleted ?? 0,
      "errors:",
      quickSummary?.totalErrors ?? 0,
      quickError ? `(FAILED: ${quickError.message})` : ""
    );

    return NextResponse.json({
      ok: !ozonError && !quickError,
      ozon: ozonSummary
        ? {
            merchantsProcessed: ozonSummary.merchantsProcessed,
            merchantsSkipped: ozonSummary.merchantsSkipped,
            totalActorsSkipped: ozonSummary.totalActorsSkipped,
            totalStaleDeleted: ozonSummary.totalStaleDeleted,
            totalCitiesSynced: ozonSummary.totalCitiesSynced,
            totalErrors: ozonSummary.totalErrors,
          }
        : { error: ozonError?.message ?? "unknown error" },
      quick: quickSummary
        ? {
            merchantsProcessed: quickSummary.merchantsProcessed,
            merchantsSkipped: quickSummary.merchantsSkipped,
            totalActorsSkipped: quickSummary.totalActorsSkipped,
            totalStaleDeleted: quickSummary.totalStaleDeleted,
            totalErrors: quickSummary.totalErrors,
          }
        : { error: quickError?.message ?? "unknown error" },
    });
  } catch (error) {
    if (error?.name === "AbortError") {
      return NextResponse.json({ error: "Aborted." }, { status: 499 });
    }
    console.error("[cron/daily-reconcile] run failed:", error?.message);
    return NextResponse.json({ error: "Reconciliation run failed." }, { status: 500 });
  }
}
