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
import { resolveDisplayStatus, findDeliveredAt, findCreatedAt } from "@/lib/ozon/history";
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
import { PROVIDER_RECORD_STATUSES, reconciliationAction } from "@/lib/orders/provider-record-status";
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
    let startCounter =
      period === currentPeriod
        ? (await peekNextOzonCounter(employeeId)) - 1
        : await discoverHighestOzonCounter(credentials, prefix, period, { signal });

    // VERIFY + SELF-HEAL (root-cause fix — real investigated case: two real,
    // already-delivered Ozon orders stayed permanently invisible because
    // `ozonTrackingCounter` no longer reflected the true highest counter
    // used at Ozon — see app/api/employees/[id]/route.js's administrative
    // override, a legitimate feature that has no way to know the provider's
    // true state, so a merchant correcting it to the wrong value would
    // otherwise silently and PERMANENTLY hide real orders: every future
    // reconciliation run trusts the live counter completely and would never
    // look past it). CURRENT month only — probe a bounded margin PAST what
    // we currently believe is the ceiling; if Ozon confirms real orders
    // exist there, extend this run's own walk to include them AND advance
    // the live counter to match (a correction toward the provider's own
    // truth, never a guess) — compare-and-swap on the exact value just
    // read, so a genuine concurrent order creation is never clobbered.
    if (period === currentPeriod && startCounter != null && startCounter >= MONTH_BOUNDARY_COUNTER - 1) {
      const verifiedCounter = await discoverHighestOzonCounter(credentials, prefix, period, {
        startCounter: startCounter + 1,
        signal,
      });
      if (verifiedCounter != null && verifiedCounter > startCounter) {
        const previousLiveValue = String(startCounter + 1);
        await User.updateOne(
          { _id: employeeId, ozonTrackingCounter: previousLiveValue },
          { $set: { ozonTrackingCounter: String(verifiedCounter + 1) } }
        ).catch((err) => {
          console.error(
            "[syncHistoricalOzonOrders] failed to self-heal ozonTrackingCounter for",
            employeeId,
            "-",
            err?.message
          );
        });
        startCounter = verifiedCounter;
      }
    }

    // NOTE: deliberately NOT an early `continue` when the walk has nothing
    // to fetch (startCounter below the floor) — a local order can still
    // exist for this actor/period independent of what the counter
    // currently believes (exactly the investigated case: a genuinely
    // provider-deleted order whose counter position the live/verified
    // counter never confirms as "existing" either). Stale-order
    // reconciliation below must still run so such a local order gets
    // checked directly and, if Ozon confirms it is really gone, marked
    // deleted — never left active forever just because the discovery walk
    // itself found nothing new.
    const orders =
      startCounter == null || startCounter < MONTH_BOUNDARY_COUNTER
        ? []
        : await fetchOzonOrdersForMonth(credentials, prefix, period, startCounter, { signal });

    let created = 0;
    let updated = 0;
    let skipped = 0;
    let relinked = 0;

    for (const merged of orders) {
      const trackingNumber = merged._fullTrackingNumber;
      const displayStatus = resolveDisplayStatus(merged);
      const deliveredAt = findDeliveredAt(merged);
      // The real Ozon registration time (earliest history step) — the
      // business day this order belongs to (models/Order.js#orderDate),
      // never this sync run's time.
      const orderDate = findCreatedAt(merged);

      const existing = await Order.findOne({
        provider: SHIPPING_PROVIDERS.OZON_EXPRESS,
        trackingNumber,
      })
        .select("_id employeeId merchantId orderDate providerRecordStatus")
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
        // FILL IN a still-missing business creation date — never overwrite
        // one already set.
        if (existing.orderDate == null && orderDate) {
          await Order.updateOne(
            { _id: existing._id },
            { $set: { orderDate } }
          ).catch((err) => {
            console.error(
              "[syncHistoricalOzonOrders] failed to set orderDate for",
              trackingNumber,
              "-",
              err?.message
            );
          });
        }
        // REVIVE: Ozon just confirmed this exact tracking number still
        // exists (it is in `orders`, this run's live fetch result) — if it
        // was previously marked provider-deleted (see
        // lib/orders/reconcile-stale-orders.js), that was either a
        // transient earlier state or the order was recreated; either way,
        // the provider's own current answer is authoritative, so the
        // record becomes active again. Never the reverse here — deletion is
        // ONLY ever decided by reconcileStaleOrdersForPeriod's own explicit
        // "not_found" signal, never inferred from this loop.
        if (
          reconciliationAction({ classification: "exists", currentStatus: existing.providerRecordStatus }).action ===
          "revive"
        ) {
          await Order.updateOne(
            { _id: existing._id },
            { $set: { providerRecordStatus: PROVIDER_RECORD_STATUSES.ACTIVE, providerDeletedAt: null } }
          ).catch((err) => {
            console.error(
              "[syncHistoricalOzonOrders] failed to revive",
              trackingNumber,
              "-",
              err?.message
            );
          });
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
          // Real Ozon registration date (business day) — `null` if the
          // history had no usable step; NEVER this sync run's time.
          orderDate,
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
    const usingLiveCounter = knownCounter == null && period === currentPeriod;
    let startCounter =
      knownCounter != null
        ? knownCounter
        : usingLiveCounter
          ? (await peekNextQuickCounter(employeeId)) - 1
          : await discoverHighestQuickCounter(credentials, prefix, period, { signal });

    // VERIFY + SELF-HEAL (root-cause fix — real investigated case: a Quick
    // order was genuinely created through this app while
    // `quickTrackingCounter` never advanced to reflect it, so the
    // current-month sync believed "zero orders exist yet" for that actor
    // and skipped the whole period — never even reaching stale-order
    // reconciliation or `orderDate`/status refresh below. Same fix as
    // syncHistoricalOzonOrders's own — see that function's own comment for
    // the full rationale. CURRENT month only, and only when the live
    // counter is actually the source being trusted (never when an explicit
    // `counters[period]` override was given, which is already the exact
    // known value from a trusted per-month record). Probes a bounded
    // margin PAST what we currently believe is the ceiling — starting from
    // `MONTH_BOUNDARY_COUNTER - 1` (not `startCounter + 1`) so this also
    // recovers the exact investigated case where the live counter is
    // BELOW the floor entirely (believed "zero orders"), not just "a few
    // orders behind".
    if (usingLiveCounter) {
      const verifyFrom = Math.max(startCounter, MONTH_BOUNDARY_COUNTER - 1) + 1;
      const verifiedCounter = await discoverHighestQuickCounter(credentials, prefix, period, {
        startCounter: verifyFrom,
        signal,
      });
      if (verifiedCounter != null && verifiedCounter >= verifyFrom) {
        const previousLiveValue = startCounter + 1; // quickTrackingCounter is a Number, never String — see models/User.js
        // CAS filter mirrors lib/quick/reserve-tracking-number.js's own
        // reservation exactly: when the believed value IS the field's
        // documented "never used yet" floor (MONTH_BOUNDARY_COUNTER), the
        // field may genuinely be unset/null in Mongo (peekNextQuickCounter
        // falls back to that same floor for a missing field) rather than
        // literally storing that number — an exact-value-only match would
        // never matter for the field's own semantics.
        const filter =
          previousLiveValue === MONTH_BOUNDARY_COUNTER
            ? {
                _id: employeeId,
                $or: [
                  { quickTrackingCounter: previousLiveValue },
                  { quickTrackingCounter: { $exists: false } },
                  { quickTrackingCounter: null },
                ],
              }
            : { _id: employeeId, quickTrackingCounter: previousLiveValue };
        await User.updateOne(filter, { $set: { quickTrackingCounter: verifiedCounter + 1 } }).catch((err) => {
          console.error(
            "[syncHistoricalQuickOrders] failed to self-heal quickTrackingCounter for",
            employeeId,
            "-",
            err?.message
          );
        });
        startCounter = verifiedCounter;
      }
    }

    // NOTE: deliberately NOT an early `continue` when the walk has nothing
    // to fetch — see syncHistoricalOzonOrders's identical comment above.
    // Stale-order reconciliation below must still run: this is exactly the
    // investigated case (a local order existed while the counter believed
    // "zero orders yet") — it must still be checked directly against Quick
    // and, if genuinely gone, marked deleted, rather than staying active
    // forever just because the discovery walk found nothing new.
    const found =
      startCounter == null || startCounter < MONTH_BOUNDARY_COUNTER
        ? []
        : await fetchQuickOrdersForMonth(credentials, prefix, period, startCounter, { signal });

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
