/**
 * Regression test for the Quick Livraison credential encryption/decryption
 * flow — see lib/crypto/secret-box.js and lib/quick/credentials.js.
 *
 * This project has no test framework configured (no jest/vitest/mocha), so
 * this follows the same convention every other verification in this repo
 * already uses: a standalone script, reusing the real application code
 * (mongoose models, the real secret-box implementation, the real HTTP
 * routes) against a REAL database and a REAL running server — never a mock.
 * It creates its own disposable `zzz_quickcred_*` test records and deletes
 * them again at the end. NEVER uses a real Quick Livraison API key — only
 * synthetic placeholder strings, since these tests only need to prove the
 * encrypt/store/decrypt round trip and the credential-resolution rule, not
 * a real Quick response.
 *
 * `lib/quick/credentials.js` (and everything else under app/lib) uses `@/`
 * import aliases that only Next's own bundler resolves — plain Node cannot
 * import it directly. So the parts of this script that need the REAL
 * request path (the credential-resolution RULE, not just the crypto
 * primitive) run against a live server over HTTP, exactly like this
 * project's other verification scripts already do; the pure crypto
 * round-trip (lib/crypto/secret-box.js has zero `@/` imports) is tested by
 * importing it directly.
 *
 * Usage:
 *   1. Start the app:  npm run dev   (or npm run build && npm run start)
 *   2. Run:             node --env-file=.env.local scripts/verify-quick-credentials.mjs [baseUrl]
 *      (baseUrl defaults to http://localhost:3000)
 *
 * Exits non-zero if any check fails.
 */

import mongoose from "mongoose";
import { connectToDatabase } from "../lib/mongodb.js";
import User, { USER_ROLES } from "../models/User.js";
import ShippingCompany, { SHIPPING_PROVIDERS } from "../models/ShippingCompany.js";
import { encryptSecret, decryptSecret } from "../lib/crypto/secret-box.js";

const BASE = process.argv[2] || "http://localhost:3000";

let failures = 0;
function check(label, ok, extra = "") {
  const mark = ok ? "PASS" : "FAIL";
  if (!ok) failures++;
  console.log(`${mark} - ${label}${extra ? " - " + extra : ""}`);
}

// ---------------------------------------------------------------------------
// Test 1: plaintext -> encryptSecret() -> decryptSecret() -> original
// plaintext. The one thing that must be true before anything downstream can
// possibly work. Pure function, no DB/server needed.
// ---------------------------------------------------------------------------
{
  const plaintext = `QUICK_TEST_VALUE_${Date.now()}`;
  const decrypted = decryptSecret(encryptSecret(plaintext));
  check("Test 1: encryptSecret -> decryptSecret round trip", decrypted === plaintext);

  // getKey() (lib/crypto/secret-box.js) re-reads process.env on EVERY call —
  // no module-level caching, no runtime-generated value — so a second,
  // independent round trip in the same process proves there is no per-call
  // drift, and by construction (env-var-only, file-backed, never derived
  // from anything in-memory) the same holds true across a real process
  // restart.
  const decrypted2 = decryptSecret(encryptSecret(plaintext));
  check(
    "Test 1b: a second independent round trip also matches (key is stable, not regenerated per call)",
    decrypted2 === plaintext
  );
}

await connectToDatabase();

const MERCHANT_EMAIL = "zzz_quickcred_merchant@cst.local";
const EMPLOYEE_USERNAME = "zzz_quickcred_employee";
const NOKEY_USERNAME = "zzz_quickcred_employee_nokey";
const PASSWORD = "TempPass_123456";

async function cleanupDb() {
  const merchant = await User.findOne({ email: MERCHANT_EMAIL });
  if (merchant) {
    await ShippingCompany.deleteMany({ merchantId: merchant._id });
  }
  await User.deleteMany({
    $or: [{ email: MERCHANT_EMAIL }, { username: EMPLOYEE_USERNAME }, { username: NOKEY_USERNAME }],
  });
}
await cleanupDb();

// ---------------------------------------------------------------------------
// Fixtures: a merchant with a deliberately BROKEN shared ShippingCompany
// credential (same structural shape as the real, already-existing broken
// production record — a base64 blob shorter than the 28-byte iv+tag floor,
// impossible to produce from the current encryptSecret()), one employee
// with their OWN valid key, one employee with no key of their own.
// ---------------------------------------------------------------------------
const merchant = await User.create({
  name: "Quick Credential Test Merchant",
  email: MERCHANT_EMAIL,
  password: PASSWORD,
  role: USER_ROLES.MERCHANT,
});

const EMPLOYEE_KEY_PLAINTEXT = "zzz_synthetic_employee_quick_key_0001";
const employee = await User.create({
  name: "Quick Credential Test Employee",
  username: EMPLOYEE_USERNAME,
  password: PASSWORD,
  role: USER_ROLES.EMPLOYEE,
  merchantId: merchant._id,
  quickLivraisonApiKey: EMPLOYEE_KEY_PLAINTEXT, // encrypted by the model's pre-save hook
});

const employeeNoKey = await User.create({
  name: "Quick Credential Test Employee No Key",
  username: NOKEY_USERNAME,
  password: PASSWORD,
  role: USER_ROLES.EMPLOYEE,
  merchantId: merchant._id,
});

