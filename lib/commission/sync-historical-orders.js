/**
 * Discovers and mirrors an employee's PRE-EXISTING Ozon orders into the
 * local `Order` collection — the fix for a structural gap in how this app
 * learns about orders: `user.ozonTrackingCounter` and `TrackingCounter`
 * (see lib/ozon/reserve-tracking-number.js) only ever learn about a period
 * once an order is created THROUGH cst. An employee whose real Ozon
 * activity predates being added to this app has orders that are real and
 * genuinely delivered, yet completely invisible to
 * lib/commission/report.js, no matter how correct its calculation is —
 * because it only ever reads local `Order` documents, and none exist.
 *
 * This closes that gap GENERICALLY, for ANY employee — nothing here reads
 * or branches on a username. The one caller (app/api/employees/route.js)
 * fires this in the background right after an employee is created, so
 * commission for their pre-existing history becomes correct automatically,
 * without the merchant needing to open any page or run anything manually.
 *
 * Idempotent and concurrency-safe:
 *  - a tracking number that already has a local Order document is only
 *    ever UPDATED (via the same lib/commission/sync-status.js every other
 *    status observation already goes through — zero duplicated logic);
 *  - a tracking number with no local document is CREATEd, guarded by the
 *    same `{provider, trackingNumber}` unique index every other Order
 *    write relies on (models/Order.js) — a losing race under concurrent
 *    syncs throws a duplicate-key error, caught and treated as "the other
 *    sync already handled it", not a failure.
 * Running this any number of times therefore leaves exactly one local
 * document per real provider order — never more.
 */

import User, { USER_ROLES } from "@/models/User";
import Order from "@/models/Order";
import ShippingCompany, { SHIPPING_PROVIDERS } from "@/models/ShippingCompany";
import { decryptSecret } from "@/lib/crypto/secret-box";
import { fetchOzonOrdersForMonth } from "@/lib/ozon/fetch-orders";
import { discoverHighestOzonCounter } from "@/lib/ozon/discover-counter";
import { ozonTrackingPrefixFor } from "@/lib/ozon/tracking-number";
import { resolveDisplayStatus, findDeliveredAt } from "@/lib/ozon/history";
import { syncOrderStatus } from "@/lib/commission/sync-status";
import { periodFor } from "@/lib/tracking/counter";

// How far back to look, from the current calendar month, when no explicit
// `periods` list is given. Covers "this month" plus this many prior ones —
// a bounded, adjustable window (not an unbounded/expensive full-history
// scan) rather than a specific month; genuinely dynamic (always relative
// to "now"), never a fixed calendar month.
const DEFAULT_LOOKBACK_MONTHS = 3;

function recentPeriods(count, from = new Date()) {
  const periods = [];
  const cursor = new Date(from.getFullYear(), from.getMonth(), 1);
  for (let i = 0; i < count; i++) {
    periods.push(periodFor(cursor));
    cursor.setMonth(cursor.getMonth() - 1);
  }
  return periods;
}

/**
 * @param {string} employeeId
 * @param {{periods?: string[], signal?: AbortSignal}} [options]
 * @returns {Promise<object>} a per-period summary — see the module comment
 *   for what each count means; useful for logging/diagnostics, not
 *   required by any caller today.
 */
export async function syncHistoricalOzonOrders(employeeId, options = {}) {
  const { periods, signal } = options;

  const owner = await User.findById(employeeId).lean();
  if (!owner) {
    return { synced: false, reason: "owner not found" };
  }
  // Works for an employee (the demonstrated, tested case) or a merchant
  // acting directly (same ownership rule as every other Ozon code path —
  // see app/api/orders/ozon/route.js's `ownerMerchantId`); nothing else.
  if (owner.role !== USER_ROLES.EMPLOYEE && owner.role !== USER_ROLES.MERCHANT) {
    return { synced: false, reason: "not an order-creating role" };
  }
  const merchantId = owner.role === USER_ROLES.EMPLOYEE ? owner.merchantId : owner._id;

  const shipping = await ShippingCompany.findOne({
    merchantId,
    provider: SHIPPING_PROVIDERS.OZON_EXPRESS,
  })
    .select("+apiKey")
    .lean();
  if (!shipping) {
    return { synced: false, reason: "Ozon Express not configured for this merchant" };
  }

  const credentials = { ozonId: shipping.ozonId, apiKey: decryptSecret(shipping.apiKey) };
  const prefix = ozonTrackingPrefixFor(owner);
  const targetPeriods = periods ?? recentPeriods(DEFAULT_LOOKBACK_MONTHS);

  const summary = { synced: true, employeeId: String(employeeId), username: owner.username ?? null, periods: [] };

  for (const period of targetPeriods) {
    const startCounter = await discoverHighestOzonCounter(credentials, prefix, period, { signal });
    if (startCounter == null) {
      summary.periods.push({ period, foundAtOzon: 0, created: 0, updated: 0, skipped: 0 });
      continue;
    }

    const orders = await fetchOzonOrdersForMonth(credentials, prefix, period, startCounter, { signal });

    let created = 0;
    let updated = 0;
    let skipped = 0;

    for (const merged of orders) {
      const trackingNumber = merged._fullTrackingNumber;
      const displayStatus = resolveDisplayStatus(merged);
      const deliveredAt = findDeliveredAt(merged);

      const existing = await Order.findOne({
        provider: SHIPPING_PROVIDERS.OZON_EXPRESS,
        trackingNumber,
      })
        .select("_id")
        .lean();

      if (existing) {
        // Already known locally (created through cst, or by an earlier
        // sync run) — only ever refresh its status, never its identity/
        // customer fields. Reuses the exact same function every other
        // order-listing route already calls.
        syncOrderStatus({
          provider: SHIPPING_PROVIDERS.OZON_EXPRESS,
          trackingNumber,
          status: displayStatus,
          deliveredAt,
        });
        updated++;
        continue;
      }

      const infos = merged.INFOS ?? {};
      const price = Number(infos.PRICE);
      // Never invent data: a real Ozon response missing a field this
      // schema requires is skipped, not fabricated.
      if (!infos.RECEIVER || !infos.PHONE || !infos.CITY_NAME || !Number.isFinite(price)) {
        skipped++;
        continue;
      }

      try {
        await Order.create({
          merchantId,
          employeeId: owner.role === USER_ROLES.EMPLOYEE ? employeeId : null,
          createdByRole: owner.role,
          provider: SHIPPING_PROVIDERS.OZON_EXPRESS,
          trackingNumber,
          numericTrackingNumber: trackingNumber.slice(prefix.length),
          receiverName: infos.RECEIVER,
          phone: infos.PHONE,
          city: infos.CITY_NAME,
          // Real Ozon data can have this empty (e.g. a moderator changed
          // the destination city mid-delivery) — "N/A" is an honest
          // placeholder for "not provided by the source", the same
          // fallback convention already used for `productNature` below.
          address: infos.ADDRESS || "N/A",
          productNature: infos.NOTE || "N/A",
          price,
          providerResult: "SUCCESS",
          lastKnownStatus: displayStatus,
          deliveredAt,
        });
        created++;
      } catch (err) {
        if (err?.code === 11000) {
          // Lost a concurrent create race for this exact tracking number —
          // another sync run (or a real order-creation request) already
          // has it; not a failure, not a duplicate.
          continue;
        }
        console.error(
          "[syncHistoricalOzonOrders] failed to create",
          trackingNumber,
          "-",
          err?.message
        );
      }
    }

    summary.periods.push({ period, foundAtOzon: orders.length, created, updated, skipped });
  }

  return summary;
}
