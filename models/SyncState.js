import mongoose from "mongoose";

import { SHIPPING_PROVIDER_VALUES } from "./ShippingCompany.js";

const { Schema } = mongoose;

/**
 * Tracks freshness + coordination for ONE (merchantId, provider, period)
 * provider-status sync scope — the piece that was previously missing and let
 * Finance (and anything else reading the local `Order` mirror) go stale
 * indefinitely for any month older than the 3-month daily-cron lookback, or
 * for a current month in between cron runs beyond the page-triggered
 * current-month-only sync (see lib/sync/period-sync.js's own module comment
 * for the full root-cause story).
 *
 * Two jobs, one document:
 *  - FRESHNESS: `lastSyncedAt` lets a caller skip a redundant provider sweep
 *    if this exact scope was already verified recently (see
 *    lib/sync/period-sync.js#FRESHNESS_WINDOW_MS) — avoids hammering Ozon/
 *    Quick on every Finance render.
 *  - COORDINATION: `inProgressSince` is a simple CAS-acquired lease so two
 *    concurrent requests for the same scope (e.g. two merchant team members
 *    opening Finance on the same historical month at once) never launch two
 *    redundant full syncs — only one wins the lease; the other treats the
 *    scope as "already being refreshed" and just reads local data. A lease
 *    that is never released (a crashed/killed request) expires on its own
 *    after `lib/sync/period-sync.js#LEASE_TIMEOUT_MS` — never a permanently
 *    stuck lock.
 *
 * Diagnostics (item 20 of the Finance-staleness fix): `lastAttemptAt` /
 * `lastSuccess` / `lastError` / `actorsSynced` / `staleDeleted` /
 * `errorCount` make it possible to tell "provider API is failing" apart from
 * "nobody has asked for this scope yet" apart from "this is already fresh" —
 * surfaced via the sync endpoint's own JSON response, never a separate
 * secrets-bearing diagnostic (no credentials, no raw provider payloads are
 * ever stored here).
 */
const syncStateSchema = new Schema({
  merchantId: {
    type: Schema.Types.ObjectId,
    ref: "User",
    required: [true, "merchantId is required."],
  },
  provider: {
    type: String,
    required: [true, "provider is required."],
    enum: {
      values: [...SHIPPING_PROVIDER_VALUES],
      message: "`{VALUE}` is not a supported shipping provider.",
    },
  },
  // "YYYYMM" — the exact scope this document tracks.
  period: {
    type: String,
    required: [true, "period is required."],
    match: [/^\d{6}$/, "period must be in YYYYMM form."],
  },

  lastSyncedAt: { type: Date, default: null },
  lastAttemptAt: { type: Date, default: null },
  lastSuccess: { type: Boolean, default: null },
  lastError: { type: String, default: null },
  // Set while a sync for this scope is actively running; cleared on
  // completion (success or failure) — see module comment's "COORDINATION".
  inProgressSince: { type: Date, default: null },

  // RESUMABILITY (recurring-refresh fix — see lib/sync/period-sync.js's own
  // comment): actor ids not yet attempted by the current sync cycle because
  // a bounded call's own work deadline was reached first. Non-empty means
  // this scope is mid-resumption — the NEXT call continues with exactly
  // these actors instead of starting over from the full merchant+employees
  // list. Cleared (set to `[]`) the moment a cycle finishes every actor,
  // which is also the only time `lastSyncedAt` advances — see
  // lib/returns/sync.js#syncOneProviderPeriodForMerchant for where this is
  // computed.
  remainingActorIds: { type: [String], default: [] },

  actorsSynced: { type: Number, default: 0 },
  staleDeleted: { type: Number, default: 0 },
  errorCount: { type: Number, default: 0 },
});

// Exactly one state document per (merchant, provider, period) — the lease
// CAS in lib/sync/period-sync.js depends on this being enforced at the
// database level.
syncStateSchema.index({ merchantId: 1, provider: 1, period: 1 }, { unique: true });

/**
 * Guard against "OverwriteModelError" when the module is re-evaluated during
 * development hot reloads.
 */
const SyncState = mongoose.models.SyncState || mongoose.model("SyncState", syncStateSchema);

export default SyncState;
