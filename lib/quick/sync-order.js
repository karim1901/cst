/**
 * Idempotently mirror ONE Quick Livraison order (already confirmed to
 * exist — see lib/quick/parse.js#classifyQuickParcelLookup) into the local
 * `Order` collection, and return its frontend-ready shape. The ONE place
 * both lib/commission/sync-historical-orders.js#syncHistoricalQuickOrders
 * (background discovery jobs) and app/api/orders/quick/route.js's GET
 * handler (progressive per-order streaming for a historical month) do
 * this create-or-update step, so there is exactly one implementation, not
 * two that could quietly drift apart.
 *
 * NEVER creates a duplicate: an existing local Order (matched by the
 * `{provider, trackingNumber}` unique index — see models/Order.js) is only
 * ever status-refreshed (via lib/commission/sync-status.js, the same
 * function every other order-listing route already uses), never
 * recreated; a genuine E11000 race (two callers discovering the same order
 * at the same instant — e.g. two tabs open on the same historical month)
 * is treated as "the other caller already handled it", not a failure.
 */

if (typeof window !== "undefined") {
  throw new Error("lib/quick/sync-order.js is server-only and must not be imported in client code");
}

import Order from "@/models/Order";
import { SHIPPING_PROVIDERS } from "@/models/ShippingCompany";
import { quickOrderSummary, quickDisplayStatus, quickDeliveredAt, quickCreatedAt } from "@/lib/quick/parse";
import { parseProviderAmount, resolveSyncedQuickPrice } from "@/lib/quick/amount";
import { syncOrderStatus } from "@/lib/commission/sync-status";
import { shouldReclaimOrderOwnership } from "@/lib/orders/reclaim-ownership";

// Re-exported so existing importers keep working from one place.
export { parseProviderAmount, resolveSyncedQuickPrice };

/** "YYYYMM01" is always exactly 8 characters (6 for the year+month, 2 for
 * the fixed "01" day segment — see lib/tracking/counter.js); everything
 * after that is the counter portion. Used to give every Quick order a
 * numeric sort key derived purely from its tracking number, never from
 * `createdAt`/arrival order — same "never trust arrival order, always
 * derive the real numeric key" rule app/_components/orders/
 * OzonOrdersList.jsx already applies for Ozon. */
const PERIOD_PREFIX_LENGTH = 8;

export function numericCounterFromTrackingNumber(numericTrackingNumber) {
  const counterStr = String(numericTrackingNumber ?? "").slice(PERIOD_PREFIX_LENGTH);
  const value = Number(counterStr);
  return Number.isFinite(value) ? value : 0;
}


/** Shape every caller (background sync, live streaming) normalizes an
 * Order document into for the frontend — identical fields the Orders page
 * already expects from the existing current-month path. */
export function normalizeQuickOrderForFrontend(order, statusOverride) {
  const status = statusOverride ?? order.lastKnownStatus ?? null;
  return {
    id: String(order._id),
    trackingNumber: order.trackingNumber,
    receiver: order.receiverName,
    phone: order.phone,
    city: order.city,
    address: order.address,
    product: order.productNature,
    quantity: order.quantity ?? null,
    note: order.note ?? null,
    price: order.price,
    createdAt: order.createdAt,
    status,
    statusUnavailable: status == null,
    // Purely for client-side sorting — see this module's own comment and
    // OzonOrdersList.jsx's `trackingSortKey` for the established pattern
    // this mirrors. Never used for anything business-relevant.
    _numericCounter: numericCounterFromTrackingNumber(order.numericTrackingNumber),
  };
}

/**
 * @param {object} args
 * @param {string} args.merchantId
 * @param {string|null} args.employeeId
 * @param {string} args.createdByRole
 * @param {string} args.trackingNumber        full tracking number
 * @param {string} args.numericTrackingNumber
 * @param {object} args.body                  the raw getParcelDetails response body
 * @param {string|null} [args.reclaimForEmployeeId]  when set, an existing
 *   local order still linked to a DIFFERENT employeeId (under the same
 *   merchant) is re-pointed at this id. Only the historical-sync caller
 *   passes this — its walk is keyed by this employee's own tracking prefix,
 *   so every order it rediscovers provably belongs to them. See
 *   lib/orders/reclaim-ownership.js.
 * @returns {Promise<{result: "created"|"updated"|"skipped", normalized: object|null, relinked?: boolean}>}
 */
