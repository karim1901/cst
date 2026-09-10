/**
 * One-off, IDEMPOTENT repair for the local `Order.price` / `Order.priceSource`
 * data — the root-cause remediation for "Quick commission shows Units = 0".
 *
 * WHAT WENT WRONG
 *   Quick Livraison parcels that were placed directly in Quick's own
 *   dashboard (never through this app) were later discovered by historical
 *   sync (lib/commission/sync-historical-orders.js#syncHistoricalQuickOrders).
 *   Their only data source is Quick's `getParcelDetails` endpoint, whose
 *   response carries NO amount (verified live: it returns only
 *   tracking_number / situation / status / status_second / dates /
 *   store_name). The old sync guard used a bare `Number(info.price)` — and
 *   `Number(null) === 0` is finite — so those parcels were stored with
 *   `price: 0`, which the commission layer then counted as a real
 *   "< 350 DH -> 1 unit" order.
 *
 * WHAT THIS SCRIPT DOES (nothing destructive, safe to run repeatedly)
 *   1. Backfills `priceSource` on every Order that lacks it:
 *        price > 0  -> "order_creation"   (a real, trustworthy amount)
 *        price <= 0 -> "unknown"          (an explicit "amount not known" marker)
 *   2. For every Quick order still marked `priceSource: "unknown"`, re-calls
 *      Quick's `getParcelDetails` (bounded concurrency) and, IF the
 *      response finally carries a usable amount, upgrades
 *        price -> that amount,  priceSource -> "provider_sync".
 *      A response that still has no amount leaves the order untouched
 *      (unknown) — the price is NEVER fabricated.
 *   3. Never downgrades a price, never touches a trustworthy price, never
 *      changes tracking number / employee / merchant / provider / status /
 *      counters. Re-running is a no-op once everything recoverable is
 *      recovered.
 *
 * Ozon is not touched — Ozon's fetch response does carry the real amount,
 * and its historical sync already skips (never stores 0 for) a price-less
 * order.
 *
 * Usage:
 *   node --env-file=.env.local scripts/repair-quick-order-prices.mjs [--dry-run]
 */

import mongoose from "mongoose";

import { decryptSecret } from "../lib/crypto/secret-box.js";
import { quickOrderSummary } from "../lib/quick/parse.js";
import { resolveSyncedQuickPrice } from "../lib/quick/amount.js";

const DRY_RUN = process.argv.includes("--dry-run");
const QUICK_BASE = process.env.QUICK_API_BASE || "https://clients.quicklivraison.ma/api";
const BATCH_SIZE = 5;

function log(...a) {
  console.log(...a);
}

