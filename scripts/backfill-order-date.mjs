/**
 * One-off, IDEMPOTENT backfill for `Order.orderDate` — the REAL provider
 * creation date, used by Finance "Advertising & Profit" Daily reporting
 * (see models/Order.js#orderDate, lib/finance/business-date.js).
 *
 * WHY: historical orders were discovered by sync and stamped with a
 * `createdAt` equal to the SYNC RUN's date — so dozens of orders from
 * different real days collapsed onto one "day" in the Daily view. The fix
 * introduces `orderDate` (the real provider date); this script fills it in
 * for rows created before the field existed.
 *
 * WHERE THE REAL DATE COMES FROM (authoritative provider data, never guessed):
 *   - Quick Livraison : `getParcelDetails/<tn>` -> `date_creation`
 *                       ("YYYY-MM-DD HH:MM:SS").
 *   - Ozon Express    : `.../tracking` -> TRACKING.HISTORY -> the EARLIEST
 *                       numbered step's `TIME` (Unix seconds; step "2" is
 *                       the registration event).
 *
 * SAFE:
 *   - only touches rows where `orderDate` is null/absent (never overwrites);
 *   - never changes `createdAt` or anything else;
 *   - a row whose provider gives no usable creation date is LEFT as-is and
 *     reported as unresolved — no date is invented;
 *   - bounded concurrency (5) so it never floods a provider;
 *   - re-running only re-checks whatever is still unresolved.
 *
 * Usage:
 *   node --env-file=.env.local scripts/backfill-order-date.mjs [--dry-run] [--provider=ozon_express|quick_livraison]
 */

import mongoose from "mongoose";

import { decryptSecret } from "../lib/crypto/secret-box.js";

const DRY_RUN = process.argv.includes("--dry-run");
const ONLY_PROVIDER = (process.argv.find((a) => a.startsWith("--provider=")) || "").split("=")[1] || null;
const BATCH = 5;
const OZON_BASE = process.env.OZON_API_BASE || "https://api.ozonexpress.ma";
const QUICK_BASE = process.env.QUICK_API_BASE || "https://clients.quicklivraison.ma/api";

const log = (...a) => console.log(...a);

/** "YYYY-MM-DD[ HH:MM:SS]" -> a Date anchored at 12:00 UTC of that calendar day (day-precise, tz-robust). */
function dateOnlyToUtcNoon(raw) {
  if (typeof raw !== "string") return null;
  const m = raw.trim().match(/^(\d{4})-(\d{2})-(\d{2})(?:[ T]\d{2}:\d{2}:\d{2})?$/);
  if (!m) return null;
  const d = new Date(`${m[1]}-${m[2]}-${m[3]}T12:00:00.000Z`);
  return Number.isNaN(d.getTime()) ? null : d;
}

