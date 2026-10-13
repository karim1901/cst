/**
 * Regression tests for lib/ozon/sync-mutable-fields.js#resolveOzonMutableFieldUpdates
 * — the root-cause fix for "I edited an order directly in the Ozon
 * dashboard and the change never appeared here" (see that module's own
 * comment for the full investigation and the real, live-verified
 * `PARCEL-INFO.INFOS` response shape these tests are built from).
 *
 * Pure/dependency-free — zero imports in the module under test — so this
 * runs with plain `node`, no DB, no network.
 *
 * Run with:  node scripts/verify-ozon-mutable-fields.mjs
 */

import { resolveOzonMutableFieldUpdates } from "../lib/ozon/sync-mutable-fields.js";

let failures = 0;
function eq(label, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failures++;
  console.log(`${ok ? "PASS" : "FAIL"} - ${label}${ok ? "" : ` - got ${JSON.stringify(actual)}, expected ${JSON.stringify(expected)}`}`);
}

const baseExisting = {
  receiverName: "Samira",
  phone: "0621965543",
  city: "Marrakech",
  providerLocationId: "199",
  address: "رياض السلام",
  productNature: "Rl",
  price: 220,
};

console.log("== no change at all: real response exactly matches stored state -> null (no write) ==");
{
  const infos = {
    RECEIVER: "Samira",
    PHONE: "0621965543",
    CITY_ID: "199",
    CITY_NAME: "Marrakech",
    ADDRESS: "رياض السلام",
    PRICE: "220",
    NOTE: "Rl",
  };
  eq("nothing to update", resolveOzonMutableFieldUpdates(baseExisting, infos), null);
}

console.log("\n== receiver name genuinely changed in the Ozon dashboard ==");
{
  const infos = { ...fullInfosFor(baseExisting), RECEIVER: "Fatima" };
  eq("receiverName updates, nothing else does", resolveOzonMutableFieldUpdates(baseExisting, infos), {
    receiverName: "Fatima",
  });
}

console.log("\n== phone number changed ==");
{
  const infos = { ...fullInfosFor(baseExisting), PHONE: "0600000000" };
  eq("phone updates", resolveOzonMutableFieldUpdates(baseExisting, infos), { phone: "0600000000" });
}

console.log("\n== a valid remote price change updates price + sets priceSource to provider_sync ==");
{
  const infos = { ...fullInfosFor(baseExisting), PRICE: "350" };
  eq(
    "price + priceSource update together",
    resolveOzonMutableFieldUpdates(baseExisting, infos),
    { price: 350, priceSource: "provider_sync" }
  );
}

console.log("\n== an absent PRICE in a partial response never erases a valid local amount (item 2's own safeguard) ==");
{
  const { PRICE, ...infosWithoutPrice } = fullInfosFor(baseExisting);
  eq("price untouched when PRICE key is simply absent", resolveOzonMutableFieldUpdates(baseExisting, infosWithoutPrice), null);
}

console.log("\n== PRICE present but 0, negative, or non-numeric never overwrites a valid local amount ==");
{
  for (const badPrice of ["0", "-50", "abc", "", null]) {
    const infos = { ...fullInfosFor(baseExisting), PRICE: badPrice };
    eq(`PRICE=${JSON.stringify(badPrice)} -> no price update`, resolveOzonMutableFieldUpdates(baseExisting, infos), null);
  }
}

console.log("\n== city change updates BOTH the display name and the provider city id together ==");
{
  const infos = { ...fullInfosFor(baseExisting), CITY_NAME: "Casablanca", CITY_ID: "7" };
  eq(
    "city + providerLocationId update together, never one without the other",
    resolveOzonMutableFieldUpdates(baseExisting, infos),
    { city: "Casablanca", providerLocationId: "7" }
  );
}

