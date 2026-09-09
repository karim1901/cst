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
import { quickOrderSummary, quickDisplayStatus, quickDeliveredAt } from "@/lib/quick/parse";
import { syncOrderStatus } from "@/lib/commission/sync-status";

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
 * @returns {Promise<{result: "created"|"updated"|"skipped", normalized: object|null}>}
 */
export async function syncOneQuickOrder({
  merchantId,
  employeeId,
  createdByRole,
  trackingNumber,
  numericTrackingNumber,
  body,
}) {
  const displayStatus = quickDisplayStatus(body);
  const deliveredAt = quickDeliveredAt(body);

  const existing = await Order.findOne({
    provider: SHIPPING_PROVIDERS.QUICK_LIVRAISON,
    trackingNumber,
  }).lean();

  if (existing) {
    // Already known locally — only ever refresh its status, never its
    // identity/customer fields.
    if (displayStatus) {
      syncOrderStatus({
        provider: SHIPPING_PROVIDERS.QUICK_LIVRAISON,
        trackingNumber,
        status: displayStatus,
        deliveredAt,
      });
    }
    return {
      result: "updated",
      normalized: normalizeQuickOrderForFrontend(existing, displayStatus ?? existing.lastKnownStatus),
    };
  }

  const info = quickOrderSummary(body);
  const price = Number(info.price);
  // ONLY `price` is a hard requirement — the one field that genuinely
  // cannot be given an honest placeholder (it feeds commission math
  // directly). `receiver`/`phone`/`city`/`address`/`product` fall back to
  // "N/A" instead of skipping the whole order — a getParcelDetails
  // response that confirms a real parcel but is thin on display fields
  // must still surface the order (see lib/commission/sync-historical-orders.js's
  // own comment for the exact case this guards against).
  if (!Number.isFinite(price)) {
    return { result: "skipped", normalized: null };
  }

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
