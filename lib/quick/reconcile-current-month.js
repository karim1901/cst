/**
 * Reconciles ONE owner's CURRENT-MONTH Quick Livraison orders against the
 * live Quick API — the sole authority for both "does this parcel still
 * exist" and "what is its current status". Local MongoDB is a cache/mirror
 * for fast display, never a second source of truth for existence.
 *
 * Root cause this exists to fix (two related incidents, same underlying
 * gap): the current-month page previously only ever refreshed the status of
 * orders ALREADY present in local Mongo — it never (a) discovered a real
 * Quick order whose local mirror was never written (a POST's `Order.create`
 * that failed silently after Quick already confirmed the parcel — see
 * app/api/orders/quick/route.js's POST handler), and never (b) noticed a
 * local order that no longer exists at Quick (deleted directly in Quick's
 * own dashboard) and kept showing it as "last known status" forever.
 *
 * The authoritative boundary for "which tracking numbers can even exist
 * this month" is `employee.quickTrackingCounter` itself — the SAME live
 * field order CREATION reserves from (lib/quick/reserve-tracking-number.js)
 * — taken INCLUSIVE (a number equal to the counter may already be a real,
 * just-created order; Quick simply answers "not found" for one that
 * genuinely isn't there yet, which is harmless). NEVER derived from local
 * Mongo's highest tracking number, NEVER from the old per-month
 * `TrackingCounter` model (that remains historical-months-only — see
 * lib/quick/reserve-tracking-number.js#peekQuickCounterForPeriod), and
 * NEVER a hardcoded 1000 as the ceiling (1000 is only ever the FLOOR — see
 * lib/tracking/counter.js#MONTH_BOUNDARY_COUNTER).
 *
 * Per-candidate outcome (lib/quick/lookup.js's 3-way classification is what
 * makes this safe — see its own module comment):
 *   "exists"    -> create/update the local Order (idempotent —
 *                  lib/quick/sync-order.js#syncOneQuickOrder), never
 *                  touching an existing order's identity/customer fields.
 *   "not_found" -> Quick POSITIVELY confirms this exact tracking number
 *                  does not exist (a real HTTP 404, or an explicit
 *                  not-found phrase) -> DELETE the local Order for it, if
 *                  one exists. This is what makes a manually-deleted-at-
 *                  Quick order stop appearing here too.
 *   "unknown"   -> genuinely ambiguous even after lib/quick/lookup.js's own
 *                  retries (or the lookup call itself threw — a network/API
 *                  failure) -> NEVER delete. Keep and display the local
 *                  order's last known state, if any. A temporary hiccup
 *                  must never be confused with a confirmed absence.
 */

if (typeof window !== "undefined") {
  throw new Error("lib/quick/reconcile-current-month.js is server-only and must not be imported in client code");
}

import Order from "@/models/Order";
import { SHIPPING_PROVIDERS } from "@/models/ShippingCompany";
import { lookupQuickParcel } from "@/lib/quick/lookup";
import {
  syncOneQuickOrder,
  normalizeQuickOrderForFrontend,
  numericCounterFromTrackingNumber,
} from "@/lib/quick/sync-order";
import { matchesStatusFilter } from "@/lib/orders/status-groups";
import { MONTH_BOUNDARY_COUNTER } from "@/lib/tracking/counter";

const DEFAULT_BATCH_SIZE = 5;

/**
 * @param {object} args
 * @param {{apiKey:string}} args.credentials
 * @param {string} args.prefix           the VIEWED owner's own tracking-number prefix
 * @param {string} args.period           "YYYYMM" — must be the CURRENT calendar month
 * @param {number|null} args.counterCeiling  the live `quickTrackingCounter` value itself
 *   (INCLUSIVE upper bound) — `null`/`< MONTH_BOUNDARY_COUNTER` means "no
 *   current-month orders can exist yet", handled as a no-op walk.
 * @param {{merchantId:string, employeeId:string|null}} args.ownerFilter
 * @param {string|null} args.employeeId  same value as `ownerFilter.employeeId`,
 *   passed separately since it is also one of `Order.create`'s own fields.
 * @param {string} args.createdByRole
 * @param {string} args.statusFilter     "all"|"delivered"|"progress"|"return"
 * @param {AbortSignal} [args.signal]
 * @param {number} [args.batchSize]
 * @param {(order: object) => void} [args.onOrder] called for every
 *   confirmed-existing, filter-matching order (new or refreshed) — the
 *   caller streams it to the client.
 * @param {(progress: {checked:number, total:number}) => void} [args.onProgress]
 * @returns {Promise<{cleanedCount:number}>} `cleanedCount` — how many stale
 *   local orders (numeric counter above `counterCeiling`) were deleted
 *   up front, purely for logging/diagnostics.
 */
