"use client";

import { useEffect, useRef, useState } from "react";

// How often to re-check the SELECTED (provider, period) while a consumer
// stays mounted with nothing changed — comfortably inside
// lib/sync/period-sync.js's own FRESHNESS_WINDOW_MS (2 minutes), so a
// routine tick usually finds the scope already fresh (a cheap DB read, no
// provider calls) and only triggers a real sync once it has genuinely
// expired.
const POLL_INTERVAL_MS = 90 * 1000;
// When a sync call reports `outcome: "partial"` (its own bounded work
// budget was reached before every actor was checked — see
// lib/sync/period-sync.js#SYNC_WORK_BUDGET_MS), resume almost immediately
// instead of waiting the full POLL_INTERVAL_MS, so a multi-round cycle for
// a busy month finishes promptly rather than trickling in over minutes.
const RESUME_DELAY_MS = 3 * 1000;

/**
 * Keep ONE (provider, period) scope's local Order mirror fresh for as long
 * as a component stays mounted with that exact selection — see
 * lib/sync/period-sync.js for the server-side mechanism this drives
 * (freshness window, CAS lease, bounded/resumable work, no month-age
 * limit). Shared by app/_components/finance/FinancePageClient.jsx and
 * app/_components/orders/OrdersBrowser.jsx — the two merchant-only surfaces
 * that display Ozon/Quick order data from the local DB mirror rather than
 * live from the provider, so both need the exact same "does this selection
 * need a refresh" check rather than two independently-maintained copies of
 * it. The endpoint it calls (`POST /api/finance/sync`) is named after its
 * original caller but is already generic (merchantId + provider + period,
 * nothing Finance-specific) — reused as-is here, the same way
 * lib/returns/sync.js's own engine is already shared across pages despite
 * living under "returns".
 *
 * Calls immediately on mount/selection change, keeps polling every
 * `POLL_INTERVAL_MS` while mounted, resumes quickly on a `"partial"` round,
 * does nothing (no request at all) while the tab is hidden and rechecks the
 * instant it becomes visible again, and never overlaps itself — each next
 * check is only scheduled after the previous one's request has fully
 * settled.
 *
 * @param {object} args
 * @param {string} args.provider
 * @param {string} args.period "YYYYMM"
 * @param {boolean} [args.enabled] default true — pass `false` to disable
 *   entirely (e.g. a non-merchant viewer, or a surface that doesn't need
 *   this scope synced right now).
 * @param {() => void} [args.onChanged] called whenever a round actually
 *   checked at least one actor — true for both a fully completed round and
 *   a partial one, since a partial round can still have found real changes
 *   among the actors it did reach. The caller's cue to re-fetch its own
 *   data; never called just because a round ran and found nothing new.
 * @returns {{checking: boolean}} `checking` — true only through the
 *   INITIAL resumable cycle for the current (provider, period, enabled);
 *   quiet for any later, purely-routine background ticks, so a caller
 *   showing an indicator from this does not flash one every couple of
 *   minutes forever.
 */
export function usePeriodSync({ provider, period, enabled = true, onChanged }) {
  // `checking` starts true/false the same "derive during render" way as
  // every other render-driven state in this codebase (never a synchronous
  // setState at the top of the effect body) — only the async continuation
  // inside the effect (after its first `await`) ever calls `setChecking`,
  // which is the normal, allowed place for an effect to set state.
  const syncKey = `${provider}|${period}|${enabled}`;
  const [renderedForSyncKey, setRenderedForSyncKey] = useState(syncKey);
  const [checking, setChecking] = useState(enabled);
  if (syncKey !== renderedForSyncKey) {
    setRenderedForSyncKey(syncKey);
    setChecking(enabled);
  }
  const isInitialCycleRef = useRef(true);
  // Always call the LATEST `onChanged` without needing it in the main
  // effect's own dependency array (it is typically a fresh closure every
  // render) — updated from its OWN tiny effect (refs must never be written
  // during render), so the main effect below can read it without
  // depending on it directly.
  const onChangedRef = useRef(onChanged);
  useEffect(() => {
    onChangedRef.current = onChanged;
  }, [onChanged]);

  useEffect(() => {
    if (!enabled) return undefined;

    isInitialCycleRef.current = true;
    let cancelled = false;
    let timeoutId = null;
    let activeController = null;

    async function tick() {
      if (cancelled) return;
      // Never make a request while the tab is in the background —
      // `handleVisibilityChange` below resumes checking the instant it
      // becomes visible again; nothing is scheduled while hidden, so there
      // is no wasted timer running either.
      if (typeof document !== "undefined" && document.visibilityState === "hidden") {
        return;
      }

      const controller = new AbortController();
      activeController = controller;
      let outcome = null;
      try {
        const res = await fetch("/api/finance/sync", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ provider, period }),
          signal: controller.signal,
        });
        const body = await res.json().catch(() => ({}));
        outcome = body?.outcome ?? null;
        if ((body?.actorsSynced ?? 0) > 0) {
          onChangedRef.current?.();
        }
      } catch {
        // Aborted (unmount/selection change — harmless), a network failure,
        // or a server-reported `outcome: "error"` already logged
        // server-side — never treated as success either way; just retry at
        // the normal interval below rather than resuming fast.
      } finally {
        activeController = null;
        if (!cancelled) {
          if (isInitialCycleRef.current) {
            if (outcome === "partial") {
              // Still mid the initial cycle for this selection — keep
              // `checking` true and resume quickly below.
            } else {
              setChecking(false);
              isInitialCycleRef.current = false;
            }
          }
          const delay = outcome === "partial" ? RESUME_DELAY_MS : POLL_INTERVAL_MS;
          timeoutId = setTimeout(tick, delay);
        }
      }
    }

    function handleVisibilityChange() {
      if (document.visibilityState === "visible") {
        clearTimeout(timeoutId);
        tick();
      }
    }

    tick(); // immediately for this selection
    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      cancelled = true;
      clearTimeout(timeoutId);
      activeController?.abort();
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [provider, period, enabled]);

  return { checking: enabled && checking };
}