export async function syncOneQuickOrder({
  merchantId,
  employeeId,
  createdByRole,
  trackingNumber,
  numericTrackingNumber,
  body,
  reclaimForEmployeeId = null,
}) {
  const displayStatus = quickDisplayStatus(body);
  const deliveredAt = quickDeliveredAt(body);
  // The real provider creation date (Quick `date_creation`) — the business
  // day this order belongs to (models/Order.js#orderDate), NEVER the sync
  // run's time. `null` when the response has no usable date.
  const orderDate = quickCreatedAt(body);

  const existing = await Order.findOne({
    provider: SHIPPING_PROVIDERS.QUICK_LIVRAISON,
    trackingNumber,
  }).lean();

  const info = quickOrderSummary(body);

  if (existing) {
    // Already known locally — refresh its status, and (only) FILL IN a
    // still-unknown price if this response finally carries a real amount.
    // A price that is already trustworthy (entered at creation, set
    // manually, or a legacy positive value) is NEVER touched — Quick's
    // getParcelDetails has no amount, so an incomplete response must not
    // be able to wipe a real price. See lib/quick/amount.js#resolveSyncedQuickPrice.
    if (displayStatus) {
      syncOrderStatus({
        provider: SHIPPING_PROVIDERS.QUICK_LIVRAISON,
        trackingNumber,
        status: displayStatus,
        deliveredAt,
      });
    }
    const priceUpdate = resolveSyncedQuickPrice(existing, info.price);
    if (priceUpdate) {
      await Order.updateOne(
        { provider: SHIPPING_PROVIDERS.QUICK_LIVRAISON, trackingNumber },
        { $set: priceUpdate }
      ).catch((err) => {
        console.error("[syncOneQuickOrder] price fill-in failed for", trackingNumber, "-", err?.message);
      });
    }

    // FILL IN a still-missing business creation date if this response
    // carries one — never overwrite a date already set (same
    // fill-only-never-clobber rule as the price above).
    if (existing.orderDate == null && orderDate) {
      await Order.updateOne(
        { _id: existing._id },
        { $set: { orderDate } }
      ).catch((err) => {
        console.error("[syncOneQuickOrder] orderDate fill-in failed for", trackingNumber, "-", err?.message);
      });
    }

    // Self-heal a stale owner link (an earlier employee record for the same
    // person, removed and recreated, orphaned this order). Ownership only —
    // never the tracking number, provider, merchant, status or price.
    const relink = shouldReclaimOrderOwnership({
      syncEmployeeId: reclaimForEmployeeId,
      syncMerchantId: merchantId,
      orderEmployeeId: existing.employeeId,
      orderMerchantId: existing.merchantId,
    });
    if (relink) {
      await Order.updateOne(
        { _id: existing._id },
        { $set: { employeeId: reclaimForEmployeeId } }
      ).catch((err) => {
        console.error("[syncOneQuickOrder] owner re-link failed for", trackingNumber, "-", err?.message);
      });
    }

    return {
      result: "updated",
      relinked: relink,
      normalized: normalizeQuickOrderForFrontend(
        { ...existing, ...(priceUpdate ?? {}) },
        displayStatus ?? existing.lastKnownStatus
      ),
    };
  }

  // Brand-new parcel. `resolveSyncedQuickPrice(null, …)` gives a real
  // amount + "provider_sync" when the response carried one, otherwise
  // `price: 0` + `priceSource: "unknown"` — an explicit "we don't know
  // this parcel's amount" marker, NOT a real 0 DH order. The commission
  // layer counts an "unknown" order as 0 units, never 1
  // (lib/commission/calculate.js#isUsableCommissionPrice).
  //
  // The parcel is still imported (not dropped): it IS a real Quick parcel
  // — already confirmed by classifyQuickParcelLookup before we get here —
  // so it must stay visible/trackable on the Orders and Returns pages,
  // the same "a thin response must not lose a real order" rule as
  // `receiver`/`phone`/… falling back to "N/A" below.
  const { price, priceSource } = resolveSyncedQuickPrice(null, info.price);

  let created;
  try {
    created = await Order.create({
      merchantId,
      employeeId,
      createdByRole,
      provider: SHIPPING_PROVIDERS.QUICK_LIVRAISON,
      trackingNumber,
      numericTrackingNumber,
      receiverName: info.receiver || "N/A",
      phone: info.phone || "N/A",
      city: String(body?.district_id ?? body?.city_id ?? body?.city_name ?? body?.city ?? "N/A"),
      address: info.address || "N/A",
      productNature: info.product || "N/A",
      price,
      priceSource,
      // Real Quick creation date (business day) — `null` if the response
      // had none; NEVER the sync run's time. See models/Order.js#orderDate.
      orderDate,
      providerResult: "SUCCESS",
      lastKnownStatus: displayStatus,
      deliveredAt,
    });
  } catch (err) {
    if (err?.code === 11000) {
      // Lost a concurrent create race for this exact tracking number —
      // another caller (a second tab, a background sync job running at
      // the same time) already has it; use their record instead of
      // failing or creating a duplicate.
      const winner = await Order.findOne({
        provider: SHIPPING_PROVIDERS.QUICK_LIVRAISON,
        trackingNumber,
      }).lean();
      return {
        result: "updated",
        normalized: winner ? normalizeQuickOrderForFrontend(winner, winner.lastKnownStatus) : null,
      };
    }
    throw err;
  }

  return {
    result: "created",
    normalized: normalizeQuickOrderForFrontend(created.toObject(), displayStatus),
  };
}
