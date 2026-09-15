/**
 * Automatic, merchant-wide Quick Livraison order reconciliation — the exact
 * Quick counterpart of lib/ozon/auto-reconcile.js (see that module's own
 * comment for the full rationale; only the provider-specific pieces below
 * differ). Added alongside the Vercel Hobby cron fix so Quick gets the same
 * daily "deeper history + no manual repair ever required" guarantee Ozon
 * already had — Quick previously had NO automatic multi-month backstop at
 * all, only the page-triggered current-month sync (lib/returns/sync.js) and
 * a merchant-clicked "Sync now". This closes that gap using ONLY Quick's
 * own already-existing, already-tested sync function
 * (`syncHistoricalQuickOrders`) — no new Quick-specific logic invented, and
 * Ozon's own logic/results are never touched by this module.
 *
 * `full: false` (current month, cheap, page-triggered-equivalent scope) vs
 * `full: true` (last `DEFAULT_LOOKBACK_MONTHS` months, the once-daily
 * scope) — same split as Ozon. Quick has no per-city pricing API (verified
 * live — see lib/finance/sync-city-pricing.js's own comment), so there is
 * no Quick equivalent of Ozon's city-pricing sync step here.
 */

if (typeof window !== "undefined") {
  throw new Error("lib/quick/auto-reconcile.js is server-only and must not be imported in client code");
}

import User, { USER_ROLES } from "@/models/User";
import ShippingCompany, { SHIPPING_PROVIDERS } from "@/models/ShippingCompany";
import { syncHistoricalQuickOrders } from "@/lib/commission/sync-historical-orders";
import { periodFor } from "@/lib/tracking/counter";

const MAX_MERCHANTS_PER_RUN = 100;
const MAX_EMPLOYEES_PER_MERCHANT = 25;
const MERCHANT_BATCH_SIZE = 3;
const ACTOR_BATCH_SIZE = 3;

// Same reasoning/value as lib/ozon/auto-reconcile.js's own budget — see
// that module's comment. Kept as an independent constant (not shared/
// imported) so the two providers' budgets can never accidentally interact.
// The daily cron route runs Ozon and Quick CONCURRENTLY, so their two
// budgets overlap in wall-clock time rather than summing — measured live
// after this fix, see app/api/cron/daily-reconcile/route.js's own comment.
const FULL_RUN_TIME_BUDGET_MS = 240_000;

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

async function reconcileOneMerchant(merchantId, signal, { full = false, deadline } = {}) {
  const employees = await User.find({ merchantId, role: USER_ROLES.EMPLOYEE, isActive: true })
    .select("_id")
    .limit(MAX_EMPLOYEES_PER_MERCHANT)
    .lean();
  const actorIds = [String(merchantId), ...employees.map((e) => String(e._id))];

  const result = { merchantId: String(merchantId), actors: 0, actorsSkipped: 0, staleDeleted: 0, errors: 0 };
  const syncOptions = full ? { signal } : { periods: [periodFor()], signal };
  // Same reasoning as lib/ozon/auto-reconcile.js's identical fix — a single
  // merchant with many actors/months must not alone consume the whole run's
  // budget; the same deadline is applied one level down here too.
  const actorSkipped = await runBatched(
    actorIds,
    async (actorId) => {
      try {
        const summary = await syncHistoricalQuickOrders(actorId, syncOptions);
        result.actors += 1;
        for (const p of summary.periods ?? []) {
          result.staleDeleted += p.staleDeleted ?? 0;
        }
      } catch (err) {
        result.errors += 1;
        console.error("[quick reconcileOneMerchant]", merchantId, actorId, "-", err?.message);
      }
    },
    ACTOR_BATCH_SIZE,
    { deadline }
  );
  result.actorsSkipped = actorSkipped.length;
  return result;
}

/**
 * @param {{signal?: AbortSignal, full?: boolean}} [options]
 * @returns {Promise<{merchantsProcessed:number, merchantsSkipped:number, totalStaleDeleted:number, totalErrors:number, results:object[]}>}
 */
export async function reconcileAllMerchantsQuickOrders(options = {}) {
  const { signal, full = false } = options;
  const merchantIds = await ShippingCompany.find({ provider: SHIPPING_PROVIDERS.QUICK_LIVRAISON })
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
      "[reconcileAllMerchantsQuickOrders] time budget reached, deferring",
      skipped.length,
      "merchant(s) to the next run"
    );
  }

  return {
    merchantsProcessed: results.length,
    merchantsSkipped: skipped.length,
    totalActorsSkipped: results.reduce((sum, r) => sum + (r.actorsSkipped ?? 0), 0),
    totalStaleDeleted: results.reduce((sum, r) => sum + r.staleDeleted, 0),
    totalErrors: results.reduce((sum, r) => sum + r.errors, 0),
    results,
  };
}
