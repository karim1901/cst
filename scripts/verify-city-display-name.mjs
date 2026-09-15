/**
 * Regression tests for Ozon city DISPLAY name resolution — the "cities show
 * as numeric IDs instead of names" bug.
 *
 * Pure logic: lib/orders/city-display-name.js has zero imports, runs with
 * plain `node`.
 *
 * Run with:  node scripts/verify-city-display-name.mjs
 */

import { resolveOrderCityDisplayName } from "../lib/orders/city-display-name.js";

let failures = 0;
function eq(label, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failures++;
  console.log(`${ok ? "PASS" : "FAIL"} - ${label}${ok ? "" : ` - got ${JSON.stringify(actual)}, expected ${JSON.stringify(expected)}`}`);
}

// Ozon /cities real response shape (see lib/finance/sync-city-pricing.js's
// own comment): {"ID":12345,"NAME":"Agadir", ...}. The index this resolver
// reads is built by lib/orders/city-name-index.js from
// models/ProviderCityPricing.js, already keyed cityId -> cityName.
const cityNameById = new Map([
  ["12345", "Agadir"],
  ["37", "Agadir"],
  ["501", "Casablanca"],
]);

console.log("== spec example (item 24): id=12345, name=Agadir ==");
eq(
  "providerLocationId=12345 + city already correct -> Agadir",
  resolveOrderCityDisplayName({ city: "Agadir", providerLocationId: "12345" }, cityNameById),
  "Agadir"
);
eq(
  "THE BUG CASE: providerLocationId unset, city literally the raw id \"12345\" -> resolves to Agadir",
  resolveOrderCityDisplayName({ city: "12345", providerLocationId: null }, cityNameById),
  "Agadir"
);
eq(
  "providerLocationId set correctly, city WRONGLY still the raw id -> providerLocationId wins -> Agadir",
  resolveOrderCityDisplayName({ city: "12345", providerLocationId: "12345" }, cityNameById),
  "Agadir"
);

console.log("\n== historically-synced order: city is already a real name, no providerLocationId at all ==");
eq(
  "city='Casablanca', providerLocationId unset -> Casablanca as-is (never re-derived unnecessarily)",
  resolveOrderCityDisplayName({ city: "Casablanca", providerLocationId: undefined }, cityNameById),
  "Casablanca"
);

console.log("\n== providerLocationId points at a DIFFERENT (correct, more current) city than the stored name ==");
eq(
  "providerLocationId=501 -> Casablanca wins over a stale city name",
  resolveOrderCityDisplayName({ city: "Some Old Name", providerLocationId: "501" }, cityNameById),
  "Casablanca"
);

console.log("\n== city dataset not synchronized yet / unknown id -> never fabricated, falls back honestly ==");
eq(
  "unknown numeric city, no index entry -> falls back to the raw stored value (never blank, never guessed)",
  resolveOrderCityDisplayName({ city: "99999", providerLocationId: null }, cityNameById),
  "99999"
);
eq(
  "no index at all (cache not synced) -> falls back to raw city value",
  resolveOrderCityDisplayName({ city: "12345", providerLocationId: null }, null),
  "12345"
);
eq(
  "no index, but city is already a real name -> unaffected",
  resolveOrderCityDisplayName({ city: "Agadir", providerLocationId: null }, undefined),
  "Agadir"
);

console.log("\n== edge cases ==");
eq("city is null, no providerLocationId -> null (never fabricated)", resolveOrderCityDisplayName({ city: null, providerLocationId: null }, cityNameById), null);
eq("city is empty string -> null", resolveOrderCityDisplayName({ city: "", providerLocationId: null }, cityNameById), null);
eq(
  "city has surrounding whitespace around a numeric id -> still resolves",
  resolveOrderCityDisplayName({ city: "  12345  ", providerLocationId: null }, cityNameById),
  "Agadir"
);
eq(
  "a city NAME that happens to contain digits is never treated as a raw id (not purely numeric)",
  resolveOrderCityDisplayName({ city: "Sidi 2", providerLocationId: null }, cityNameById),
  "Sidi 2"
);

console.log(`\n${failures === 0 ? "ALL CHECKS PASSED" : failures + " CHECK(S) FAILED"}`);
process.exit(failures === 0 ? 0 : 1);
