/**
 * One-off, IDEMPOTENT repair: re-link local `Order` documents whose
 * `employeeId` points at a user record that no longer exists.
 *
 * WHAT WENT WRONG
 *   An employee record can be removed and a fresh one created for the same
 *   person (a new `_id`) — e.g. deleted straight from the database during
 *   setup, then re-added through the app. Every `Order` the old record
 *   owned keeps its now-dangling `employeeId`. Commission, Dashboard,
 *   Returns and Finance all scope strictly by the CURRENT employee's `_id`,
 *   so those orders silently drop to zero everywhere (the "Delivered = 0
 *   even though real delivered orders exist" symptom).
 *
 * HOW THIS REPAIRS IT (safely, generically — no username/id is hard-coded)
 *   A tracking number's prefix is the owner's `username`
 *   (lib/tracking/counter.js#trackingPrefixFor), and usernames are globally
 *   unique (app/api/employees/route.js). So an order tracking-numbered
 *   `<username><digits>` provably belongs to whoever currently holds that
 *   username under the same merchant. For every order whose `employeeId`
 *   resolves to no live employee, this finds the current employee whose
 *   `username` equals the order's tracking-number prefix (same merchant)
 *   and re-points `employeeId` at them — nothing else on the order changes
 *   (not the tracking number, provider, merchant, price, status, counters).
 *
 *   Orders whose prefix matches no current employee are left untouched and
 *   reported as unresolved — never guessed.
 *
 *   Re-running is a no-op: a re-linked order's `employeeId` now resolves to
 *   a live employee, so it is no longer an orphan.
 *
 * Usage:
 *   node --env-file=.env.local scripts/relink-orphaned-orders.mjs [--dry-run]
 */

import mongoose from "mongoose";

import { shouldReclaimOrderOwnership } from "../lib/orders/reclaim-ownership.js";

const DRY_RUN = process.argv.includes("--dry-run");

function log(...a) {
  console.log(...a);
}

async function main() {
  if (!process.env.MONGODB_URI) throw new Error("MONGODB_URI not set (use --env-file=.env.local).");
  await mongoose.connect(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 15000 });
  const orders = mongoose.connection.collection("orders");
  const users = mongoose.connection.collection("users");

  const allUsers = await users.find({}).toArray();
  const liveEmployeeIds = new Set(
    allUsers.filter((u) => u.role === "employee").map((u) => String(u._id))
  );
  // (username, merchantId) -> current employee doc
  const employeeByUsernameMerchant = new Map();
  for (const u of allUsers) {
    if (u.role === "employee" && u.username) {
      employeeByUsernameMerchant.set(`${u.username}::${String(u.merchantId)}`, u);
    }
  }

  const withEmployee = await orders
    .find({ employeeId: { $ne: null } })
    .project({ _id: 1, employeeId: 1, merchantId: 1, provider: 1, trackingNumber: 1, numericTrackingNumber: 1, deliveredAt: 1 })
    .toArray();

  const orphans = withEmployee.filter((o) => !liveEmployeeIds.has(String(o.employeeId)));
  log(`orders with an employeeId            : ${withEmployee.length}`);
  log(`  of those, orphaned (dangling link) : ${orphans.length}`);

  const ops = [];
  const unresolved = new Map(); // prefix -> count
  const byTarget = new Map(); // username -> { count, delivered }
  let ambiguousMerchant = 0;

  for (const o of orphans) {
    const numeric = String(o.numericTrackingNumber ?? "");
    const tn = String(o.trackingNumber ?? "");
    const prefix = numeric && tn.endsWith(numeric) ? tn.slice(0, tn.length - numeric.length) : null;
    if (!prefix) {
      unresolved.set("(unparseable tracking number)", (unresolved.get("(unparseable tracking number)") ?? 0) + 1);
      continue;
    }
    const target = employeeByUsernameMerchant.get(`${prefix}::${String(o.merchantId)}`);
    if (!target) {
      unresolved.set(prefix, (unresolved.get(prefix) ?? 0) + 1);
      continue;
    }
    if (
      !shouldReclaimOrderOwnership({
        syncEmployeeId: String(target._id),
        syncMerchantId: String(target.merchantId),
        orderEmployeeId: o.employeeId,
        orderMerchantId: o.merchantId,
      })
    ) {
      ambiguousMerchant++;
      continue;
    }
    ops.push({ updateOne: { filter: { _id: o._id }, update: { $set: { employeeId: target._id } } } });
    const agg = byTarget.get(target.username) ?? { count: 0, delivered: 0 };
    agg.count++;
    if (o.deliveredAt) agg.delivered++;
    byTarget.set(target.username, agg);
  }

  log(`\nre-link plan:`);
  for (const [username, agg] of byTarget) {
    log(`  ${username}: ${agg.count} order(s) (${agg.delivered} delivered) -> current employee record`);
  }
  if (unresolved.size) {
    log(`\nunresolved (prefix matches no current employee — left untouched):`);
    for (const [prefix, count] of unresolved) log(`  "${prefix}": ${count}`);
  }
  if (ambiguousMerchant) log(`\nskipped (merchant mismatch): ${ambiguousMerchant}`);

  if (!DRY_RUN && ops.length) {
    const res = await orders.bulkWrite(ops, { ordered: false });
    log(`\napplied: ${res.modifiedCount} order(s) re-linked.`);
  } else {
    log(`\n${DRY_RUN ? "(dry-run: no writes)" : "nothing to write"} — ${ops.length} order(s) would be re-linked.`);
  }

  // ---- Verification: delivered counts per affected employee -----------
  log(`\n==================== VERIFICATION (post-repair) ====================`);
  for (const username of byTarget.keys()) {
    const emp = [...employeeByUsernameMerchant.values()].find((u) => u.username === username);
    if (!emp) continue;
    for (const provider of ["ozon_express", "quick_livraison"]) {
      for (const period of ["202607", "202608", "202609"]) {
        const delivered = await orders.countDocuments({
          employeeId: emp._id,
          provider,
          deliveredAt: { $ne: null },
          numericTrackingNumber: { $regex: "^" + period },
        });
        if (delivered) log(`  ${username} / ${provider} / ${period}: delivered=${delivered}`);
      }
    }
  }
  log(`==================================================================`);

  await mongoose.disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
