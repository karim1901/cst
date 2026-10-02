/**
 * Repairs/backfills `trackingcounters` documents from REAL `Order` data —
 * the one-time migration this app's monthly-counter architecture needs
 * after the October-2026 rollover regression (see
 * lib/ozon/reserve-tracking-number.js / lib/quick/reserve-tracking-number.js
 * for the live fix this complements).
 *
 * GENERIC — never hardcodes a period, an owner, or a provider. It:
 *   1. Scans every real `Order` document (both providers), grouping by
 *      (owner, provider, period derived from the order's OWN tracking
 *      number — never createdAt), and computes the REAL highest counter
 *      actually used in each group.
 *   2. Compares that real max against whatever `trackingcounters` document
 *      (if any) currently exists for that exact (owner, provider, period).
 *   3. CREATES a missing document at the real max, or REPAIRS one that is
 *      LOWER than the real max (a stale/missing historical record — see
 *      the task's own example: real tracking numbers up to ...1058 ->
 *      historical counter must read 1058). NEVER lowers an existing value
 *      that is already >= the real max (that could legitimately reflect a
 *      reservation whose order hasn't synced locally yet, or an earlier
 *      provider-verified self-heal — see
 *      lib/commission/sync-historical-orders.js's own self-heal step).
 *   4. Never touches `Order` documents themselves — no tracking numbers,
 *      prices, or statuses are ever changed by this script. Metadata-only.
 *
 * Idempotent: running this any number of times converges to the same
 * state and changes nothing once every group's counter already matches (or
 * exceeds) its real evidence.
 *
 * Run with:  node scripts/repair-tracking-counters.mjs [--apply]
 * Without --apply: prints the full audit + planned repairs, writes nothing
 * (the default — "perform a read-only audit first", per this task's own
 * explicit requirement). With --apply: performs the writes.
 */

import mongoose from "mongoose";
import fs from "fs";

const APPLY = process.argv.includes("--apply");

const uri = fs.readFileSync(".env.local", "utf8").match(/^MONGODB_URI=(.*)$/m)?.[1]?.trim();
if (!uri) {
  console.error("MONGODB_URI not found in .env.local");
  process.exit(1);
}

await mongoose.connect(uri);

const Orders = mongoose.connection.collection("orders");
const TrackingCounters = mongoose.connection.collection("trackingcounters");

// EVERY order, including provider-deleted ones — deliberately NOT filtered
// by `providerRecordStatus` (unlike every Finance/Dashboard/Commission/
// Returns query, which correctly excludes deleted orders from CURRENT
// figures). A counter value is consumed the moment it is reserved, and
// stays consumed even if the order is later deleted at the provider — the
// provider itself never recycles that exact tracking number, so a future
// reservation must never collide with it either. The minimum fields needed
// to derive (owner, provider, period, counter) from the order's OWN
// tracking number — the same "tracking-number month is authoritative,
// never createdAt" rule lib/tracking/counter.js and
// lib/commission/resolve-commission-period.js already establish.
const orders = await Orders.find({})
  .project({ merchantId: 1, employeeId: 1, provider: 1, numericTrackingNumber: 1, trackingNumber: 1 })
  .toArray();

// Group key: ownerId (merchant for a merchant-created order, employeeId for
// an employee-created one — the SAME ownership rule
// lib/ozon/tracking-number.js#ozonTrackingPrefixFor and every reservation
// function already use) + provider + period (the leading 6 digits of
// numericTrackingNumber — "YYYYMM").
const groups = new Map(); // key -> { ownerId, provider, period, maxCounter, count, sample }

for (const o of orders) {
  const ownerId = o.employeeId ? String(o.employeeId) : String(o.merchantId);
  const numeric = o.numericTrackingNumber;
  if (!numeric || numeric.length < 9) continue; // malformed/legacy — skip, never guess
  const period = numeric.slice(0, 6);
  if (!/^\d{6}$/.test(period)) continue;
  // Format is period(6) + FIXED_DAY "01"(2) + counter(rest) — see
  // lib/tracking/counter.js#buildFullTrackingNumber.
  const counterStr = numeric.slice(8);
  const counter = Number(counterStr);
  if (!Number.isFinite(counter)) continue;

  const key = `${ownerId}|${o.provider}|${period}`;
  if (!groups.has(key)) {
    groups.set(key, { ownerId, provider: o.provider, period, maxCounter: counter, count: 0, sampleHigh: o.trackingNumber });
  }
  const g = groups.get(key);
  g.count += 1;
  if (counter > g.maxCounter) {
    g.maxCounter = counter;
    g.sampleHigh = o.trackingNumber;
  }
}

console.log(`Scanned ${orders.length} active orders -> ${groups.size} (owner, provider, period) groups.\n`);

const existingDocs = await TrackingCounters.find({}).toArray();
const existingByKey = new Map(
  existingDocs.map((d) => [`${String(d.ownerId)}|${d.provider}|${d.period}`, d])
);

const toCreate = [];
const toRepair = [];
const alreadyCorrect = [];

for (const [key, g] of groups) {
  const existing = existingByKey.get(key);
  if (!existing) {
    toCreate.push(g);
  } else if (existing.counter < g.maxCounter) {
    toRepair.push({ ...g, previousValue: existing.counter, docId: existing._id });
  } else {
    alreadyCorrect.push({ ...g, currentValue: existing.counter });
  }
}

function fmt(g) {
  return `ownerId=${g.ownerId} provider=${g.provider} period=${g.period} realMax=${g.maxCounter} orderCount=${g.count} sample=${g.sampleHigh}`;
}

console.log(`=== ALREADY CORRECT (${alreadyCorrect.length}) — no action ===`);
for (const g of alreadyCorrect) console.log(` ${fmt(g)} | storedCounter=${g.currentValue}`);

console.log(`\n=== MISSING — will CREATE (${toCreate.length}) ===`);
for (const g of toCreate) console.log(` ${fmt(g)}`);

console.log(`\n=== STALE — will REPAIR (${toRepair.length}) ===`);
for (const g of toRepair) console.log(` ${fmt(g)} | currentlyStored=${g.previousValue} -> ${g.maxCounter}`);

if (!APPLY) {
  console.log("\n(read-only audit — re-run with --apply to perform the writes above)");
  await mongoose.disconnect();
  process.exit(0);
}

console.log("\n=== APPLYING REPAIRS ===");
let created = 0;
let repaired = 0;
for (const g of toCreate) {
  try {
    await TrackingCounters.insertOne({
      ownerId: new mongoose.Types.ObjectId(g.ownerId),
      provider: g.provider,
      period: g.period,
      counter: g.maxCounter,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    created += 1;
  } catch (err) {
    if (err?.code === 11000) {
      console.log(`  (already created concurrently, skipping) ${fmt(g)}`);
      continue;
    }
    throw err;
  }
}
for (const g of toRepair) {
  await TrackingCounters.updateOne(
    { _id: g.docId, counter: g.previousValue },
    { $set: { counter: g.maxCounter, updatedAt: new Date() } }
  );
  repaired += 1;
}
console.log(`Created ${created} new trackingcounters document(s), repaired ${repaired} stale one(s).`);

await mongoose.disconnect();
