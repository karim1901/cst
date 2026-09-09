/**
 * Provider-agnostic stale-local-order reconciliation — THE one place that
 * decides whether a local `Order` document should be deleted because the
 * shipping provider no longer knows about it (deleted directly in the
 * provider's own dashboard, for example — see the real reported case:
 * "ibtissam202609011000" removed from Ozon Express while its local mirror
 * kept showing up in Returns/Dashboard/Commission/Finance, which all read
 * local Mongo directly and had no mechanism to ever learn it was gone).
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
 * than inventing a new sync entry point.
 *
 * THE RULE (both providers, identical):
 *  - Provider API responds successfully AND confirms the exact tracking
 *    number does not exist -> DELETE the local Order. Exact string match
 *    only (never startsWith/fuzzy/phone/name matching) — the identity is
 *    always {provider, trackingNumber}, scoped to the exact
 *    merchant/employee that document already belongs to (never a broader
 *    delete).
 *  - Provider API call fails (network error, timeout, non-2xx, malformed
 *    response, or any other "unknown" classification after retrying) ->
 *    do NOT delete. Keep the local order exactly as it is; log the failure
 *    for diagnostics only.
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

const DEFAULT_BATCH_SIZE = 5;

/**
 * @param {object} args
 * @param {string} args.merchantId
 * @param {string|null} args.employeeId
 * @param {string} args.provider
 * @param {string} args.period "YYYYMM" — reconciles only this period's local orders
 * @param {(trackingNumber:string, signal:AbortSignal) => Promise<{classification:"exists"|"not_found"|"unknown"}>} args.lookup
 *   Provider-specific existence check, already bound to real credentials —
 *   see the two callers (lib/ozon/reconcile-stale-orders.js's usage in
 *   lib/returns/sync.js, and the Quick equivalent) for how this is built.
 * @param {AbortSignal} [args.signal]
 * @param {number} [args.batchSize]
 * @returns {Promise<{checked:number, deleted:number, deletedTrackingNumbers:string[], unknown:number}>}
 */
export async function reconcileStaleOrdersForPeriod({
  merchantId,
  employeeId,
  provider,
  period,
  lookup,
  signal,
  batchSize = DEFAULT_BATCH_SIZE,
}) {
  const localOrders = await Order.find({
    merchantId,
    employeeId,
    provider,
    numericTrackingNumber: { $regex: `^${period}` },
  })
    .select("_id trackingNumber")
    .lean();

  let deleted = 0;
  let unknown = 0;
  const deletedTrackingNumbers = [];

  for (let i = 0; i < localOrders.length; i += batchSize) {
    const batch = localOrders.slice(i, i + batchSize);
    await Promise.all(
      batch.map(async (doc) => {
        try {
          const { classification } = await lookup(doc.trackingNumber, signal);
          if (classification === "not_found") {
            // Exact match on the SAME document already scoped to this
            // merchant/employee/provider/trackingNumber — never a broader
            // delete (item: "DELETE operations are properly scoped").
            await Order.deleteOne({
              _id: doc._id,
              merchantId,
              employeeId,
              provider,
              trackingNumber: doc.trackingNumber,
            });
            deleted += 1;
            deletedTrackingNumbers.push(doc.trackingNumber);
          } else if (classification === "unknown") {
            unknown += 1;
          }
          // "exists" -> nothing to do here; the live views (Ozon's own
          // per-actor fetch, Quick's own current-month reconciliation)
          // already keep status fresh — this pass's only job is deletion.
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

  return { checked: localOrders.length, deleted, deletedTrackingNumbers, unknown };
}
