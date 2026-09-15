/**
 * Provider-agnostic stale-local-order reconciliation — THE one place that
 * decides whether a local `Order` document should be marked provider-
 * deleted because the shipping provider no longer knows about it (deleted
 * directly in the provider's own dashboard, for example — see the real
 * reported case: an Ozon Express order removed at the provider while its
 * local mirror kept showing up in Returns/Dashboard/Commission/Finance,
 * which all read local Mongo directly and had no mechanism to ever learn
 * it was gone).
 *
 * Ozon Express's own live-fetch order LIST (app/api/orders/ozon/route.js's
 * GET) never has this problem — it re-fetches every order directly from
 * Ozon on every view, never trusting local Mongo for display at all. The
 * surfaces that DO read local Mongo directly (Returns, Dashboard stats,
 * Commission, Finance, the "all employees" Orders browser) are exactly the
 * ones this reconciliation keeps accurate — called from
 * lib/returns/sync.js#syncReturnsForMerchant, the SAME existing
 * background/"Sync now" job that already keeps local Mongo fed for those
 * surfaces, so this adds ONE more responsibility to an existing job rather
 * than inventing a new sync entry point. Every one of those 5 surfaces
 * applies `ACTIVE_PROVIDER_ORDER_FILTER` (lib/orders/provider-record-status.js)
 * to its own local-Mongo query, so a record marked here stops contributing
 * to current operational/financial figures immediately, without ever being
 * removed from the database.
 *
 * THE RULE (both providers, identical):
 *  - Provider API responds successfully AND confirms the exact tracking
 *    number does not exist -> mark the local Order `providerRecordStatus:
 *    "deleted"` (soft-delete — see models/Order.js's own field comment for
 *    why a hard delete is the wrong tool: it would silently erase real
 *    historical financial/reporting data the order legitimately
 *    contributed while it existed). Exact string match only (never
 *    startsWith/fuzzy/phone/name matching) — the identity is always
 *    {provider, trackingNumber}, scoped to the exact merchant/employee
 *    that document already belongs to (never a broader write).
 *    `lastKnownStatus`/`deliveredAt` are NEVER rewritten here — provider
 *    existence is not a shipping/delivery status.
 *  - Provider API call fails (network error, timeout, non-2xx, malformed
 *    response, or any other "unknown" classification after retrying) ->
 *    do NOT mark deleted. Keep the local order exactly as it is; log the
 *    failure for diagnostics only. A temporary API failure must never be
 *    confused with a confirmed absence.
 * A record already marked deleted needs no further lookup here — either
 * the provider still doesn't have it (nothing changes) or it was
 * recreated/rediscovered, which the SAME sync run's own discovery/create-
 * or-update pass already revives (see lib/commission/sync-historical-orders.js
 * / lib/quick/sync-order.js's "existing" branches) — so already-deleted
 * records are excluded from this module's own query up front, saving a
 * provider call that could never change anything.
 * See lib/ozon/lookup.js / lib/quick/lookup.js — the two provider-specific
 * lookup functions this module is built on top of, each already
 * implementing this same "exists" / "not_found" / "unknown" 3-way
 * distinction using that provider's own real API signals (never an
 * invented response shape).
 */

if (typeof window !== "undefined") {
  throw new Error("lib/orders/reconcile-stale-orders.js is server-only and must not be imported in client code");
}

import Order from "@/models/Order";
import {
  PROVIDER_RECORD_STATUSES,
  ACTIVE_PROVIDER_ORDER_FILTER,
  reconciliationAction,
} from "@/lib/orders/provider-record-status";

const DEFAULT_BATCH_SIZE = 5;

