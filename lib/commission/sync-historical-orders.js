/**
 * Discovers and mirrors an employee's PRE-EXISTING Ozon/Quick orders into
 * the local `Order` collection — the fix for a structural gap in how this
 * app learns about orders: `user.ozonTrackingCounter`/`TrackingCounter`
 * (see lib/ozon/reserve-tracking-number.js, lib/quick/reserve-tracking-number.js)
 * only ever learn about a period once an order is created THROUGH cst. An
 * employee whose real provider activity predates being added to this app
 * has orders that are real and genuinely delivered, yet completely
 * invisible to lib/commission/report.js, no matter how correct its
 * calculation is — because it only ever reads local `Order` documents, and
 * none exist.
 *
 * This closes that gap GENERICALLY, for ANY employee, on BOTH providers —
 * nothing here reads or branches on a username. `syncHistoricalOzonOrders`
 * (Ozon) and `syncHistoricalQuickOrders` (Quick, mirroring it exactly, bound
 * to Quick's own client/parse/discovery pieces) are called together in the
 * background right after an employee is created (app/api/employees/route.js)
 * and again from the order-lifecycle page's own sync job
 * (lib/returns/sync.js), so commission for pre-existing history becomes
 * correct automatically, without the merchant needing to run anything
 * manually.
 *
 * Idempotent and concurrency-safe, for both providers:
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
import { peekNextOzonCounter } from "@/lib/ozon/reserve-tracking-number";
import { lookupOzonParcel } from "@/lib/ozon/lookup";
import { fetchQuickOrdersForMonth } from "@/lib/quick/fetch-orders";
import { discoverHighestQuickCounter } from "@/lib/quick/discover-counter";
import { quickTrackingPrefixFor } from "@/lib/quick/tracking-number";
import { resolveQuickCredentials } from "@/lib/quick/credentials";
import { syncOneQuickOrder } from "@/lib/quick/sync-order";
import { peekNextQuickCounter } from "@/lib/quick/reserve-tracking-number";
import { lookupQuickParcel } from "@/lib/quick/lookup";
import { syncOrderStatus } from "@/lib/commission/sync-status";
import { periodFor, MONTH_BOUNDARY_COUNTER } from "@/lib/tracking/counter";
import { reconcileStaleOrdersForPeriod } from "@/lib/orders/reconcile-stale-orders";
import { shouldReclaimOrderOwnership } from "@/lib/orders/reclaim-ownership";

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
  // Every tracking number walked below starts with THIS actor's prefix, so
  // any local order found under it provably belongs to this actor. When the
  // run is for an employee, a local order still linked to a different
  // employeeId (e.g. an earlier employee record for the same person that
  // was removed and recreated) is re-pointed at the current owner — see
  // lib/orders/reclaim-ownership.js. Never for a merchant-scoped run.
  const syncEmployeeId = owner.role === USER_ROLES.EMPLOYEE ? String(owner._id) : null;
  const targetPeriods = periods ?? recentPeriods(DEFAULT_LOOKBACK_MONTHS);

  const summary = { synced: true, employeeId: String(employeeId), username: owner.username ?? null, periods: [] };
  const currentPeriod = periodFor();

  for (const period of targetPeriods) {
    // CURRENT month: bound the walk by the LIVE `ozonTrackingCounter`
    // ceiling — the SAME authoritative source order CREATION reserves
    // from (lib/ozon/reserve-tracking-number.js) — never blind
    // consecutive-miss probing, which can stop early on a run of
    // temporarily-erroring numbers and incorrectly conclude "no more
    // orders exist" (see lib/ozon/discover-counter.js's own gap-tolerant
    // design: it cannot distinguish "genuinely absent" from "one flaky
    // request" for the purpose of deciding where the range ends). Past
    // months have no live counter to consult — they keep the existing,
    // unchanged discovery-by-probing behavior, which only ever affects
    // read-only sync range-finding, never order creation.
    const startCounter =
      period === currentPeriod
        ? (await peekNextOzonCounter(employeeId)) - 1
        : await discoverHighestOzonCounter(credentials, prefix, period, { signal });
    if (startCounter == null || startCounter < MONTH_BOUNDARY_COUNTER) {
      summary.periods.push({ period, foundAtOzon: 0, created: 0, updated: 0, relinked: 0, skipped: 0, staleDeleted: 0 });
      continue;
    }

    const orders = await fetchOzonOrdersForMonth(credentials, prefix, period, startCounter, { signal });

    let created = 0;
    let updated = 0;
    let skipped = 0;
    let relinked = 0;

    for (const merged of orders) {
      const trackingNumber = merged._fullTrackingNumber;
      const displayStatus = resolveDisplayStatus(merged);
      const deliveredAt = findDeliveredAt(merged);

      const existing = await Order.findOne({
        provider: SHIPPING_PROVIDERS.OZON_EXPRESS,
        trackingNumber,
      })
        .select("_id employeeId merchantId")
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
        // Self-heal a stale owner link (orphaned by an employee record being
        // recreated). Only the ownership field — nothing about the tracking
        // number, provider, merchant, status or price is touched.
        if (
          shouldReclaimOrderOwnership({
            syncEmployeeId,
            syncMerchantId: merchantId,
            orderEmployeeId: existing.employeeId,
            orderMerchantId: existing.merchantId,
          })
        ) {
          await Order.updateOne(
            { _id: existing._id },
            { $set: { employeeId: owner._id } }
          ).catch((err) => {
            console.error(
              "[syncHistoricalOzonOrders] failed to re-link owner for",
              trackingNumber,
              "-",
              err?.message
            );
          });
          relinked++;
        }
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
          // Ozon's fetch response DOES carry the real amount (validated
          // `Number.isFinite(price)` above; a missing one is skipped, not
          // stored as 0) — so this is a genuine provider-sourced price.
          priceSource: "provider_sync",
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

    // Stale-order reconciliation (root cause fix — see
    // lib/orders/reconcile-stale-orders.js's own comment): a local Order
    // that Ozon no longer confirms (deleted directly in Ozon's own
    // dashboard, for example) is removed here so Returns/Dashboard/
    // Commission/Finance — which all read local Mongo directly — stop
    // showing it. Reuses the SAME already-decrypted `credentials` this
    // period's sync just used. PERFORMANCE: `orders` above already
    // confirmed which tracking numbers genuinely exist this run — passed
    // as `knownExistingTrackingNumbers` so reconciliation skips re-checking
    // them (zero extra Ozon calls for a healthy account) and only verifies
    // local orders this run did NOT already confirm.
    const confirmedThisRun = new Set(orders.map((o) => o._fullTrackingNumber));
    const { deleted: staleDeleted } = await reconcileStaleOrdersForPeriod({
      merchantId,
      employeeId: owner.role === USER_ROLES.EMPLOYEE ? employeeId : null,
      provider: SHIPPING_PROVIDERS.OZON_EXPRESS,
      period,
      lookup: (trackingNumber, sig) => lookupOzonParcel(credentials, trackingNumber, sig),
      signal,
      knownExistingTrackingNumbers: confirmedThisRun,
    });

    summary.periods.push({ period, foundAtOzon: orders.length, created, updated, relinked, skipped, staleDeleted });
  }

  return summary;
}

/**
 * Quick Livraison counterpart of `syncHistoricalOzonOrders` above — same
 * structure, same idempotent/concurrency-safe guarantees, same generic
 * "works for any employee or the merchant themselves" design; only the
 * provider-specific pieces differ (Quick's `getParcelDetails` client call
 * via lib/quick/discover-counter.js + lib/quick/fetch-orders.js, and
 * lib/quick/parse.js's best-effort field extraction instead of Ozon's
 * documented INFOS.* shape).
 *
 * @param {string} employeeId
 * @param {{periods?: string[], signal?: AbortSignal, counters?: Record<string, number>}} [options]
 *   `counters`: optional `{ [period]: highestCounter }` map — when a
 *   period's highest counter is ALREADY known (read from the real
 *   `TrackingCounter` document for that (owner, "quick_livraison", period)
 *   — see app/api/orders/quick/route.js's GET handler, the one caller that
 *   passes this), that exact value is used directly and
 *   `discoverHighestQuickCounter`'s blind probing is skipped entirely for
 *   that period — more precise (the real range, not "probe until 12
 *   consecutive misses") and cheaper. Periods absent from this map keep the
 *   original probing behavior unchanged (the employee-creation and
 *   Returns-page sync jobs never pass this, so their behavior is identical
 *   to before).
 * @returns {Promise<object>} same shape as syncHistoricalOzonOrders's
 *   return value (see its own doc comment).
 */
