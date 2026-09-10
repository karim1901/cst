/**
 * One-off, IDEMPOTENT migration for the Follow-up ownership split.
 *
 * BEFORE: Follow-up was a single merchant-wide list. `OrderFollowUp` had
 *   no owner fields and a unique index `{ merchantId, orderId }` — one
 *   record per (merchant, order), and the only code path that created one
 *   required a MERCHANT session.
 *
 * AFTER: every record is owned by `(createdByType, createdById)` — a
 *   merchant's list OR one employee's list — with a unique index
 *   `{ merchantId, createdByType, createdById, orderId }` so a merchant
 *   record and an employee record for the SAME order can coexist.
 *
 * THIS SCRIPT:
 *   1. Backfills `createdByType: "merchant"` + `createdById: <merchantId>`
 *      on every record that lacks them. This is safe and not a guess: the
 *      pre-split feature could ONLY be used by a merchant, so every
 *      existing record is merchant-owned by construction. A record with no
 *      `merchantId` at all cannot be placed and is reported, never
 *      fabricated.
 *   2. Drops the stale unique index `merchantId_1_orderId_1` (it would
 *      wrongly reject an employee following up an order the merchant
 *      already follows up).
 *   3. Ensures the new indexes exist.
 *
 * Re-running is a no-op.
 *
 * Usage:
 *   node --env-file=.env.local scripts/migrate-followup-ownership.mjs [--dry-run]
 */

import mongoose from "mongoose";

const DRY_RUN = process.argv.includes("--dry-run");
const log = (...a) => console.log(...a);

async function main() {
  if (!process.env.MONGODB_URI) throw new Error("MONGODB_URI not set (use --env-file=.env.local).");
  await mongoose.connect(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 15000 });
  const col = mongoose.connection.collection("orderfollowups");

  // ---- 1. backfill ownership --------------------------------------
  const needOwner = await col
    .find({ $or: [{ createdByType: { $exists: false } }, { createdById: { $exists: false } }] })
    .toArray();

  const migratable = needOwner.filter((d) => d.merchantId);
  const unplaceable = needOwner.filter((d) => !d.merchantId);

  log(`records missing owner fields        : ${needOwner.length}`);
  log(`  -> migratable (have merchantId)    : ${migratable.length}  (all merchant-owned)`);
  log(`  -> UNPLACEABLE (no merchantId)     : ${unplaceable.length}`);
  for (const d of unplaceable) log(`       ${String(d._id)} — left untouched, needs manual review`);

  if (!DRY_RUN && migratable.length) {
    const ops = migratable.map((d) => ({
      updateOne: {
        filter: { _id: d._id },
        update: { $set: { createdByType: "merchant", createdById: d.merchantId } },
      },
    }));
    const res = await col.bulkWrite(ops, { ordered: false });
    log(`  applied: ${res.modifiedCount} record(s) marked createdByType:"merchant"`);
  }

  // ---- 2. drop the stale indexes -------------------------------
  // `merchantId_1_orderId_1` (unique) would wrongly reject an employee
  // following up an order the merchant already follows up.
  // `merchantId_1_createdAt_-1` is superseded by the owner-scoped listing
  // index below.
  const indexes = await col.indexes();
  for (const name of ["merchantId_1_orderId_1", "merchantId_1_createdAt_-1"]) {
    if (indexes.find((i) => i.name === name)) {
      if (DRY_RUN) {
        log(`would drop stale index: ${name}`);
      } else {
        await col.dropIndex(name);
        log(`dropped stale index: ${name}`);
      }
    } else {
      log(`stale index ${name}: not present (already migrated)`);
    }
  }

  // ---- 3. ensure the new indexes -------------------------------
  if (!DRY_RUN) {
    await col.createIndex(
      { merchantId: 1, createdByType: 1, createdById: 1, orderId: 1 },
      { unique: true }
    );
    await col.createIndex({ merchantId: 1, createdByType: 1, createdById: 1, createdAt: -1 });
    log(`ensured new indexes (owner+order unique, owner+createdAt listing)`);
  }

  log("");
  log("==================== SUMMARY ====================");
  log(`owner backfilled     : ${DRY_RUN ? 0 : migratable.length}`);
  log(`unplaceable (review) : ${unplaceable.length}`);
  log(DRY_RUN ? "(dry-run: nothing written)" : "done");
  log("================================================");

  await mongoose.disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