/**
 * @param {object} args
 * @param {string} args.merchantId
 * @param {string|null} args.employeeId
 * @param {string} args.provider
 * @param {string} args.period "YYYYMM" — reconciles only this period's local orders
 * @param {(trackingNumber:string, signal:AbortSignal) => Promise<{classification:"exists"|"not_found"|"unknown"}>} args.lookup
 *   Provider-specific existence check, already bound to real credentials —
 *   see the two callers (lib/commission/sync-historical-orders.js's usage
 *   for Ozon and Quick) for how this is built.
 * @param {AbortSignal} [args.signal]
 * @param {number} [args.batchSize]
 * @param {Set<string>} [args.knownExistingTrackingNumbers]
 *   PERFORMANCE (item 5/6 — avoid redundant provider calls): tracking
 *   numbers the SAME sync run's own discovery/fetch pass already
 *   confirmed exist (see lib/commission/sync-historical-orders.js, the
 *   caller — it already walked every candidate in range this period and
 *   knows exactly which ones are real). A local order whose tracking
 *   number is in this set is skipped here entirely — zero extra provider
 *   calls — since "does it still exist" was already answered moments ago
 *   in the same request. Only local orders NOT already confirmed this run
 *   (the genuinely suspicious ones) are looked up here. On a healthy
 *   account where nothing was deleted at the provider, this makes
 *   reconciliation cost ZERO additional API calls.
 * @returns {Promise<{checked:number, deleted:number, deletedTrackingNumbers:string[], unknown:number, skippedAlreadyConfirmed:number}>}
 *   `deleted`/`deletedTrackingNumbers` — how many/which local orders were
 *   newly MARKED provider-deleted this run (soft-delete; see module
 *   comment) — never a physical removal.
 */
export async function reconcileStaleOrdersForPeriod({
  merchantId,
  employeeId,
  provider,
  period,
  lookup,
  signal,
  batchSize = DEFAULT_BATCH_SIZE,
  knownExistingTrackingNumbers,
}) {
  const allLocalOrders = await Order.find({
    merchantId,
    employeeId,
    provider,
    numericTrackingNumber: { $regex: `^${period}` },
    // Already-deleted records need no re-check here — see module comment
    // ("A record already marked deleted needs no further lookup here").
    providerRecordStatus: ACTIVE_PROVIDER_ORDER_FILTER,
  })
    .select("_id trackingNumber")
    .lean();

  const localOrders = knownExistingTrackingNumbers
    ? allLocalOrders.filter((doc) => !knownExistingTrackingNumbers.has(doc.trackingNumber))
    : allLocalOrders;
  const skippedAlreadyConfirmed = allLocalOrders.length - localOrders.length;

  let deleted = 0;
  let unknown = 0;
  const deletedTrackingNumbers = [];

  for (let i = 0; i < localOrders.length; i += batchSize) {
    const batch = localOrders.slice(i, i + batchSize);
    await Promise.all(
      batch.map(async (doc) => {
        try {
          const { classification } = await lookup(doc.trackingNumber, signal);
          // `doc` was already selected under ACTIVE_PROVIDER_ORDER_FILTER
          // above, so `currentStatus` is always active here — passed
          // through `reconciliationAction` anyway so the RULE (not just its
          // outcome) is the single shared implementation.
          const { action } = reconciliationAction({ classification, currentStatus: null });
          if (action === "markDeleted") {
            // Exact match on the SAME document already scoped to this
            // merchant/employee/provider/trackingNumber — never a broader
            // write (item: "writes are properly scoped"). Soft-delete only
            // — see module comment — `lastKnownStatus`/`deliveredAt`
            // untouched.
            await Order.updateOne(
              {
                _id: doc._id,
                merchantId,
                employeeId,
                provider,
                trackingNumber: doc.trackingNumber,
              },
              { $set: { providerRecordStatus: PROVIDER_RECORD_STATUSES.DELETED, providerDeletedAt: new Date() } }
            );
            deleted += 1;
            deletedTrackingNumbers.push(doc.trackingNumber);
          } else if (classification === "unknown") {
            unknown += 1;
          }
          // "exists" -> nothing to do here; the live views (Ozon's own
          // per-actor fetch, Quick's own current-month reconciliation)
          // already keep status fresh — this pass's only job is detecting
          // deletion.
        } catch (error) {
          if (error?.name === "AbortError") throw error;
          unknown += 1;
          console.error(
            "[reconcileStaleOrdersForPeriod] lookup failed for",
            doc.trackingNumber,
            "-",
            error?.message
          );
        }
      })
    );
  }

  return { checked: localOrders.length, deleted, deletedTrackingNumbers, unknown, skippedAlreadyConfirmed };
}
