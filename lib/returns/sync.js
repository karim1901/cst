/**
 * Server-only provider synchronization for the Returns page
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
 *  - Quick Livraison: has no discovery mechanism (see
 *    app/api/orders/quick/route.js's own module comment — Quick's API
 *    cannot be scanned for orders it never told this app about), so only a
 *    status refresh is possible: re-check every local Quick order that has
 *    never been observed delivered yet (the only ones whose status can
 *    still change — see models/Order.js's `deliveredAt` comment), reusing
 *    lib/quick/client.js + lib/quick/parse.js exactly like
 *    app/api/orders/quick/route.js's own GET handler already does.
 *
 * `returnValidationStatus` / `returnValidatedAt` / `returnValidatedBy` are
 * NEVER read or written here — those belong exclusively to the
 * validate/unvalidate actions (app/api/returns/[id]/validate and
 * .../unvalidate). Provider-status sync must never be able to touch them,
 * by construction (this file has no code path that could).
 */

import User, { USER_ROLES } from "@/models/User";
import Order from "@/models/Order";
import ShippingCompany, { SHIPPING_PROVIDERS } from "@/models/ShippingCompany";
import { decryptSecret } from "@/lib/crypto/secret-box";
import { fetchParcelDetails } from "@/lib/quick/client";
import { quickParcelExists, quickDisplayStatus } from "@/lib/quick/parse";
import { syncOrderStatus } from "@/lib/commission/sync-status";
import { syncHistoricalOzonOrders } from "@/lib/commission/sync-historical-orders";
import { periodFor } from "@/lib/tracking/counter";

// Safety ceilings for one sync run — triggered from a user-facing page (not
// a background job queue), so this must stay bounded and reasonably fast,
// never scan a merchant's entire history on every page load.
const MAX_EMPLOYEES_PER_RUN = 25;
const ACTOR_BATCH_SIZE = 3; // concurrent Ozon actor syncs in flight at once
const QUICK_STATUS_REFRESH_LIMIT = 150;
const QUICK_BATCH_SIZE = 5;

async function runBatched(items, worker, batchSize) {
  for (let i = 0; i < items.length; i += batchSize) {
    const batch = items.slice(i, i + batchSize);
    await Promise.all(
      batch.map((item) =>
        Promise.resolve(worker(item)).catch((err) => {
          console.error("[returns sync]", item?.trackingNumber ?? item, "-", err?.message);
        })
      )
    );
  }
}

/**
 * Re-check LIVE status for this merchant's local Quick orders that have
 * never been observed delivered yet. Never creates a new local order (Quick
 * cannot be discovered this way — see module comment) and never touches
 * anything but `lastKnownStatus`/`deliveredAt` (via syncOrderStatus).
 */
async function refreshQuickStatuses(merchantId) {
  const shipping = await ShippingCompany.findOne({
    merchantId,
    provider: SHIPPING_PROVIDERS.QUICK_LIVRAISON,
  })
    .select("+apiKey")
    .lean();
  if (!shipping) return { checked: 0 };

  const credentials = { apiKey: decryptSecret(shipping.apiKey) };

  const candidates = await Order.find({
    merchantId,
    provider: SHIPPING_PROVIDERS.QUICK_LIVRAISON,
    deliveredAt: null,
  })
    .sort({ createdAt: -1 })
    .limit(QUICK_STATUS_REFRESH_LIMIT)
    .select("trackingNumber")
    .lean();

  if (candidates.length === 0) return { checked: 0 };

  await runBatched(
    candidates,
    async (order) => {
      const { httpStatus, body } = await fetchParcelDetails(credentials, order.trackingNumber);
      if (!quickParcelExists(body, httpStatus)) return;
      const status = quickDisplayStatus(body);
      if (status) {
        syncOrderStatus({
          provider: SHIPPING_PROVIDERS.QUICK_LIVRAISON,
          trackingNumber: order.trackingNumber,
          status,
        });
      }
    },
    QUICK_BATCH_SIZE
  );

  return { checked: candidates.length };
}

/**
 * Run a full Returns-page sync for one merchant.
 *
 * @param {string} merchantId
 * @param {{full?: boolean}} [options]
 *   `full: false` (default) — current month only, for a light, automatic
 *   background sync right after the page loads.
 *   `full: true` — `syncHistoricalOzonOrders`'s own default lookback
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

  let ozonSummary = null;
  if (hasOzon) {
    const employees = await User.find({ merchantId, role: USER_ROLES.EMPLOYEE, isActive: true })
      .select("_id")
      .limit(MAX_EMPLOYEES_PER_RUN)
      .lean();
    const actorIds = [String(merchantId), ...employees.map((e) => String(e._id))];
    const ozonOptions = full ? {} : { periods: [periodFor()] };

    let actorsSynced = 0;
    await runBatched(
      actorIds,
      async (actorId) => {
        await syncHistoricalOzonOrders(actorId, ozonOptions);
        actorsSynced += 1;
      },
      ACTOR_BATCH_SIZE
    );
    ozonSummary = { actors: actorsSynced };
  }

  let quickSummary = null;
  if (hasQuick) {
    try {
      quickSummary = await refreshQuickStatuses(merchantId);
    } catch (err) {
      console.error("[returns sync] Quick status refresh failed -", err?.message);
      quickSummary = { checked: 0 };
    }
  }

  return { ozon: ozonSummary, quick: quickSummary };
}