console.log("\n== CITY_ID backfilled when locally missing, even if CITY_NAME is unchanged (pre-existing discovery-sync gap) ==");
{
  const existingNoCityId = { ...baseExisting, providerLocationId: null };
  const infos = fullInfosFor(baseExisting); // CITY_NAME unchanged ("Marrakech")
  eq(
    "providerLocationId backfilled from a real response even with no city NAME change",
    resolveOzonMutableFieldUpdates(existingNoCityId, infos),
    { providerLocationId: "199" }
  );
}

console.log("\n== address explicitly reported as empty (key present, value \"\") -> the established N/A placeholder ==");
{
  const infos = { ...fullInfosFor(baseExisting), ADDRESS: "" };
  eq("address becomes the N/A placeholder, not a raw empty string", resolveOzonMutableFieldUpdates(baseExisting, infos), {
    address: "N/A",
  });
}

console.log("\n== address key entirely ABSENT (thin/partial response) never touches the existing address ==");
{
  const { ADDRESS, ...infosWithoutAddress } = fullInfosFor(baseExisting);
  eq("address untouched when the key is simply absent", resolveOzonMutableFieldUpdates(baseExisting, infosWithoutAddress), null);
}

console.log("\n== note (-> productNature) follows the same explicit-empty-vs-absent rule ==");
{
  const infosEmpty = { ...fullInfosFor(baseExisting), NOTE: "" };
  eq("explicit empty NOTE -> N/A", resolveOzonMutableFieldUpdates(baseExisting, infosEmpty), { productNature: "N/A" });

  const { NOTE, ...infosAbsent } = fullInfosFor(baseExisting);
  eq("absent NOTE -> untouched", resolveOzonMutableFieldUpdates(baseExisting, infosAbsent), null);
}

console.log("\n== an empty RECEIVER/PHONE/CITY_NAME is never adopted (never downgrade a required field to empty) ==");
{
  for (const key of ["RECEIVER", "PHONE", "CITY_NAME"]) {
    const infos = { ...fullInfosFor(baseExisting), [key]: "" };
    eq(`empty ${key} -> no update for that field`, resolveOzonMutableFieldUpdates(baseExisting, infos), null);
  }
}

console.log("\n== multiple real changes at once are all included together ==");
{
  const infos = { ...fullInfosFor(baseExisting), RECEIVER: "Fatima", PRICE: "500", ADDRESS: "Nouvelle adresse" };
  eq(
    "receiverName + price/priceSource + address all present together",
    resolveOzonMutableFieldUpdates(baseExisting, infos),
    { receiverName: "Fatima", address: "Nouvelle adresse", price: 500, priceSource: "provider_sync" }
  );
}

console.log("\n== never returns an ownership/tracking/identity field — this resolver has no way to touch those ==");
{
  const infos = { ...fullInfosFor(baseExisting), RECEIVER: "Fatima" };
  const result = resolveOzonMutableFieldUpdates(baseExisting, infos);
  const forbiddenKeys = ["employeeId", "merchantId", "trackingNumber", "numericTrackingNumber", "provider", "returnValidationStatus"];
  eq("no forbidden key ever appears", forbiddenKeys.some((k) => k in result), false);
}

console.log("\n== null existing or null infos -> null (never throws) ==");
{
  eq("null existing", resolveOzonMutableFieldUpdates(null, fullInfosFor(baseExisting)), null);
  eq("null infos", resolveOzonMutableFieldUpdates(baseExisting, null), null);
}

console.log(`\n${failures === 0 ? "ALL CHECKS PASSED" : failures + " CHECK(S) FAILED"}`);
process.exit(failures === 0 ? 0 : 1);

/** Build a full, real-shaped INFOS object that exactly matches `existing` — tests above override one field at a time. */
function fullInfosFor(existing) {
  return {
    "TRACKING-NUMBER": "ibtissam202608011001",
    RECEIVER: existing.receiverName,
    PHONE: existing.phone,
    CITY_ID: existing.providerLocationId,
    CITY_NAME: existing.city,
    ADDRESS: existing.address,
    PRICE: String(existing.price),
    NOTE: existing.productNature,
    "DELIVERED-PRICE": "35",
    "RETURNED-PRICE": "0",
    "REFUSED-PRICE": "0",
  };
}
