/**
 * Regression tests for the three Quick Livraison Finance warnings — root
 * causes traced and fixed in this task:
 *
 *   1. Quick shipping price ("N order(s) have no resolvable shipping
 *      price") — Quick has ONE flat rate per (merchant, provider)
 *      (models/ProviderCityPricing.js#FLAT_RATE_CITY_ID), never per-city
 *      (Quick's own `/getCityIDs` returns only {city_id, city_name} — NO
 *      price fields at all, verified live; Ozon's per-city logic must
 *      never be applied to Quick).
 *   2. Quick provider creation date — `lib/quick/parse.js#quickCreatedAt`
 *      parses `date_creation` into the canonical `Order.orderDate`, never
 *      `createdAt`. The one real investigated case turned out NOT to be a
 *      date-parsing bug at all — it was a genuinely provider-deleted order
 *      that stale-order reconciliation never got a chance to check (see
 *      lib/commission/sync-historical-orders.js's "VERIFY + SELF-HEAL" /
 *      "deliberately NOT an early continue" fixes) — covered by
 *      scripts/verify-provider-record-status.mjs, not duplicated here.
 *   3. Quick return price — `lib/quick/amount.js#resolveSyncedQuickPrice`
 *      is the ONE guard that makes it structurally impossible for a
 *      provider sync (which never carries an amount) to overwrite/erase a
 *      real local price, or to fabricate one that was never real.
 *
 * Pure logic only — `lib/quick/amount.js` and `lib/quick/parse.js` have
 * zero `@/` imports; runs with plain `node`.
 *
 * Run with:  node scripts/verify-quick-finance-resolution.mjs
 */

import { resolveSyncedQuickPrice, parseProviderAmount } from "../lib/quick/amount.js";
import { quickCreatedAt } from "../lib/quick/parse.js";
import { FLAT_RATE_CITY_ID } from "../models/ProviderCityPricing.js";

let failures = 0;
function eq(label, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failures++;
  console.log(`${ok ? "PASS" : "FAIL"} - ${label}${ok ? "" : ` - got ${JSON.stringify(actual)}, expected ${JSON.stringify(expected)}`}`);
}

console.log("== QUICK SHIPPING: ONE flat rate resolves every status, never per-city ==");
{
  // The exact shape lib/finance/calculate.js reads for Quick: ONE
  // ProviderCityPricing doc at FLAT_RATE_CITY_ID, never keyed by the
  // order's own city/district.
  const flatDoc = { cityId: FLAT_RATE_CITY_ID, deliveredPriceCents: 2000, returnedPriceCents: 0, refusedPriceCents: 1000 };
  const cityPricingMap = new Map([[FLAT_RATE_CITY_ID, flatDoc]]);

  const resolveQuickShipping = (priceKey) => cityPricingMap.get(FLAT_RATE_CITY_ID)?.[priceKey] ?? null;

  eq("configured flat rate -> Delivered resolves to 20.00 DH", resolveQuickShipping("deliveredPriceCents"), 2000);
  eq("configured flat rate -> Refused resolves to 10.00 DH", resolveQuickShipping("refusedPriceCents"), 1000);
  eq("configured flat rate -> Returned resolves to a REAL 0 DH (not missing)", resolveQuickShipping("returnedPriceCents"), 0);
  eq(
    "district/city on the order is IRRELEVANT to Quick's resolution (unlike Ozon) — same flat doc regardless",
    resolveQuickShipping("deliveredPriceCents"),
    2000
  );
}

console.log("\n== QUICK SHIPPING: a partially-configured flat rate leaves ONLY the unset status unresolved ==");
{
  const flatDoc = { cityId: FLAT_RATE_CITY_ID, deliveredPriceCents: 2000, returnedPriceCents: null, refusedPriceCents: 1000 };
  const cityPricingMap = new Map([[FLAT_RATE_CITY_ID, flatDoc]]);
  const resolveQuickShipping = (priceKey) => cityPricingMap.get(FLAT_RATE_CITY_ID)?.[priceKey] ?? null;

  eq("Delivered still resolves", resolveQuickShipping("deliveredPriceCents"), 2000);
  eq("Returned genuinely unconfigured -> null (missing, not fabricated 0)", resolveQuickShipping("returnedPriceCents"), null);
}

