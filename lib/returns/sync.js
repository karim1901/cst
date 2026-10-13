/**
 * Server-only provider synchronization for the order-lifecycle page
 * (app/dashboard/returns). Reuses the existing, already-proven integration
 * points instead of inventing new ones:
 *
 *  - Ozon Express: `syncHistoricalOzonOrders`
 *    (lib/commission/sync-historical-orders.js) already does exactly what
 *    this feature needs for one actor (a merchant or one of their
 *    employees) — walk a bounded set of months, refresh the LIVE status of
 *    every local order found (via lib/commission/sync-status.js, the same
 *    function every other order-listing route already uses) and CREATE a
 *    local mirror for any tracking number Ozon confirms is real but this
 *    app never mirrored (the exact "order exists at the provider but not
 *    locally" case the feature spec calls out — see that module's own
 *    comment for why this can happen). Called once per actor here — same
 *    generic, username-agnostic design it already has.
 *
 *  - Quick Livraison: `syncHistoricalQuickOrders`, the Quick counterpart of
 *    the above (same module) — Quick tracking numbers follow the exact same
 *    deterministic `prefix + period + "01" + counter` format as Ozon (see
 *    lib/quick/tracking-number.js), so the same discover-then-walk strategy
 *    applies, bound to Quick's own client/parse pieces. Called once per
 *    actor, exactly like Ozon, immediately below it.
 *
 * `returnValidationStatus` / `returnValidatedAt` / `returnValidatedBy` are
 * NEVER read or written here — those belong exclusively to the
 * validate/unvalidate actions (app/api/returns/[id]/validate and
 * .../unvalidate). Provider-status sync must never be able to touch them,
 * by construction (this file has no code path that could).
 */

import User, { USER_ROLES } from "@/models/User";
import ShippingCompany, { SHIPPING_PROVIDERS } from "@/models/ShippingCompany";
import {
  syncHistoricalOzonOrders,
  syncHistoricalQuickOrders,
} from "@/lib/commission/sync-historical-orders";
import { periodFor } from "@/lib/tracking/counter";
import { runBatched } from "@/lib/sync/deadline-batch";

const SYNC_FN_BY_PROVIDER = {
  [SHIPPING_PROVIDERS.OZON_EXPRESS]: syncHistoricalOzonOrders,
  [SHIPPING_PROVIDERS.QUICK_LIVRAISON]: syncHistoricalQuickOrders,
};

// Safety ceilings for one sync run — triggered from a user-facing page (not
// a background job queue), so this must stay bounded and reasonably fast,
// never scan a merchant's entire history on every page load.
const MAX_EMPLOYEES_PER_RUN = 25;
const ACTOR_BATCH_SIZE = 3; // concurrent per-actor syncs in flight at once, per provider
// `syncOneProviderPeriodForMerchant` below uses a batch size of 1 instead —
// see its own comment for why the bounded/resumable design needs the finer
// granularity.
const RESUMABLE_ACTOR_BATCH_SIZE = 1;

/**
 * Run `syncFn` (one of the two historical-sync functions above) once per
 * actor (the merchant themselves, plus each of their employees) — the
 * shared shape both providers use here.
 */
async function syncProviderForMerchant(merchantId, syncFn, options) {
  const employees = await User.find({ merchantId, role: USER_ROLES.EMPLOYEE, isActive: true })
    .select("_id")
    .limit(MAX_EMPLOYEES_PER_RUN)
    .lean();
  const actorIds = [String(merchantId), ...employees.map((e) => String(e._id))];

  let actorsSynced = 0;
  await runBatched(
    actorIds,
    async (actorId) => {
      await syncFn(actorId, options);
      actorsSynced += 1;
    },
    ACTOR_BATCH_SIZE
  );
  return { actors: actorsSynced };
}

/**
 * Run a full order-lifecycle-page sync for one merchant.
 *
 * @param {string} merchantId
 * @param {{full?: boolean}} [options]
 *   `full: false` (default) — current month only, for a light, automatic
 *   background sync right after the page loads.
 *   `full: true` — the historical-sync functions' own default lookback
 *   (currently the last 3 months), for an explicit "Sync now" click.
 * Every piece this calls is already idempotent and concurrency-safe on its
 * own (see their own module comments), so this is safe to call as often as
 * the merchant opens/refreshes the page.
 */