async function main() {
  if (!process.env.MONGODB_URI) throw new Error("MONGODB_URI not set (use --env-file=.env.local).");
  await mongoose.connect(process.env.MONGODB_URI);
  const orders = mongoose.connection.collection("orders");
  const users = mongoose.connection.collection("users");
  const shippingCompanies = mongoose.connection.collection("shippingcompanies");

  // ---- Step 1: backfill priceSource ---------------------------------
  const missingSource = await orders
    .find({ priceSource: { $exists: false } })
    .project({ _id: 1, price: 1 })
    .toArray();
  let backfilledCreation = 0;
  let backfilledUnknown = 0;
  for (let i = 0; i < missingSource.length; i += 500) {
    const slice = missingSource.slice(i, i + 500);
    const ops = slice.map((o) => {
      const source = Number(o.price) > 0 ? "order_creation" : "unknown";
      if (source === "order_creation") backfilledCreation++;
      else backfilledUnknown++;
      return { updateOne: { filter: { _id: o._id }, update: { $set: { priceSource: source } } } };
    });
    if (!DRY_RUN && ops.length) await orders.bulkWrite(ops, { ordered: false });
  }
  log(
    `[priceSource backfill] ${missingSource.length} order(s) had no priceSource -> ` +
      `${backfilledCreation} "order_creation", ${backfilledUnknown} "unknown"` +
      (DRY_RUN ? "  (dry-run, not written)" : "")
  );

  // ---- Step 2: try to recover unknown Quick prices from Quick -------
  const unknownFilter = DRY_RUN
    ? { provider: "quick_livraison", $or: [{ priceSource: "unknown" }, { priceSource: { $exists: false }, price: { $lte: 0 } }] }
    : { provider: "quick_livraison", priceSource: "unknown" };
  const unknownQuick = await orders
    .find(unknownFilter)
    .project({ _id: 1, trackingNumber: 1, employeeId: 1, merchantId: 1, price: 1, priceSource: 1 })
    .toArray();

  log(`[quick recovery] ${unknownQuick.length} Quick order(s) with an unknown price to check against Quick.`);

  // Resolve a decrypted API key per (employee|merchant) once — same
  // preference order as lib/quick/credentials.js: the employee's own key
  // first, else the merchant's shared ShippingCompany key.
  const keyCache = new Map();
  async function keyFor(order) {
    const empId = order.employeeId ? String(order.employeeId) : null;
    const merId = String(order.merchantId);
    const cacheKey = empId ?? `merchant:${merId}`;
    if (keyCache.has(cacheKey)) return keyCache.get(cacheKey);
    let plain = null;
    if (empId) {
      const emp = await users.findOne(
        { _id: new mongoose.Types.ObjectId(empId) },
        { projection: { quickLivraisonApiKey: 1 } }
      );
      if (emp?.quickLivraisonApiKey) {
        try {
          plain = decryptSecret(emp.quickLivraisonApiKey);
        } catch {
          plain = null;
        }
      }
    }
    if (!plain) {
      const sc = await shippingCompanies.findOne(
        { merchantId: new mongoose.Types.ObjectId(merId), provider: "quick_livraison" },
        { projection: { apiKey: 1 } }
      );
      if (sc?.apiKey) {
        try {
          plain = decryptSecret(sc.apiKey);
        } catch {
          plain = null;
        }
      }
    }
    keyCache.set(cacheKey, plain);
    return plain;
  }

  let recovered = 0;
  let stillUnknown = 0;
  let noCredentials = 0;

  for (let i = 0; i < unknownQuick.length; i += BATCH_SIZE) {
    const batch = unknownQuick.slice(i, i + BATCH_SIZE);
    await Promise.all(
      batch.map(async (order) => {
        const apiKey = await keyFor(order);
        if (!apiKey) {
          noCredentials++;
          return;
        }
        let body = null;
        try {
          const res = await fetch(
            `${QUICK_BASE}/getParcelDetails/${encodeURIComponent(order.trackingNumber)}?api_key=${encodeURIComponent(apiKey)}`,
            { cache: "no-store" }
          );
          body = await res.json().catch(() => null);
        } catch {
          body = null;
        }
        const amountRaw = body ? quickOrderSummary(body).price : null;
        const decision = resolveSyncedQuickPrice(
          { price: order.price ?? 0, priceSource: order.priceSource ?? "unknown" },
          amountRaw
        );
        if (decision && decision.price > 0) {
          recovered++;
          if (!DRY_RUN) {
            await orders.updateOne({ _id: order._id }, { $set: decision });
          }
          log(`  recovered ${order.trackingNumber}: price ${order.price ?? 0} -> ${decision.price}`);
        } else {
          stillUnknown++;
        }
      })
    );
  }

  log("");
  log("==================== SUMMARY ====================");
  log(`priceSource backfilled : ${missingSource.length} (order_creation ${backfilledCreation}, unknown ${backfilledUnknown})`);
  log(`Quick unknown-price orders checked : ${unknownQuick.length}`);
  log(`  recovered from Quick (price filled in) : ${recovered}`);
  log(`  still genuinely unknown (Quick has no amount) : ${stillUnknown}`);
  if (noCredentials) log(`  skipped (no usable Quick credential) : ${noCredentials}`);
  if (DRY_RUN) log("(dry-run: no writes were performed)");
  log("================================================");

  await mongoose.disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