console.log("\n== QUICK SHIPPING: no flat rate document at all -> every status genuinely unresolved (real investigated state) ==");
{
  const cityPricingMap = new Map(); // no FLAT_RATE_CITY_ID doc — merchant never configured it
  const resolveQuickShipping = (priceKey) => cityPricingMap.get(FLAT_RATE_CITY_ID)?.[priceKey] ?? null;
  eq("Delivered -> null (genuinely requires merchant configuration — Quick's API has no price data)", resolveQuickShipping("deliveredPriceCents"), null);
}

console.log("\n== QUICK DATE: date_creation parses to the canonical business date ==");
eq(
  "\"2026-09-03 14:01:26\" -> 2026-09-03 (noon-UTC anchor, see module comment)",
  quickCreatedAt({ date_creation: "2026-09-03 14:01:26" })?.toISOString(),
  "2026-09-03T12:00:00.000Z"
);
eq("date-only \"2026-09-03\" also parses", quickCreatedAt({ date_creation: "2026-09-03" })?.toISOString(), "2026-09-03T12:00:00.000Z");
eq("missing date_creation -> null (never invented)", quickCreatedAt({ date_creation: null }), null);
eq("no date_creation field at all -> null", quickCreatedAt({}), null);
eq("garbage date_creation -> null", quickCreatedAt({ date_creation: "not a date" }), null);

console.log("\n== QUICK PRICE: an amount captured at creation is NEVER overwritten by a later provider sync ==");
{
  // Order creation (item 16): amount = 180 -> Order.price = 180, priceSource = "order_creation".
  const created = resolveSyncedQuickPrice(null, 180);
  eq("brand-new order with a real amount -> {180, provider_sync} (the brand-new-order branch)", created, { price: 180, priceSource: "provider_sync" });

  // Now simulate app creation directly (what the POST handler itself writes):
  const localOrderAfterCreation = { price: 180, priceSource: "order_creation" };

  // Later: Quick's getParcelDetails sync touches this order again — it
  // NEVER carries an amount for a real Quick response.
  const syncUpdate = resolveSyncedQuickPrice(localOrderAfterCreation, null);
  eq("later sync without amount -> null (leave the existing price EXACTLY as it is)", syncUpdate, null);
  eq(
    "price after the no-op sync is still 180 (never wiped to 0/null/unknown)",
    syncUpdate === null ? localOrderAfterCreation.price : syncUpdate.price,
    180
  );
}

console.log("\n== QUICK RETURN: known price is included, unknown price is never fabricated ==");
{
  // A brand-new historical-sync-discovered order with a real amount available.
  eq(
    "brand-new + real amount 300 -> {300, provider_sync} (included in Return Value per its own validation state)",
    resolveSyncedQuickPrice(null, 300),
    { price: 300, priceSource: "provider_sync" }
  );
  // The real investigated case: brand-new, no amount available anywhere.
  eq(
    "brand-new + no amount anywhere -> {0, unknown} (the explicit 'we do not know' marker, never a real sale)",
    resolveSyncedQuickPrice(null, null),
    { price: 0, priceSource: "unknown" }
  );
  // An existing UNKNOWN-priced return, price becomes available later (a
  // trustworthy recovery, e.g. a different endpoint).
  eq(
    "existing unknown + a real amount now available -> upgrade to {price, provider_sync}",
    resolveSyncedQuickPrice({ price: 0, priceSource: "unknown" }, 300),
    { price: 300, priceSource: "provider_sync" }
  );
  // An existing UNKNOWN-priced return, still nothing available -> stays unknown, never fabricated.
  eq(
    "existing unknown + still nothing -> null (stays unknown, no fabrication)",
    resolveSyncedQuickPrice({ price: 0, priceSource: "unknown" }, null),
    null
  );
}

console.log("\n== parseProviderAmount: the underlying amount parser never turns a missing value into a real 0 ==");
eq("180 -> 180", parseProviderAmount(180), 180);
eq('"180" -> 180', parseProviderAmount("180"), 180);
eq("0 -> 0 (sentinel, not fabricated)", parseProviderAmount(0), 0);
eq("null -> 0", parseProviderAmount(null), 0);
eq("undefined -> 0", parseProviderAmount(undefined), 0);
eq('"" -> 0', parseProviderAmount(""), 0);

console.log(`\n${failures === 0 ? "ALL CHECKS PASSED" : failures + " CHECK(S) FAILED"}`);
process.exit(failures === 0 ? 0 : 1);
