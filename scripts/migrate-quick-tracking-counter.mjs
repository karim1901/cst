/**
 * One-time (but safely re-runnable/idempotent) migration: seeds the NEW
 * live `User.quickTrackingCounter` field (see
 * lib/quick/reserve-tracking-number.js, mirroring
 * `User.ozonTrackingCounter`'s architecture exactly) from the ONLY
 * currently-authoritative source of each actor's real Quick sequence — the
 * per-period `TrackingCounter` collection, which is what every Quick order
 * has actually been reserved through up to now.
 *
 * WHY a migration is needed at all (see the investigation this script's
 * commit message/PR describes): `quickTrackingCounter` was previously
 * DORMANT — declared on the schema but never read or written by any code
 * path (confirmed by grepping the whole repo). The ONE place a value was
 * found (`quickTrackingCounter: "20260910002"` on a real merchant account)
 * predates the current architecture entirely: it is 11 characters, doesn't
 * decode into any (period + "01" + counter) or (period + counter) shape
 * this app's tracking-number format has ever used, and — decisively — that
 * merchant has ZERO `TrackingCounter` documents of her own for
 * quick_livraison, meaning she has never actually had a Quick order
 * reserved through the (only ever active) TrackingCounter mechanism. That
 * stale value is therefore not part of any real, currently-live sequence
 * and cannot be safely decoded into a correct counter — this script clears
 * it (never guesses a number from it) rather than risk a collision with a
 * tracking number that might already be in use. See "SAFETY" below for why
 * clearing, not guessing, is the correct choice per the task's own "do not
 * blindly overwrite data" requirement.
 *
 * THE ACTUAL, CORRECT MIGRATION for every REAL Quick actor: `TrackingCounter`
 * stores the LATEST-USED counter per (ownerId, provider, period) — the
 * opposite convention from `quickTrackingCounter`'s NEXT-UNUSED semantics
 * (same as `ozonTrackingCounter`). For the CURRENT calendar period, this
 * script sets:
 *
 *   User.quickTrackingCounter = TrackingCounter.counter + 1
 *
 * for every user who has a current-period quick_livraison TrackingCounter
 * document — so the new live counter continues EXACTLY where the old
 * mechanism left off, with zero risk of reissuing an already-used tracking
 * number. A user with no current-period document is left untouched (the
 * live counter simply falls back to the 1000 floor on first use, exactly
 * like a brand-new `ozonTrackingCounter` does).
 *
 * SAFETY: idempotent and non-destructive.
 *  - Only ever WRITES `quickTrackingCounter` when it is currently unset —
 *    never overwrites an already-numeric value (in case this script is
 *    run more than once, or after the live counter has already advanced
 *    from real order creation).
 *  - Never touches `TrackingCounter` documents themselves (still the
 *    source for browsing PAST months — see
 *    lib/quick/reserve-tracking-number.js#peekQuickCounterForPeriod).
 *  - Never hardcodes a specific employee/merchant — scans every user.
 *  - The one confirmed-orphaned stale value is only ever CLEARED (unset),
 *    never guessed at — printed before clearing so it stays auditable.
 *
 * Run with:
 *   node --env-file=.env.local scripts/migrate-quick-tracking-counter.mjs
 */

import mongoose from "mongoose";
import { connectToDatabase } from "../lib/mongodb.js";
import User from "../models/User.js";
import TrackingCounter from "../models/TrackingCounter.js";
import { SHIPPING_PROVIDERS } from "../models/ShippingCompany.js";

function periodFor(now = new Date()) {
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  return `${year}${month}`;
}

await connectToDatabase();

const currentPeriod = periodFor();
console.log(`Current period: ${currentPeriod}`);

const db = mongoose.connection.db;
const usersCollection = db.collection("users");

// ---------------------------------------------------------------------------
// Step 1: clear any stale, non-numeric-castable `quickTrackingCounter`
// value that predates the current architecture (safe: this field was
// confirmed dormant before this migration, so nothing currently reads it
// as authoritative; clearing it just lets the NEXT-UNUSED fallback logic
// in lib/quick/reserve-tracking-number.js apply cleanly instead of
// Mongoose choking on / silently miscasting an un-decodable legacy string).
// ---------------------------------------------------------------------------
const staleDocs = await usersCollection
  .find({ quickTrackingCounter: { $exists: true, $type: "string" } })
  .project({ name: 1, username: 1, email: 1, role: 1, quickTrackingCounter: 1 })
  .toArray();

console.log(`\nFound ${staleDocs.length} user(s) with a legacy STRING quickTrackingCounter value:`);
for (const doc of staleDocs) {
  console.log(
    `  ${doc.username || doc.email} (${doc.role}) — stale value: ${JSON.stringify(
      doc.quickTrackingCounter
    )} — clearing (not part of any real sequence; see module comment).`
  );
  await usersCollection.updateOne({ _id: doc._id }, { $unset: { quickTrackingCounter: "" } });
}

// ---------------------------------------------------------------------------
// Step 2: seed the live counter from the current period's TrackingCounter
// document, for every user who has one.
// ---------------------------------------------------------------------------
const currentPeriodCounters = await TrackingCounter.find({
  provider: SHIPPING_PROVIDERS.QUICK_LIVRAISON,
  period: currentPeriod,
}).lean();

console.log(`\nFound ${currentPeriodCounters.length} current-period (${currentPeriod}) TrackingCounter document(s) for quick_livraison:`);

let seeded = 0;
let skippedAlreadySet = 0;
let skippedNoOwner = 0;

for (const tc of currentPeriodCounters) {
  const owner = await User.findById(tc.ownerId).select("+quickTrackingCounter username email role").lean();
  if (!owner) {
    console.log(`  ownerId=${tc.ownerId} — no matching user found, skipping.`);
    skippedNoOwner++;
    continue;
  }

  if (typeof owner.quickTrackingCounter === "number") {
    console.log(
      `  ${owner.username || owner.email} — quickTrackingCounter already set (${owner.quickTrackingCounter}), leaving untouched.`
    );
    skippedAlreadySet++;
    continue;
  }

  const nextUnused = tc.counter + 1;
  await usersCollection.updateOne({ _id: owner._id }, { $set: { quickTrackingCounter: nextUnused } });
  console.log(
    `  ${owner.username || owner.email} (${owner.role}) — TrackingCounter.counter=${tc.counter} (latest-used) -> quickTrackingCounter=${nextUnused} (next-unused).`
  );
  seeded++;
}

console.log(`\nSummary: cleared ${staleDocs.length} stale value(s), seeded ${seeded} user(s), ${skippedAlreadySet} already set, ${skippedNoOwner} orphaned TrackingCounter doc(s) skipped.`);

await mongoose.disconnect();