async function main() {
  if (!process.env.MONGODB_URI) throw new Error("MONGODB_URI not set (use --env-file=.env.local).");
  await mongoose.connect(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 15000 });
  const orders = mongoose.connection.collection("orders");
  const users = mongoose.connection.collection("users");
  const shippingCompanies = mongoose.connection.collection("shippingcompanies");

  const filter = { $or: [{ orderDate: null }, { orderDate: { $exists: false } }] };
  if (ONLY_PROVIDER) filter.provider = ONLY_PROVIDER;

  const pending = await orders
    .find(filter)
    .project({ _id: 1, provider: 1, trackingNumber: 1, employeeId: 1, merchantId: 1, createdAt: 1 })
    .toArray();

  const byProvider = { ozon_express: [], quick_livraison: [] };
  for (const o of pending) (byProvider[o.provider] ??= []).push(o);
  log(`orders missing orderDate: ${pending.length}  (ozon ${byProvider.ozon_express.length}, quick ${byProvider.quick_livraison.length})`);

  // ---- credential caches ----------------------------------------
  const ozonKeyCache = new Map(); // merchantId -> {ozonId, apiKey} | null
  async function ozonCredsFor(merchantId) {
    const k = String(merchantId);
    if (ozonKeyCache.has(k)) return ozonKeyCache.get(k);
    const sc = await shippingCompanies.findOne(
      { merchantId: new mongoose.Types.ObjectId(k), provider: "ozon_express" },
      { projection: { ozonId: 1, apiKey: 1 } }
    );
    let creds = null;
    if (sc?.ozonId && sc?.apiKey) {
      try {
        creds = { ozonId: sc.ozonId, apiKey: decryptSecret(sc.apiKey) };
      } catch {
        creds = null;
      }
    }
    ozonKeyCache.set(k, creds);
    return creds;
  }

  const quickKeyCache = new Map();
  async function quickKeyFor(order) {
    const empId = order.employeeId ? String(order.employeeId) : null;
    const merId = String(order.merchantId);
    const cacheKey = empId ?? `merchant:${merId}`;
    if (quickKeyCache.has(cacheKey)) return quickKeyCache.get(cacheKey);
    let plain = null;
    if (empId) {
      const emp = await users.findOne(
        { _id: new mongoose.Types.ObjectId(empId) },
        { projection: { quickLivraisonApiKey: 1 } }
      );
      if (emp?.quickLivraisonApiKey) {
        try { plain = decryptSecret(emp.quickLivraisonApiKey); } catch { plain = null; }
      }
    }
    if (!plain) {
      const sc = await shippingCompanies.findOne(
        { merchantId: new mongoose.Types.ObjectId(merId), provider: "quick_livraison" },
        { projection: { apiKey: 1 } }
      );
      if (sc?.apiKey) {
        try { plain = decryptSecret(sc.apiKey); } catch { plain = null; }
      }
    }
    quickKeyCache.set(cacheKey, plain);
    return plain;
  }

  // ---- resolvers ----------------------------------------------
  async function resolveQuickDate(order) {
    const apiKey = await quickKeyFor(order);
    if (!apiKey) return { date: null, noCreds: true };
    try {
      const res = await fetch(
        `${QUICK_BASE}/getParcelDetails/${encodeURIComponent(order.trackingNumber)}?api_key=${encodeURIComponent(apiKey)}`,
        { cache: "no-store" }
      );
      const body = await res.json().catch(() => null);
      return { date: dateOnlyToUtcNoon(body?.date_creation) };
    } catch {
      return { date: null };
    }
  }

  async function resolveOzonDate(order) {
    const creds = await ozonCredsFor(order.merchantId);
    if (!creds) return { date: null, noCreds: true };
    try {
      const form = new FormData();
      form.append("tracking-number", order.trackingNumber);
      const res = await fetch(
        `${OZON_BASE}/customers/${creds.ozonId}/${creds.apiKey}/tracking`,
        { method: "POST", body: form, cache: "no-store" }
      );
      const data = await res.json().catch(() => null);
      const history = data?.TRACKING?.HISTORY;
      if (!history || typeof history !== "object") return { date: null };
      const keys = Object.keys(history)
        .filter((x) => /^\d+$/.test(x) && Number(x) >= 2)
        .sort((a, b) => Number(a) - Number(b));
      for (const key of keys) {
        const seconds = Number(history[key]?.TIME);
        if (Number.isFinite(seconds) && seconds > 0) return { date: new Date(seconds * 1000) };
      }
      return { date: null };
    } catch {
      return { date: null };
    }
  }

  const summary = {};
  for (const [provider, list] of Object.entries(byProvider)) {
    if (!list.length) continue;
    const resolve = provider === "ozon_express" ? resolveOzonDate : resolveQuickDate;
    let resolved = 0;
    let unresolved = 0;
    let noCreds = 0;
    for (let i = 0; i < list.length; i += BATCH) {
      const slice = list.slice(i, i + BATCH);
      await Promise.all(
        slice.map(async (order) => {
          const { date, noCreds: nc } = await resolve(order);
          if (nc) { noCreds++; unresolved++; return; }
          if (!date) { unresolved++; return; }
          resolved++;
          if (!DRY_RUN) {
            await orders.updateOne(
              { _id: order._id, $or: [{ orderDate: null }, { orderDate: { $exists: false } }] },
              { $set: { orderDate: date } }
            );
          }
        })
      );
      if ((i / BATCH) % 20 === 0) log(`  ${provider}: ${i + slice.length}/${list.length} checked...`);
    }
    summary[provider] = { total: list.length, resolved, unresolved, noCreds };
  }

  log("");
  log("==================== SUMMARY ====================");
  for (const [provider, s] of Object.entries(summary)) {
    log(`${provider}: ${s.resolved}/${s.total} resolved, ${s.unresolved} unresolved` + (s.noCreds ? ` (${s.noCreds} had no usable credential)` : ""));
  }
  if (DRY_RUN) log("(dry-run: nothing written)");
  log("createdAt was NOT modified for any row.");
  log("================================================");

  await mongoose.disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