export async function syncHistoricalQuickOrders(employeeId, options = {}) {
  const { periods, signal, counters } = options;

  const owner = await User.findById(employeeId).lean();
  if (!owner) {
    return { synced: false, reason: "owner not found" };
  }
  if (owner.role !== USER_ROLES.EMPLOYEE && owner.role !== USER_ROLES.MERCHANT) {
    return { synced: false, reason: "not an order-creating role" };
  }
  const merchantId = owner.role === USER_ROLES.EMPLOYEE ? owner.merchantId : owner._id;

  // This owner's OWN Quick credential when they have one configured
  // (models/User.js#quickLivraisonApiKey), otherwise the merchant's shared
  // ShippingCompany one — see lib/quick/credentials.js's module comment for
  // why this matters: an employee's real Quick orders live under THEIR
  // account when they have their own key, so discovery must probe using
  // that same account's credentials, not necessarily the merchant's.
  // Handles a decrypt failure (old/different encryption key, corrupted
  // data, ...) by treating it as "not configured" rather than throwing —
  // same safety guarantee as every other Quick credential read.
  const credentials = await resolveQuickCredentials(String(owner._id), merchantId);
  if (!credentials) {
    return { synced: false, reason: "Quick Livraison credentials are not configured correctly" };
  }

  const prefix = quickTrackingPrefixFor(owner);
  const targetPeriods = periods ?? recentPeriods(DEFAULT_LOOKBACK_MONTHS);

  const summary = { synced: true, employeeId: String(employeeId), username: owner.username ?? null, periods: [] };
  const currentPeriod = periodFor();

  for (const period of targetPeriods) {
    const knownCounter = counters?.[period];
    // CURRENT month: bound the walk by the LIVE `quickTrackingCounter`
    // ceiling — the SAME authoritative source order CREATION reserves
    // from (lib/quick/reserve-tracking-number.js) — never blind
    // consecutive-miss probing, for the same reason as
    // syncHistoricalOzonOrders above (a probing stop can never distinguish
    // "genuinely no more orders" from "several flaky requests in a row").
    // An explicit `counters[period]` override (the historical-month
    // streaming caller) still wins when provided.
    const startCounter =
      knownCounter != null
        ? knownCounter
        : period === currentPeriod
          ? (await peekNextQuickCounter(employeeId)) - 1
          : await discoverHighestQuickCounter(credentials, prefix, period, { signal });
    if (startCounter == null || startCounter < MONTH_BOUNDARY_COUNTER) {
      summary.periods.push({ period, foundAtQuick: 0, created: 0, updated: 0, relinked: 0, skipped: 0, staleDeleted: 0 });
      continue;
    }

    const found = await fetchQuickOrdersForMonth(credentials, prefix, period, startCounter, { signal });

    let created = 0;
    let updated = 0;
    let relinked = 0;
    let skipped = 0;

    // See syncHistoricalOzonOrders above: the walk is keyed by THIS actor's
    // prefix, so an employee-scoped run may re-point a locally-known order
    // that is still linked to a stale employeeId.
    const reclaimForEmployeeId = owner.role === USER_ROLES.EMPLOYEE ? String(owner._id) : null;

    for (const item of found) {
      const trackingNumber = item._fullTrackingNumber;
      // Reuses the exact same create-or-update logic
      // app/api/orders/quick/route.js's progressive historical-month
      // streaming uses (lib/quick/sync-order.js) — one implementation, not
      // two that could drift apart. See that module's own comment for the
      // "price is the one hard requirement, everything else falls back to
      // N/A" rule and the concurrent-create-race handling.
      try {
        const { result, relinked: didRelink } = await syncOneQuickOrder({
          merchantId,
          employeeId: owner.role === USER_ROLES.EMPLOYEE ? employeeId : null,
          createdByRole: owner.role,
          trackingNumber,
          numericTrackingNumber: trackingNumber.slice(prefix.length),
          body: item.body,
          reclaimForEmployeeId,
        });
        if (result === "created") created++;
        else if (result === "updated") updated++;
        else skipped++;
        if (didRelink) relinked++;
      } catch (err) {
        console.error("[syncHistoricalQuickOrders] failed to sync", trackingNumber, "-", err?.message);
      }
    }

    // Stale-order reconciliation — same root-cause fix as Ozon above (see
    // lib/orders/reconcile-stale-orders.js's own comment), using Quick's
    // own existing 3-way lookup (lib/quick/lookup.js — status =
    // authoritative, status_second/situation never treated as the main
    // status; never touched here). PERFORMANCE: same skip-already-
    // confirmed optimization as Ozon above.
    const confirmedThisRun = new Set(found.map((item) => item._fullTrackingNumber));
    const { deleted: staleDeleted } = await reconcileStaleOrdersForPeriod({
      merchantId,
      employeeId: owner.role === USER_ROLES.EMPLOYEE ? employeeId : null,
      provider: SHIPPING_PROVIDERS.QUICK_LIVRAISON,
      period,
      lookup: (trackingNumber, sig) => lookupQuickParcel(credentials, trackingNumber, sig),
      signal,
      knownExistingTrackingNumbers: confirmedThisRun,
    });

    summary.periods.push({ period, foundAtQuick: found.length, created, updated, relinked, skipped, staleDeleted });
  }

  return summary;
}
