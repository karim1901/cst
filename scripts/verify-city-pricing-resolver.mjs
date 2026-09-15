/**
 * Regression tests for Finance's Ozon shipping-price city resolution — the
 * "19 orders have no resolvable shipping price" bug.
 *
 * Pure logic: lib/orders/resolve-city-pricing-doc.js has zero imports, runs
 * with plain `node`.
 *
 * Run with:  node scripts/verify-city-pricing-resolver.mjs
 */

import { resolveOrderCityPricingDoc } from "../lib/orders/resolve-city-pricing-doc.js";

let failures = 0;
function eq(label, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failures++;
  console.log(`${ok ? "PASS" : "FAIL"} - ${label}${ok ? "" : ` - got ${JSON.stringify(actual)}, expected ${JSON.stringify(expected)}`}`);
}

// A small synchronized ProviderCityPricing dataset, real Ozon /cities shape.
const agadir = { cityId: "12345", cityName: "Agadir", deliveredPriceCents: 3500, returnedPriceCents: 0, refusedPriceCents: 1000 };
const fes = { cityId: "127", cityName: "Fes", deliveredPriceCents: 3500, returnedPriceCents: null, refusedPriceCents: 1000 };
const byId = new Map([
  [agadir.cityId, agadir],
  [fes.cityId, fes],
]);
const byName = new Map([
  [agadir.cityName.toLowerCase(), agadir],
  [fes.cityName.toLowerCase(), fes],
]);

console.log("== 1) exact providerLocationId match wins (the reliable, post-fix case) ==");
eq(
  "providerLocationId=12345 -> Agadir doc",
  resolveOrderCityPricingDoc({ providerLocationId: "12345", city: "Agadir" }, byId, byName),
  agadir
);

console.log("\n== 2) city is already a real name (historical-sync orders) ==");
eq(
  "no providerLocationId, city='Fes' -> Fes doc via name match",
  resolveOrderCityPricingDoc({ providerLocationId: null, city: "Fes" }, byId, byName),
  fes
);

console.log("\n== 3) THE BUG: city itself IS the raw numeric provider id, no providerLocationId ==");
eq(
  "city='127' (the exact historical bug) -> resolves via id-as-city-value fallback -> Fes doc",
  resolveOrderCityPricingDoc({ providerLocationId: null, city: "127" }, byId, byName),
  fes
);
eq(
  "city='12345' -> Agadir doc",
  resolveOrderCityPricingDoc({ providerLocationId: undefined, city: "12345" }, byId, byName),
  agadir
);

console.log("\n== providerLocationId (when present) is preferred over a possibly-stale `city` ==");
eq(
  "providerLocationId=12345 wins even though city says something else",
  resolveOrderCityPricingDoc({ providerLocationId: "12345", city: "Some Stale Name" }, byId, byName),
  agadir
);

console.log("\n== genuinely unresolved cases -> null, never guessed/fuzzy ==");
eq("unknown numeric id, no matching doc -> null", resolveOrderCityPricingDoc({ providerLocationId: null, city: "999999" }, byId, byName), null);
eq("unknown city name -> null", resolveOrderCityPricingDoc({ providerLocationId: null, city: "Nowhereville" }, byId, byName), null);
eq("no city at all -> null", resolveOrderCityPricingDoc({ providerLocationId: null, city: null }, byId, byName), null);
eq("empty maps -> null", resolveOrderCityPricingDoc({ providerLocationId: "12345", city: "Agadir" }, new Map(), new Map()), null);

console.log("\n== real-zero vs missing price is preserved by the CALLER, not this resolver ==");
{
  // This resolver only finds the DOC; distinguishing "missing" (null) from
  // "real zero" is the caller's job (lib/finance/calculate.js), by reading
  // the specific price field afterward — proven here: Agadir's real
  // returnedPriceCents is 0 (not missing), Fes's is null (genuinely
  // unconfigured for that status).
  const agadirDoc = resolveOrderCityPricingDoc({ providerLocationId: "12345" }, byId, byName);
  const fesDoc = resolveOrderCityPricingDoc({ providerLocationId: "127" }, byId, byName);
  eq("Agadir returnedPriceCents is a real 0, not missing", agadirDoc.returnedPriceCents, 0);
  eq("Fes returnedPriceCents is genuinely null (unconfigured)", fesDoc.returnedPriceCents, null);
}

console.log(`\n${failures === 0 ? "ALL CHECKS PASSED" : failures + " CHECK(S) FAILED"}`);
process.exit(failures === 0 ? 0 : 1);
