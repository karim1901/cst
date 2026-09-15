/**
 * Automatic, merchant-wide Ozon order reconciliation — the ONE function
 * both the secured cron endpoint (app/api/cron/reconcile-ozon/route.js,
 * for a scheduler-driven trigger that needs no page ever open) and the
 * Orders page's own opportunistic background sync (mirroring the pattern
 * app/dashboard/returns already established — see lib/returns/sync.js)
 * call. No second/disconnected sync engine: this is a thin fan-out over
 * the SAME `syncHistoricalOzonOrders` (lib/commission/sync-historical-orders.js)
 * that already does discovery + status refresh + stale-order soft-delete
 * (lib/orders/reconcile-stale-orders.js) for one actor — this module's own
 * job is only "which merchants/actors, and how many at once".
 *
 * Scope (item 11): CURRENT MONTH ONLY, for every actor (merchant + each of
 * their employees) of every merchant that has Ozon Express configured —
 * the same light, frequent-safe scope the Returns page's own automatic
 * background sync already uses (`full: false`). A deletion at Ozon is
 * detected on the NEXT run after it happens, not scanned for across the
 * merchant's entire history on every tick — cheap enough to run on a
 * schedule (every run costs zero extra Ozon calls for orders this run's
 * own discovery pass already confirmed exist — see
 * lib/orders/reconcile-stale-orders.js's `knownExistingTrackingNumbers`
 * optimization) without unnecessarily scanning thousands of historical
 * records. Older months still self-heal whenever a merchant opens the
 * Returns page and clicks "Sync now" (`full: true`, unchanged) — this
 * function does not replace that, only adds a NO-ACTION-REQUIRED path for
 * the common case (a deletion in the current, active month).
 */

if (typeof window !== "undefined") {
  throw new Error("lib/ozon/auto-reconcile.js is server-only and must not be imported in client code");
}

import User, { USER_ROLES } from "@/models/User";
import ShippingCompany, { SHIPPING_PROVIDERS } from "@/models/ShippingCompany";
import { syncHistoricalOzonOrders } from "@/lib/commission/sync-historical-orders";
import { periodFor } from "@/lib/tracking/counter";

// Safety ceilings for one run — this is a background job, not a page
// request, but it still must stay bounded and share the database/Ozon API
// reasonably (item 30 — never block normal page loads, never hammer the
// provider).
const MAX_MERCHANTS_PER_RUN = 100;
const MAX_EMPLOYEES_PER_MERCHANT = 25;
const MERCHANT_BATCH_SIZE = 3; // concurrent merchants in flight at once
const ACTOR_BATCH_SIZE = 3; // concurrent actor (merchant/employee) syncs per merchant, within a merchant

async function runBatched(items, worker, batchSize) {
  for (let i = 0; i < items.length; i += batchSize) {
    const batch = items.slice(i, i + batchSize);
    await Promise.all(batch.map((item) => worker(item)));
  }
}

/**
 * Reconcile ONE merchant's current-month Ozon orders (merchant + every
 * employee) — same per-actor fan-out as lib/returns/sync.js's
 * `syncProviderForMerchant`, Ozon-only.
 */
async function reconcileOneMerchant(merchantId, signal) {
  const employees = await User.find({ merchantId, role: USER_ROLES.EMPLOYEE, isActive: true })
    .select("_id")
    .limit(MAX_EMPLOYEES_PER_MERCHANT)
    .lean();
  const actorIds = [String(merchantId), ...employees.map((e) => String(e._id))];

  const result = { merchantId: String(merchantId), actors: 0, staleDeleted: 0, errors: 0 };
  await runBatched(
    actorIds,
    async (actorId) => {
      try {
        const summary = await syncHistoricalOzonOrders(actorId, { periods: [periodFor()], signal });
        result.actors += 1;
        for (const p of summary.periods ?? []) {
          result.staleDeleted += p.staleDeleted ?? 0;
        }
      } catch (err) {
        result.errors += 1;
        console.error("[reconcileOneMerchant]", merchantId, actorId, "-", err?.message);
      }
    },
    ACTOR_BATCH_SIZE
  );
  return result;
}

/**
 * Reconcile EVERY merchant that has Ozon Express configured — the entry
 * point for the scheduled cron trigger. Merchant isolation (item 21/29) is
 * automatic: each merchant's own `merchantId` scopes its own reconciliation
 * run, `syncHistoricalOzonOrders` never crosses merchants, and the Ozon
 * credentials it decrypts are that merchant's own (loaded fresh per
 * merchant, never cached/shared across merchants, never logged).
 *
 * @param {{signal?: AbortSignal}} [options]
 * @returns {Promise<{merchantsProcessed:number, totalStaleDeleted:number, totalErrors:number, results:object[]}>}
 */
export async function reconcileAllMerchantsOzonOrders(options = {}) {
  const { signal } = options;
  const merchantIds = await ShippingCompany.find({ provider: SHIPPING_PROVIDERS.OZON_EXPRESS })
    .select("merchantId")
    .limit(MAX_MERCHANTS_PER_RUN)
    .lean();

  const uniqueMerchantIds = [...new Set(merchantIds.map((doc) => String(doc.merchantId)))];

  const results = [];
  await runBatched(
    uniqueMerchantIds,
    async (merchantId) => {
      const result = await reconcileOneMerchant(merchantId, signal);
      results.push(result);
    },
    MERCHANT_BATCH_SIZE
  );

  return {
    merchantsProcessed: results.length,
    totalStaleDeleted: results.reduce((sum, r) => sum + r.staleDeleted, 0),
    totalErrors: results.reduce((sum, r) => sum + r.errors, 0),
    results,
  };
}
