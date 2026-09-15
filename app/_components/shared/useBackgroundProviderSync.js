"use client";

import { useEffect } from "react";

/**
 * ONE shared trigger for the automatic, light, current-month-only provider
 * sync (`POST /api/returns/sync {full:false}` -> lib/returns/sync.js#
 * syncReturnsForMerchant -> lib/commission/sync-historical-orders.js, the
 * SAME engine the scheduled cron (app/api/cron/reconcile-ozon) and the
 * Returns page's own background sync already use — item 5's "one
 * authoritative mechanism", never a second/incompatible sync path).
 *
 * ROOT CAUSE this hook fixes (the "Delivered took too long to show up"
 * complaint): Dashboard, Commission and Finance all read the LOCAL `Order`
 * mirror directly (lib/orders/dashboard-stats.js, lib/commission/report.js,
 * lib/finance/calculate.js) — they never call Ozon/Quick live. Before this
 * fix, the ONLY things that ever refreshed that local mirror for a given
 * actor were: (a) that actor's own Orders page (which live-fetches and
 * happens to also refresh local status as a side effect — see
 * app/api/orders/ozon/route.js's `normalizeOrder`), (b) a merchant
 * specifically opening Orders or Returns (the only two pages that fired this
 * same background sync before), or (c) the scheduled cron. A merchant who
 * opened Dashboard/Commission/Finance FIRST, without visiting Orders/Returns
 * first, could see stale data for as long as the cron interval allowed —
 * unbounded in practice if cron didn't run. Adding the exact same
 * fire-and-forget trigger to those three surfaces means EVERY page a
 * merchant opens keeps the shared local mirror fresh for the current month,
 * not just two of them.
 *
 * Merchant-only (the endpoint itself enforces this too — see
 * app/api/returns/sync/route.js — this is a defense-in-depth early return,
 * not the real authorization boundary), fires ONCE per mount, never blocks
 * rendering, a failure is silently ignored (the already-loaded data is still
 * shown normally). Safe to call as often as a merchant opens any of these
 * pages — every piece it triggers is already idempotent/concurrency-safe on
 * its own (see lib/commission/sync-historical-orders.js's own module
 * comment).
 *
 * @param {boolean} isMerchant
 */
export function useBackgroundProviderSync(isMerchant) {
  useEffect(() => {
    if (!isMerchant) return;
    const controller = new AbortController();
    fetch("/api/returns/sync", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ full: false }),
      signal: controller.signal,
    }).catch(() => {});
    return () => controller.abort();
    // Intentionally once-only (mount) — never re-triggered by a filter/tab/
    // provider/month change on the page using it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}
