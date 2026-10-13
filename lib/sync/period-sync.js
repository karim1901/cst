/**
 * On-demand freshness + coordination wrapper around
 * lib/returns/sync.js#syncOneProviderPeriodForMerchant — THE fix for
 * Finance (and any other period-scoped surface) going stale for any month
 * the page-triggered current-month-only sync
 * (app/_components/shared/useBackgroundProviderSync.js) never touches and
 * the once-daily cron's 3-month lookback (lib/ozon/auto-reconcile.js /
 * lib/quick/auto-reconcile.js) never reaches or hasn't gotten to yet.
 *
 * ROOT CAUSE this closes (see the investigation in this fix's own report for
 * the full runtime-evidence trail): nothing in this app ever re-synced a
 * SPECIFIC, MERCHANT-SELECTED period on demand — only "today's month" (every
 * page view) or "the last 3 months" (once a day). Finance's own
 * MonthSelect (app/_components/orders/MonthSelect.jsx) offers the last 12
 * months; months 4-12 back were therefore PERMANENTLY frozen at whatever
 * local state existed from the last time they fell inside the 3-month
 * window or an employee's one-time historical-sync-on-creation run. A
 * tracking-number month is a REPORTING scope only — it must never gate
 * whether the provider's status for that order can still be refreshed (see
 * lib/commission/sync-historical-orders.js's own "tracking month vs sync
 * time" distinction, unchanged by this fix).
 *
 * This module adds exactly three things on top of the ALREADY-CORRECT
 * underlying engine (status normalization, pagination-safe discovery,
 * confirmed-vs-unknown-gap handling, soft-delete-never-hard-delete — all of
 * that already lived in lib/commission/sync-historical-orders.js /
 * lib/orders/reconcile-stale-orders.js / lib/ozon/fetch-orders.js and is
 * UNCHANGED here):
 *
 *  1. FRESHNESS — skip a redundant provider sweep if this exact
 *     (merchant, provider, period) scope was already verified within
 *     `FRESHNESS_WINDOW_MS`. Keeps Finance responsive (no provider round
 *     trips on every render) without ever permanently freezing a month —
 *     the window is short enough that a merchant who keeps checking back
 *     still gets a real refresh periodically.
 *  2. COORDINATION — a CAS-acquired lease (`SyncState.inProgressSince`)
 *     ensures two concurrent requests for the SAME scope (two tabs, two
 *     team members) never launch two redundant full syncs; the loser just
 *     reads local data. A lease older than `LEASE_TIMEOUT_MS` is treated as
 *     abandoned (a crashed/killed request) and can be re-acquired — never a
 *     permanently stuck lock.
 *  3. BOUNDED + RESUMABLE WORK — real data showed a single period across a
 *     merchant's full actor list can take 28-120s+ (scales with real order
 *     volume, no fixed safe ceiling), which is both a bad synchronous wait
 *     for a page that must render instantly and a genuine risk of
 *     approaching a serverless function's own time limit. Each call here
 *     only runs for up to `SYNC_WORK_BUDGET_MS` (see
 *     lib/returns/sync.js#syncOneProviderPeriodForMerchant's own `deadline`
 *     param) and persists exactly which actors it didn't get to
 *     (`SyncState.remainingActorIds`) instead of silently calling a
 *     time-boxed partial pass "done" — the caller (the recurring client
 *     poll in app/_components/finance/FinancePageClient.jsx) sees
 *     `outcome: "partial"` and simply calls again shortly after; this
 *     function resumes with exactly the leftover actors rather than
 *     restarting the whole scope. `lastSyncedAt` only ever advances once a
 *     cycle finishes every targeted actor — a partial cycle is NEVER
 *     reported or persisted as fresh.
 */

if (typeof window !== "undefined") {
  throw new Error("lib/sync/period-sync.js is server-only and must not be imported in client code");
}

import SyncState from "@/models/SyncState";
import { syncOneProviderPeriodForMerchant } from "@/lib/returns/sync";

// Short enough that a merchant who re-opens/refreshes Finance a few minutes
// later still gets a real check; long enough that rapid re-renders /
// multiple tabs don't re-trigger a provider sweep on every single one.
const FRESHNESS_WINDOW_MS = 2 * 60 * 1000; // 2 minutes

// How long an acquired lease is honored before being treated as abandoned
// (the request that acquired it crashed, timed out, or the server instance
// was recycled mid-sync) — generous relative to how long a single-period,
// all-actors sync realistically takes (seconds, not minutes, for a typical
// merchant), but bounded so a genuinely stuck lease can never block this
// scope forever.
const LEASE_TIMEOUT_MS = 2 * 60 * 1000; // 2 minutes

// How long ONE call is allowed to spend actually syncing actors before it
// must stop and persist its progress — see the module comment's "BOUNDED +
// RESUMABLE WORK". Deliberately much smaller than LEASE_TIMEOUT_MS/Vercel's
// own function ceiling: this is a single round of a multi-round resumable
// cycle, not a one-shot budget, so it only needs to be large enough to make
// real forward progress (at least one actor, typically several) per call.
const SYNC_WORK_BUDGET_MS = 15 * 1000; // 15 seconds

