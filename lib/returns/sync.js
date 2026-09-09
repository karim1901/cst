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

// Safety ceilings for one sync run — triggered from a user-facing page (not
// a background job queue), so this must stay bounded and reasonably fast,
// never scan a merchant's entire history on every page load.
const MAX_EMPLOYEES_PER_RUN = 25;
const ACTOR_BATCH_SIZE = 3; // concurrent per-actor syncs in flight at once, per provider

async function runBatched(items, worker, batchSize) {
  for (let i = 0; i < items.length; i += batchSize) {
    const batch = items.slice(i, i + batchSize);
    await Promise.all(
      batch.map((item) =>
        Promise.resolve(worker(item)).catch((err) => {
          console.error("[returns sync]", item, "-", err?.message);
        })
      )
    );
  }
}

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
