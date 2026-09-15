/**
 * Reusable Ozon provider-vs-local reconciliation audit — a permanent
 * diagnostic tool (item 25), not a one-off script. Compares the COMPLETE
 * authoritative Ozon inventory for one merchant/period against the local
 * `Order` mirror, using `trackingNumber` as the sole identity (never name/
 * phone/price — item 5 of the earlier reconciliation task, still the
 * rule). Read-only: performs no writes — see lib/commission/sync-historical-orders.js
 * for the function that actually repairs discrepancies (create/update/
 * self-heal/soft-delete); this module only REPORTS what does or doesn't
 * match, for on-demand debugging and for the automatic sync's own use.
 *
 * Root-cause context this exists to make visible (the real investigated
 * case — see lib/ozon/discover-counter.js's own comment and
 * lib/commission/sync-historical-orders.js's "VERIFY + SELF-HEAL" step):
 * `User.ozonTrackingCounter` can drift behind Ozon's true state (an
 * administrative correction set too low, or any other cause), silently and
 * permanently hiding real, already-delivered orders from every local
 * surface (Orders, Dashboard, Commission, Finance, Returns) since they all
 * read the SAME local `Order` mirror this audit also reads. Running this
 * audit is how that drift becomes visible again instead of a mystery
 * count.
 *
 * Scope: ONE merchant, ONE provider (Ozon-only — mirrors the fetch
 * mechanism's own per-actor tracking-number walk; there is no Ozon-wide
 * "list everything" endpoint, see lib/ozon/client.js), ONE period
 * ("YYYYMM"). Merchant isolation is structural: every query below is
 * scoped to the exact `merchantId` passed in, and Ozon credentials are
 * that merchant's own, decrypted server-side only.
 */

if (typeof window !== "undefined") {
  throw new Error("lib/ozon/reconciliation-audit.js is server-only and must not be imported in client code");
}

import User, { USER_ROLES } from "@/models/User";
import Order from "@/models/Order";
import ShippingCompany, { SHIPPING_PROVIDERS } from "@/models/ShippingCompany";
import { decryptSecret } from "@/lib/crypto/secret-box";
import { fetchOzonOrdersForMonth } from "@/lib/ozon/fetch-orders";
import { ozonTrackingPrefixFor } from "@/lib/ozon/tracking-number";
import { peekNextOzonCounter } from "@/lib/ozon/reserve-tracking-number";
import { discoverHighestOzonCounter } from "@/lib/ozon/discover-counter";
import { resolveDisplayStatus, findDeliveredAt } from "@/lib/ozon/history";
import { periodFor, MONTH_BOUNDARY_COUNTER } from "@/lib/tracking/counter";

/**
 * @param {{merchantId:string, period?:string}} args `period` defaults to
 *   the current month.
 * @returns {Promise<object>} the structured report — see the field names
 *   below, matching item 25's exact request: providerCount, localCount,
 *   missingLocal, extraLocal, providerDeliveredCount, localDeliveredCount,
 *   deliveredMismatch, deletedMismatch, statusMismatch.
 */
export async function auditOzonReconciliation({ merchantId, period }) {
  const resolvedPeriod = period || periodFor();
  const currentPeriod = periodFor();

  const shipping = await ShippingCompany.findOne({ merchantId, provider: SHIPPING_PROVIDERS.OZON_EXPRESS })
    .select("+apiKey")
    .lean();
  if (!shipping) {
    return { configured: false, period: resolvedPeriod };
  }
  const credentials = { ozonId: shipping.ozonId, apiKey: decryptSecret(shipping.apiKey) };

  const merchant = await User.findById(merchantId).select("_id name username role").lean();
  const employees = await User.find({ merchantId, role: USER_ROLES.EMPLOYEE }).select("_id name username").lean();
  const actors = [merchant, ...employees].filter(Boolean);

  // ---- Provider side: complete authoritative inventory, per actor -----
  const providerOrders = [];
  for (const actor of actors) {
    const prefix = ozonTrackingPrefixFor(actor);
    const startCounter =
      resolvedPeriod === currentPeriod
        ? (await peekNextOzonCounter(String(actor._id))) - 1
        : await discoverHighestOzonCounter(credentials, prefix, resolvedPeriod);
    if (startCounter == null || startCounter < MONTH_BOUNDARY_COUNTER) continue;

    const found = await fetchOzonOrdersForMonth(credentials, prefix, resolvedPeriod, startCounter);
    for (const merged of found) {
      providerOrders.push({
        trackingNumber: merged._fullTrackingNumber,
        actor: actor.username ?? actor.name,
        delivered: findDeliveredAt(merged) != null,
        rawStatus: resolveDisplayStatus(merged),
      });
    }
  }
  const providerByTracking = new Map(providerOrders.map((o) => [o.trackingNumber, o]));

  // ---- Local side: every Order this merchant has for this period ------
  const localAll = await Order.find({
    merchantId,
    provider: SHIPPING_PROVIDERS.OZON_EXPRESS,
    numericTrackingNumber: { $regex: `^${resolvedPeriod}` },
  })
    .select("trackingNumber lastKnownStatus deliveredAt providerRecordStatus")
    .lean();
  const localActive = localAll.filter((o) => o.providerRecordStatus !== "deleted");
  const localDeleted = localAll.filter((o) => o.providerRecordStatus === "deleted");
  const localActiveByTracking = new Map(localActive.map((o) => [o.trackingNumber, o]));

  // ---- Reconciliation ---------------------------------------------------
  const missingLocal = [...providerByTracking.keys()].filter((t) => !localActiveByTracking.has(t));
  const extraLocal = [...localActiveByTracking.keys()].filter((t) => !providerByTracking.has(t));

  const providerDelivered = new Set([...providerByTracking.values()].filter((o) => o.delivered).map((o) => o.trackingNumber));
  const localDelivered = new Set(localActive.filter((o) => o.deliveredAt != null).map((o) => o.trackingNumber));
  const deliveredMismatch = [
    ...[...providerDelivered].filter((t) => !localDelivered.has(t)).map((t) => ({ trackingNumber: t, issue: "provider_delivered_not_local" })),
    ...[...localDelivered].filter((t) => !providerDelivered.has(t)).map((t) => ({ trackingNumber: t, issue: "local_delivered_not_provider" })),
  ];

  // A local order marked "deleted" that the provider STILL confirms exists
  // — the reconciliation-logic-is-wrong case (item 11), distinct from a
  // genuinely deleted order.
  const deletedMismatch = localDeleted
    .filter((o) => providerByTracking.has(o.trackingNumber))
    .map((o) => ({ trackingNumber: o.trackingNumber, issue: "marked_deleted_but_provider_confirms_exists" }));

  const statusMismatch = [];
  for (const [trackingNumber, localOrder] of localActiveByTracking) {
    const providerOrder = providerByTracking.get(trackingNumber);
    if (!providerOrder) continue;
    if (providerOrder.rawStatus !== localOrder.lastKnownStatus) {
      statusMismatch.push({ trackingNumber, providerStatus: providerOrder.rawStatus, localStatus: localOrder.lastKnownStatus });
    }
  }

  return {
    configured: true,
    merchantId: String(merchantId),
    period: resolvedPeriod,
    providerCount: providerOrders.length,
    localCount: localActive.length,
    missingLocal,
    extraLocal,
    providerDeliveredCount: providerDelivered.size,
    localDeliveredCount: localDelivered.size,
    deliveredMismatch,
    deletedMismatch,
    statusMismatch,
    localDeletedCount: localDeleted.length,
  };
}
