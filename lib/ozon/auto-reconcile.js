/**
 * Automatic, merchant-wide Ozon order reconciliation — the ONE function
 * both the secured daily cron endpoint (app/api/cron/daily-reconcile/
 * route.js, for a scheduler-driven trigger that needs no page ever open)
 * and the Orders/Dashboard/Commission/Finance pages' own opportunistic
 * background sync (app/_components/shared/useBackgroundProviderSync.js ->
 * lib/returns/sync.js) ultimately rest on. No second/disconnected sync
 * engine: this is a thin fan-out over the SAME `syncHistoricalOzonOrders`
 * (lib/commission/sync-historical-orders.js) that already does discovery +
 * status refresh + stale-order soft-delete
 * (lib/orders/reconcile-stale-orders.js) for one actor — this module's own
 * job is only "which merchants/actors, how much history, and how many at
 * once".
 *
 * TWO DISTINCT SCOPES (Vercel Hobby cron fix — see vercel.json's own
 * comment for why this split exists now):
 *
 *  - `full: false` (default) — CURRENT MONTH ONLY, for every actor. This is
 *    the light, safe-to-run-often scope — cheap enough that
 *    lib/returns/sync.js already calls it opportunistically on ordinary
 *    page views (Orders/Dashboard/Commission/Finance), independent of any
 *    cron schedule or plan tier. A deletion or status change at Ozon this
 *    month is caught the next time ANY of those pages is opened by anyone
 *    on the merchant's team — in practice far more often than any Hobby
 *    daily cron could provide on its own.
 *  - `full: true` — the LAST `DEFAULT_LOOKBACK_MONTHS` months (mirrors
 *    lib/commission/sync-historical-orders.js's own default lookback when
 *    no explicit `periods` is passed) PLUS this merchant's Ozon city/
 *    pricing cache (lib/finance/sync-city-pricing.js) — the deeper,
 *    slower pass that only needs to run once a day (exactly what Vercel
 *    Hobby's cron tier allows): catches a deletion/edit that happened in a
 *    month nobody has revisited recently, and keeps Finance's shipping-
 *    price cache current without a merchant ever needing to click
 *    "Sync now" on the Shipping Prices tab.
 */

if (typeof window !== "undefined") {
  throw new Error("lib/ozon/auto-reconcile.js is server-only and must not be imported in client code");
}

import User, { USER_ROLES } from "@/models/User";
import ShippingCompany, { SHIPPING_PROVIDERS } from "@/models/ShippingCompany";
import { syncHistoricalOzonOrders } from "@/lib/commission/sync-historical-orders";
import { syncOzonCityPricing } from "@/lib/finance/sync-city-pricing";
import { periodFor } from "@/lib/tracking/counter";

// Safety ceilings for one run — this is a background job, not a page
// request, but it still must stay bounded and share the database/Ozon API
// reasonably (never block normal page loads, never hammer the provider).
const MAX_MERCHANTS_PER_RUN = 100;
const MAX_EMPLOYEES_PER_MERCHANT = 25;
const MERCHANT_BATCH_SIZE = 3; // concurrent merchants in flight at once
const ACTOR_BATCH_SIZE = 3; // concurrent actor (merchant/employee) syncs per merchant, within a merchant

// A `full` daily run does real, unbounded-ish work (every merchant x every
// actor x several months x two Ozon calls per order) — as the merchant base
// grows, one run could in principle approach Vercel's own function ceiling
// (300s on Hobby, verified — see app/api/cron/daily-reconcile/route.js).
// Stop STARTING new merchants once this much wall-clock time has elapsed,
// leaving a safety margin before Vercel would kill the function outright.
// A merchant not reached in today's run is not a correctness problem: the
// page-triggered `full: false` sync (see module comment) keeps their
// CURRENT month fresh regardless, and tomorrow's daily run picks up exactly
// where today's left off for the deeper monthly/city-pricing pass — nothing
// here is destructive or order-dependent, so skipping a merchant this cycle
// only delays that merchant's deeper pass by one day, never corrupts data.
const FULL_RUN_TIME_BUDGET_MS = 240_000; // 4 min, under the 300s Hobby ceiling — see the cron route, which now runs Ozon+Quick CONCURRENTLY so their two budgets overlap in wall-clock time rather than summing

async function runBatched(items, worker, batchSize, { deadline } = {}) {
  const skipped = [];
  for (let i = 0; i < items.length; i += batchSize) {
    if (deadline != null && Date.now() >= deadline) {
      skipped.push(...items.slice(i));
      break;
    }
    const batch = items.slice(i, i + batchSize);
    await Promise.all(batch.map((item) => worker(item)));
  }
  return skipped;
}

/**
 * Reconcile ONE merchant's Ozon orders (merchant + every active employee) —
 * same per-actor fan-out as lib/returns/sync.js's `syncProviderForMerchant`,
 * Ozon-only. `full: true` also refreshes this merchant's Ozon city/pricing
 * cache once (merchant-scoped, not per-actor — city pricing has nothing to
 * do with which employee is asking).
 */