/**
 * Ensure the given (merchant, provider, period) scope has been checked
 * against the provider recently — syncing it now if it hasn't been, subject
 * to the freshness/coordination rules above.
 *
 * @param {object} args
 * @param {string} args.merchantId SERVER-DERIVED (from the authenticated
 *   session) — never accept this from client input.
 * @param {string} args.provider
 * @param {string} args.period "YYYYMM"
 * @param {AbortSignal} [args.signal]
 * @returns {Promise<{
 *   outcome: "fresh"|"in_progress"|"synced"|"partial"|"error",
 *   lastSyncedAt: Date|null,
 *   actorsSynced?: number,
 *   remainingActors?: number,
 *   staleDeleted?: number,
 *   errorCount?: number,
 *   error?: string,
 * }>}
 *   `outcome: "partial"` — this call's own `SYNC_WORK_BUDGET_MS` was
 *   reached before every targeted actor was attempted; `remainingActors` is
 *   how many are left (persisted — the next call for this exact scope
 *   resumes with exactly those, see module comment). The caller should call
 *   again soon rather than waiting for the normal polling interval.
 */
export async function ensurePeriodSynced({ merchantId, provider, period, signal }) {
  const now = new Date();
  const existing = await SyncState.findOne({ merchantId, provider, period }).lean();

  if (existing?.lastSyncedAt && now - existing.lastSyncedAt < FRESHNESS_WINDOW_MS) {
    return { outcome: "fresh", lastSyncedAt: existing.lastSyncedAt };
  }

  const leaseExpired =
    existing?.inProgressSince == null || now - existing.inProgressSince >= LEASE_TIMEOUT_MS;
  if (!leaseExpired) {
    return { outcome: "in_progress", lastSyncedAt: existing?.lastSyncedAt ?? null };
  }

  // CAS: only one concurrent caller wins this exact scope — the filter
  // matches either "no document yet", "no lease held", or "a lease old
  // enough to be abandoned" — the same three cases `leaseExpired` above
  // just checked, re-checked atomically here so a genuine race between two
  // requests can only ever let one through.
  const acquireFilter = {
    merchantId,
    provider,
    period,
    $or: [{ inProgressSince: null }, { inProgressSince: { $lt: new Date(now - LEASE_TIMEOUT_MS) } }],
  };
  const acquired = await SyncState.findOneAndUpdate(
    acquireFilter,
    { $set: { inProgressSince: now, lastAttemptAt: now }, $setOnInsert: { merchantId, provider, period } },
    { upsert: true, new: false }
  ).catch(async (err) => {
    // A concurrent upsert race (duplicate key on the unique index) means
    // someone else just created/claimed the document a moment ago —
    // treat exactly like "lost the race", not a failure.
    if (err?.code === 11000) return undefined;
    throw err;
  });

  if (acquired === undefined) {
    // Either genuinely lost the CAS race, or the duplicate-key race above —
    // either way, someone else now holds the lease for this scope.
    return { outcome: "in_progress", lastSyncedAt: existing?.lastSyncedAt ?? null };
  }
  // `acquired` is the PRE-update document (`new: false`) when one already
  // existed, or `null` when this call's upsert just created it — both mean
  // this call won the lease.

  // RESUMABILITY: a non-empty `remainingActorIds` from a PRIOR call means
  // this scope is mid-cycle — continue with exactly those actors (and keep
  // accumulating this cycle's own diagnostics) instead of starting a fresh
  // pass over everyone again. A fresh cycle (first attempt, or the previous
  // one already finished) omits `onlyActorIds` entirely so
  // `syncOneProviderPeriodForMerchant` computes the full current
  // merchant+employees list itself.
  const resuming = (existing?.remainingActorIds?.length ?? 0) > 0;
  const onlyActorIds = resuming ? existing.remainingActorIds : undefined;
  const priorActorsSynced = resuming ? existing.actorsSynced ?? 0 : 0;
  const priorStaleDeleted = resuming ? existing.staleDeleted ?? 0 : 0;
  const priorErrorCount = resuming ? existing.errorCount ?? 0 : 0;

  try {
    const deadline = Date.now() + SYNC_WORK_BUDGET_MS;
    const result = await syncOneProviderPeriodForMerchant(merchantId, provider, period, {
      signal,
      deadline,
      onlyActorIds,
    });

    const fullyDone = result.remainingActorIds.length === 0;
    const cumulativeActorsSynced = priorActorsSynced + result.actors;
    const cumulativeStaleDeleted = priorStaleDeleted + result.staleDeleted;
    const cumulativeErrorCount = priorErrorCount + result.errors;
    const syncedAt = fullyDone ? new Date() : existing?.lastSyncedAt ?? null;

    await SyncState.updateOne(
      { merchantId, provider, period },
      {
        $set: {
          // Only a FULLY completed cycle ever counts as "fresh" — a partial
          // one must never be mistaken for a real, complete check (see
          // module comment).
          lastSyncedAt: syncedAt,
          lastSuccess: true,
          lastError: null,
          inProgressSince: null,
          remainingActorIds: result.remainingActorIds,
          actorsSynced: cumulativeActorsSynced,
          staleDeleted: cumulativeStaleDeleted,
          errorCount: cumulativeErrorCount,
        },
      }
    );
    return {
      outcome: fullyDone ? "synced" : "partial",
      lastSyncedAt: syncedAt,
      actorsSynced: cumulativeActorsSynced,
      remainingActors: result.remainingActorIds.length,
      staleDeleted: cumulativeStaleDeleted,
      errorCount: cumulativeErrorCount,
    };
  } catch (err) {
    const message = err?.message ?? "Unknown sync error.";
    await SyncState.updateOne(
      { merchantId, provider, period },
      { $set: { lastSuccess: false, lastError: message, inProgressSince: null } }
    ).catch(() => {});
    if (err?.name === "AbortError") throw err;
    console.error("[ensurePeriodSynced]", merchantId, provider, period, "-", message);
    return { outcome: "error", lastSyncedAt: existing?.lastSyncedAt ?? null, error: message };
  }
}