export async function reconcileCurrentMonthQuickOrders({
  credentials,
  prefix,
  period,
  counterCeiling,
  ownerFilter,
  employeeId,
  createdByRole,
  statusFilter,
  signal,
  batchSize = DEFAULT_BATCH_SIZE,
  onOrder,
  onProgress,
}) {
  if (counterCeiling == null) {
    return { cleanedCount: 0 };
  }

  // Step 1 — DB-level cleanup: any LOCAL current-month order whose counter
  // is above the live ceiling is stale by definition (the live counter can
  // only ever grow forward from a real reservation — see
  // lib/quick/reserve-tracking-number.js — so a local number above it can
  // only be leftover/out-of-range data, e.g. from before a merchant
  // manually lowered `quickTrackingCounter`). Enforced here, at the sync
  // layer — never left to a frontend filter alone (a DB-level guarantee,
  // not just a display-time one).
  const currentDocs = await Order.find({
    ...ownerFilter,
    provider: SHIPPING_PROVIDERS.QUICK_LIVRAISON,
    numericTrackingNumber: { $regex: `^${period}` },
  }).lean();

  const staleIds = [];
  const localByCounter = new Map();
  for (const doc of currentDocs) {
    const counter = numericCounterFromTrackingNumber(doc.numericTrackingNumber);
    if (counter > counterCeiling) {
      staleIds.push(doc._id);
    } else {
      localByCounter.set(counter, doc);
    }
  }

  let cleanedCount = 0;
  if (staleIds.length > 0) {
    const res = await Order.deleteMany({ _id: { $in: staleIds } });
    cleanedCount = res.deletedCount ?? staleIds.length;
  }

  if (counterCeiling < MONTH_BOUNDARY_COUNTER) {
    return { cleanedCount };
  }

  // Step 2 — walk the FULL authoritative range
  // [MONTH_BOUNDARY_COUNTER, counterCeiling], newest first, controlled
  // concurrency, progressive (never a giant Promise.all over the whole
  // range). Every candidate — known locally or not — is checked directly
  // against Quick, because local Mongo alone can never prove a parcel still
  // exists (it could have been deleted at Quick since the last check).
  const total = counterCeiling - MONTH_BOUNDARY_COUNTER + 1;
  let checked = 0;
  let counter = counterCeiling;

  const streamIfMatches = (normalized) => {
    if (normalized && matchesStatusFilter(SHIPPING_PROVIDERS.QUICK_LIVRAISON, normalized.status, statusFilter)) {
      onOrder?.(normalized);
    }
  };

  while (counter >= MONTH_BOUNDARY_COUNTER) {
    const batchCounters = [];
    while (batchCounters.length < batchSize && counter >= MONTH_BOUNDARY_COUNTER) {
      batchCounters.push(counter);
      counter -= 1;
    }

    await Promise.all(
      batchCounters.map(async (c) => {
        const trackingNumber = `${prefix}${period}01${c}`;
        const localMatch = localByCounter.get(c);
        try {
          const { classification, body } = await lookupQuickParcel(credentials, trackingNumber, signal);

          if (classification === "exists") {
            const { normalized } = await syncOneQuickOrder({
              merchantId: ownerFilter.merchantId,
              employeeId,
              createdByRole,
              trackingNumber,
              numericTrackingNumber: trackingNumber.slice(prefix.length),
              body,
            });
            streamIfMatches(normalized);
          } else if (classification === "not_found") {
            // Quick POSITIVELY confirms absence — delete the stale local
            // mirror, scoped to this exact owner+provider+tracking number
            // (never a broader delete) so it stops appearing anywhere.
            if (localMatch) {
              await Order.deleteOne({
                _id: localMatch._id,
                ...ownerFilter,
                provider: SHIPPING_PROVIDERS.QUICK_LIVRAISON,
              });
            }
          } else if (localMatch) {
            // "unknown" — ambiguous even after retrying. Never delete;
            // keep showing the last known local state.
            streamIfMatches(normalizeQuickOrderForFrontend(localMatch, localMatch.lastKnownStatus));
          }
        } catch (error) {
          if (error?.name === "AbortError") throw error;
          // Network/API failure — same rule as "unknown": never delete,
          // keep the last known local state (see module comment).
          console.error(
            "[reconcileCurrentMonthQuickOrders] lookup failed for",
            trackingNumber,
            "-",
            error?.message
          );
          if (localMatch) {
            streamIfMatches(normalizeQuickOrderForFrontend(localMatch, localMatch.lastKnownStatus));
          }
        } finally {
          checked += 1;
          onProgress?.({ checked, total });
        }
      })
    );
  }

  return { cleanedCount };
}