export async function syncReturnsForMerchant(merchantId, options = {}) {
  const { full = false } = options;

  const merchant = await User.findById(merchantId).select("role").lean();
  if (!merchant || merchant.role !== USER_ROLES.MERCHANT) {
    return { ozon: null, quick: null };
  }

  const [hasOzon, hasQuick] = await Promise.all([
    ShippingCompany.exists({ merchantId, provider: SHIPPING_PROVIDERS.OZON_EXPRESS }),
    ShippingCompany.exists({ merchantId, provider: SHIPPING_PROVIDERS.QUICK_LIVRAISON }),
  ]);

  const syncOptions = full ? {} : { periods: [periodFor()] };

  const [ozonSummary, quickSummary] = await Promise.all([
    hasOzon ? syncProviderForMerchant(merchantId, syncHistoricalOzonOrders, syncOptions) : null,
    hasQuick ? syncProviderForMerchant(merchantId, syncHistoricalQuickOrders, syncOptions) : null,
  ]);

  return { ozon: ozonSummary, quick: quickSummary };
}

/**
 * Sync EXACTLY one (provider, period) scope for one merchant — the merchant
 * themselves plus every active employee — reusing the SAME per-actor
 * fan-out and the SAME underlying `syncHistoricalOzonOrders`/
 * `syncHistoricalQuickOrders` engine as `syncReturnsForMerchant` above. This
 * is what lib/sync/period-sync.js calls for a merchant-selected Finance
 * period: far cheaper than `full: true`'s multi-month lookback (exactly one
 * period, across this merchant's actors, for one provider only — not both),
 * so it is cheap enough to run on-demand whenever a specific historical or
 * current period might be stale, with no month-age limit (see that module's
 * own comment for the freshness/coordination logic wrapped around this).
 *
 * BOUNDED + RESUMABLE (see lib/sync/period-sync.js's own comment for the
 * full reasoning): a merchant with a genuinely busy month can have enough
 * real orders that syncing every actor sequentially risks running long
 * enough to approach a serverless function's own time ceiling — measured
 * live at 28-120s for a single period across 5 actors on real data, and
 * that scales with real order volume, so there is no fixed "always safe"
 * single-call duration. `options.deadline` (a `Date.now()`-comparable
 * timestamp, same contract as lib/ozon/auto-reconcile.js's own budget) lets
 * the caller bound ONE call's own work; `options.onlyActorIds`, together
 * with the returned `remainingActorIds`, is what makes resuming exactly
 * where a previous bounded call left off possible — see `runBatched`
 * (lib/sync/deadline-batch.js) for the actual stop/skip mechanics. Uses
 * `RESUMABLE_ACTOR_BATCH_SIZE` (1, not the full fan-out's 3) so the deadline
 * check happens between every single actor rather than every batch of 3,
 * keeping one call's real overrun bounded to roughly one actor's own worst
 * case instead of three concurrent actors' worst case.
 *
 * @param {string} merchantId
 * @param {string} provider one of SHIPPING_PROVIDERS
 * @param {string} period "YYYYMM"
 * @param {{signal?: AbortSignal, deadline?: number, onlyActorIds?: string[]}} [options]
 *   `onlyActorIds` — resume a previous partial call by only (re)attempting
 *   these actors instead of recomputing the full merchant+employees list;
 *   omit for a fresh pass over everyone.
 * @returns {Promise<{actors:number, staleDeleted:number, errors:number, allActorIds:string[], remainingActorIds:string[]}>}
 *   `remainingActorIds` — actors not yet attempted because `deadline` was
 *   reached first; empty means this call covered every targeted actor.
 */
export async function syncOneProviderPeriodForMerchant(merchantId, provider, period, options = {}) {
  const { signal, deadline, onlyActorIds } = options;
  const syncFn = SYNC_FN_BY_PROVIDER[provider];
  if (!syncFn) {
    throw new Error(`Unsupported provider: ${provider}`);
  }

  const employees = await User.find({ merchantId, role: USER_ROLES.EMPLOYEE, isActive: true })
    .select("_id")
    .limit(MAX_EMPLOYEES_PER_RUN)
    .lean();
  const allActorIds = [String(merchantId), ...employees.map((e) => String(e._id))];
  const targetActorIds = onlyActorIds ?? allActorIds;

  let actorsSynced = 0;
  let staleDeleted = 0;
  let errors = 0;
  // `runBatched` itself only logs a per-item failure (see its own
  // try/catch) — it does not report one back to the caller, so this scope's
  // own error count (needed for the diagnostics lib/sync/period-sync.js
  // persists) is tracked here, around the actual sync call.
  const remainingActorIds = await runBatched(
    targetActorIds,
    async (actorId) => {
      try {
        const summary = await syncFn(actorId, { periods: [period], signal });
        actorsSynced += 1;
        for (const p of summary.periods ?? []) {
          staleDeleted += p.staleDeleted ?? 0;
        }
      } catch (err) {
        errors += 1;
        throw err; // still let runBatched's own catch log it
      }
    },
    RESUMABLE_ACTOR_BATCH_SIZE,
    { deadline }
  );

  return { actors: actorsSynced, staleDeleted, errors, allActorIds, remainingActorIds };
}