async function reconcileOneMerchant(merchantId, signal, { full = false, deadline } = {}) {
  const employees = await User.find({ merchantId, role: USER_ROLES.EMPLOYEE, isActive: true })
    .select("_id")
    .limit(MAX_EMPLOYEES_PER_MERCHANT)
    .lean();
  const actorIds = [String(merchantId), ...employees.map((e) => String(e._id))];

  const result = { merchantId: String(merchantId), actors: 0, actorsSkipped: 0, staleDeleted: 0, citiesSynced: 0, errors: 0 };
  const syncOptions = full ? { signal } : { periods: [periodFor()], signal };
  // Measured live (real merchant, 5 actors, 3-month full lookback): a
  // single merchant's own actor fan-out can alone take longer than
  // expected — the SAME deadline used to decide "which merchant to start
  // next" (below) is also applied here, one level down, so a merchant with
  // many actors/months can't singlehandedly blow through the whole run's
  // budget either. Perfectly safe to leave an actor's deeper pass for
  // tomorrow — see FULL_RUN_TIME_BUDGET_MS's own comment.
  const actorSkipped = await runBatched(
    actorIds,
    async (actorId) => {
      try {
        const summary = await syncHistoricalOzonOrders(actorId, syncOptions);
        result.actors += 1;
        for (const p of summary.periods ?? []) {
          result.staleDeleted += p.staleDeleted ?? 0;
        }
      } catch (err) {
        result.errors += 1;
        console.error("[reconcileOneMerchant]", merchantId, actorId, "-", err?.message);
      }
    },
    ACTOR_BATCH_SIZE,
    { deadline }
  );
  result.actorsSkipped = actorSkipped.length;

  if (full && (deadline == null || Date.now() < deadline)) {
    try {
      // Automatic (item 10/11 of the Hobby-cron fix): a merchant no longer
      // needs to remember to click "Sync now" on the Shipping Prices tab —
      // `preserveManual: true` means a price this merchant hand-corrected
      // via PATCH (source: "manual") is never silently overwritten by this
      // automatic pass; only provider-sourced/never-configured rows refresh
      // (see lib/finance/sync-city-pricing.js's own comment). Public Ozon
      // endpoint, no credentials involved (see that module).
      const cityResult = await syncOzonCityPricing(merchantId, signal, { preserveManual: true });
      result.citiesSynced = cityResult.synced;
    } catch (err) {
      result.errors += 1;
      console.error("[reconcileOneMerchant] city pricing sync failed for", merchantId, "-", err?.message);
    }
  }

  return result;
}

/**
 * Reconcile EVERY merchant that has Ozon Express configured — the entry
 * point for the scheduled cron trigger (and, with `full: false`, reusable
 * for any future merchant-wide light sweep). Merchant isolation is
 * automatic: each merchant's own `merchantId` scopes its own reconciliation
 * run, `syncHistoricalOzonOrders` never crosses merchants, and the Ozon
 * credentials it decrypts are that merchant's own (loaded fresh per
 * merchant, never cached/shared across merchants, never logged).
 *
 * @param {{signal?: AbortSignal, full?: boolean}} [options] `full` — see
 *   module comment for the two scopes. Defaults to `false`.
 * @returns {Promise<{merchantsProcessed:number, merchantsSkipped:number, totalStaleDeleted:number, totalCitiesSynced:number, totalErrors:number, results:object[]}>}
 *   `merchantsSkipped` — only ever non-zero for a `full: true` run that hit
 *   its own time budget (see `FULL_RUN_TIME_BUDGET_MS`); those merchants are
 *   picked up on the next run, not lost.
 */
export async function reconcileAllMerchantsOzonOrders(options = {}) {
  const { signal, full = false } = options;
  const merchantIds = await ShippingCompany.find({ provider: SHIPPING_PROVIDERS.OZON_EXPRESS })
    .select("merchantId")
    .limit(MAX_MERCHANTS_PER_RUN)
    .lean();

  const uniqueMerchantIds = [...new Set(merchantIds.map((doc) => String(doc.merchantId)))];

  const results = [];
  const deadline = full ? Date.now() + FULL_RUN_TIME_BUDGET_MS : undefined;
  const skipped = await runBatched(
    uniqueMerchantIds,
    async (merchantId) => {
      const result = await reconcileOneMerchant(merchantId, signal, { full, deadline });
      results.push(result);
    },
    MERCHANT_BATCH_SIZE,
    { deadline }
  );

  if (skipped.length > 0) {
    console.warn(
      "[reconcileAllMerchantsOzonOrders] time budget reached, deferring",
      skipped.length,
      "merchant(s) to the next run"
    );
  }

  return {
    merchantsProcessed: results.length,
    merchantsSkipped: skipped.length,
    totalActorsSkipped: results.reduce((sum, r) => sum + (r.actorsSkipped ?? 0), 0),
    totalStaleDeleted: results.reduce((sum, r) => sum + r.staleDeleted, 0),
    totalCitiesSynced: results.reduce((sum, r) => sum + r.citiesSynced, 0),
    totalErrors: results.reduce((sum, r) => sum + r.errors, 0),
    results,
  };
}