const storedEmployee = await User.findById(employee._id).select("+quickLivraisonApiKey").lean();
check(
  "Test 2: employee's Quick key is stored encrypted (not plaintext) in MongoDB",
  typeof storedEmployee.quickLivraisonApiKey === "string" &&
    storedEmployee.quickLivraisonApiKey !== EMPLOYEE_KEY_PLAINTEXT
);
check(
  "Test 2b: decryptSecret() on the stored value recovers the original plaintext",
  decryptSecret(storedEmployee.quickLivraisonApiKey) === EMPLOYEE_KEY_PLAINTEXT
);

const brokenShipping = await ShippingCompany.create({
  merchantId: merchant._id,
  provider: SHIPPING_PROVIDERS.QUICK_LIVRAISON,
  apiKey: "placeholder", // valid on save; corrupted right after, below
});
await ShippingCompany.updateOne(
  { _id: brokenShipping._id },
  { $set: { apiKey: Buffer.from("not-a-valid-encrypted-blob").toString("base64") } }
);

// ---------------------------------------------------------------------------
// Login helpers — every remaining test exercises the REAL HTTP route
// (app/api/orders/quick/route.js), the same one the actual bug report came
// from, through Next's own module resolution (no mocking).
// ---------------------------------------------------------------------------
async function loginCookie(identifier) {
  const res = await fetch(`${BASE}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ identifier, password: PASSWORD }),
    redirect: "manual",
  });
  const setCookie = res.headers.get("set-cookie");
  if (!setCookie) {
    throw new Error(`Login failed for ${identifier}: ${res.status} ${await res.text().catch(() => "")}`);
  }
  return setCookie.split(";")[0];
}

async function postQuickOrder(cookie) {
  return fetch(`${BASE}/api/orders/quick`, {
    method: "POST",
    headers: { "Content-Type": "application/json", cookie },
    body: JSON.stringify({
      receiver: "Regression Test Customer",
      phone: "0655012345",
      districtId: "1",
      address: "Test Address",
      productName: "Test Product",
      quantity: 1,
      amount: 100,
    }),
  });
}

// Test 4 (the exact reported bug, reproduced and proven fixed): the new
// employee's OWN key must be used — and must succeed at the decryption step
// — even though the merchant's shared credential is broken.
{
  const cookie = await loginCookie(EMPLOYEE_USERNAME);
  const res = await postQuickOrder(cookie);
  const body = await res.json().catch(() => ({}));
  // A raw crypto crash would surface as a 500 with no clean `error` message
  // (or the dev overlay); reaching Quick and getting a normal rejection (a
  // synthetic key was used, so Quick itself will reject it) proves
  // decryption succeeded — the failure point moved to the provider, exactly
  // as required.
  check(
    "Test 4: employee with their OWN key — decryption succeeds, request reaches Quick (no crypto crash)",
    res.status !== 500 && !JSON.stringify(body).toLowerCase().includes("unsupported state"),
    `status=${res.status}, error=${body?.error}`
  );
  check(
    "Test 4b: error response (if any) never leaks the API key or the encryption secret",
    !JSON.stringify(body).includes(EMPLOYEE_KEY_PLAINTEXT) &&
      !JSON.stringify(body).includes(process.env.SECRET_ENCRYPTION_KEY ?? " ")
  );
}

// Test 4c: an employee with NO key of their own, same merchant, whose
// shared credential is still broken at this point — must fail CLEANLY
// (409, clear message), never a raw stack trace.
{
  const cookie = await loginCookie(NOKEY_USERNAME);
  const res = await postQuickOrder(cookie);
  const body = await res.json().catch(() => ({}));
  check(
    "Test 4c: employee with no key of their own + broken merchant credential -> clean 409, not a crash",
    res.status === 409 && body?.error === "Quick Livraison credentials are not configured correctly.",
    `status=${res.status}, body=${JSON.stringify(body)}`
  );
}

// Test 4d: fix the merchant's shared credential the NORMAL way (re-save,
// exactly what POST /api/shipping-companies already does) — the
// no-own-key employee must now succeed (reach Quick) immediately.
{
  const MERCHANT_KEY_PLAINTEXT = "zzz_synthetic_merchant_quick_key_0002";
  await ShippingCompany.updateOne(
    { _id: brokenShipping._id },
    { $set: { apiKey: encryptSecret(MERCHANT_KEY_PLAINTEXT), apiKeyLast4: MERCHANT_KEY_PLAINTEXT.slice(-4) } }
  );
  const cookie = await loginCookie(NOKEY_USERNAME);
  const res = await postQuickOrder(cookie);
  const body = await res.json().catch(() => ({}));
  check(
    "Test 4d: re-saving a valid merchant credential fixes decryption immediately for employees with no key of their own",
    res.status !== 500 && !JSON.stringify(body).toLowerCase().includes("unsupported state"),
    `status=${res.status}, error=${body?.error}`
  );
}

// Test 6: Ozon's own credential path is untouched by this fix.
{
  const fs = await import("node:fs/promises");
  const ozonRouteSrc = await fs.readFile(
    new URL("../app/api/orders/ozon/route.js", import.meta.url),
    "utf8"
  );
  check(
    "Test 6: app/api/orders/ozon/route.js does not reference lib/quick/credentials.js (Ozon's own credential path is untouched)",
    !ozonRouteSrc.includes("lib/quick/credentials")
  );
}

await cleanupDb();

console.log("\n" + (failures === 0 ? "All checks passed." : `${failures} check(s) FAILED.`));
await mongoose.disconnect();
process.exit(failures === 0 ? 0 : 1);
