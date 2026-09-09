/**
 * Server-only: resolves which Quick Livraison API credentials to use for a
 * given order-related request — the ONE place that decides this, so
 * app/api/orders/quick/route.js and
 * lib/commission/sync-historical-orders.js#syncHistoricalQuickOrders agree
 * on exactly the same rule instead of each re-implementing it.
 *
 * ROOT CAUSE this file fixes: an employee can configure their OWN Quick
 * Livraison API key (models/User.js#quickLivraisonApiKey, entered via the
 * employee creation/edit form — app/_components/AddEmployeeForm.jsx /
 * EditEmployeeForm.jsx) — correctly encrypted on save, correctly
 * `select:false`-protected. But until this file existed, NOTHING in the
 * order-creation/listing/sync code paths ever read that field: every Quick
 * request unconditionally used the MERCHANT's own shared ShippingCompany
 * credential instead, silently ignoring whatever an employee had entered
 * for themselves. That's why a brand-new employee with a brand-new,
 * correctly-encrypted key still failed identically to before — the new key
 * was never even looked at. The actual crash came from the (unrelated,
 * pre-existing) merchant-level ShippingCompany record being undecryptable
 * under the current SECRET_ENCRYPTION_KEY/encryption format — see
 * loadMerchantQuickCredentials's own comment.
 *
 * Resolution rule: prefer the ACTING employee's own key when they have one
 * configured (and it decrypts successfully); otherwise fall back to the
 * merchant's shared ShippingCompany credential — unchanged, pre-existing
 * behavior for every employee who was never given their own key, and for
 * merchants acting directly.
 *
 * Decryption failures are NEVER allowed to throw out of this module — a
 * credential that fails to decrypt (old/different encryption key at the
 * time it was saved, corrupted data, ...) is treated exactly like "not
 * configured": logged server-side only (never the secret itself, never the
 * decryption key), so a broken credential degrades to a clear, actionable
 * error instead of crashing the request. It is NEVER silently overwritten
 * or deleted here — the merchant/employee simply needs to re-save a valid
 * key (the existing settings/employee-edit forms already do this
 * correctly), which this module will then read and decrypt normally.
 */

if (typeof window !== "undefined") {
  throw new Error("lib/quick/credentials.js is server-only and must not be imported in client code");
}

import User from "@/models/User";
import ShippingCompany, { SHIPPING_PROVIDERS } from "@/models/ShippingCompany";
import { decryptSecret } from "@/lib/crypto/secret-box";

/**
 * The merchant's own shared Quick Livraison credential (app/api/shipping-
 * companies/route.js is where a merchant configures/re-configures this).
 * @param {string} merchantId
 * @returns {Promise<{apiKey:string}|null>}
 */
export async function loadMerchantQuickCredentials(merchantId) {
  const doc = await ShippingCompany.findOne({
    merchantId,
    provider: SHIPPING_PROVIDERS.QUICK_LIVRAISON,
  }).select("+apiKey");
  if (!doc) return null;
  try {
    return { apiKey: decryptSecret(doc.apiKey) };
  } catch (err) {
    console.error(
      "[quick credentials] merchant-level ShippingCompany credential could not be decrypted for merchant",
      String(merchantId),
      "- likely encrypted under a different/old SECRET_ENCRYPTION_KEY or corrupted; re-saving the API key under Shipping Companies will fix this. -",
      err?.message
    );
    return null;
  }
}

/**
 * One specific employee's OWN Quick Livraison credential, if they have one
 * configured (models/User.js#quickLivraisonApiKey).
 * @param {string} employeeId
 * @returns {Promise<{apiKey:string}|null>}
 */
export async function loadEmployeeQuickCredentials(employeeId) {
  if (!employeeId) return null;
  const doc = await User.findById(employeeId)
    .select("+quickLivraisonApiKey hasQuickLivraisonApiKey")
    .lean();
  if (!doc?.hasQuickLivraisonApiKey || !doc.quickLivraisonApiKey) return null;
  try {
    return { apiKey: decryptSecret(doc.quickLivraisonApiKey) };
  } catch (err) {
    console.error(
      "[quick credentials] employee-level credential could not be decrypted for employee",
      String(employeeId),
      "- re-saving a new API key for this employee will fix this. -",
      err?.message
    );
    return null;
  }
}

/**
 * The ONE resolution rule every Quick order-related route/job uses.
 * `actorId` is the id whose OWN key should be preferred if they have one —
 * the employee creating/viewing/syncing their own orders, or the specific
 * employee a merchant is browsing/syncing. Always a server-verified id,
 * never trusted raw from the client (see each caller's own ownership
 * checks). `merchantId` is the fallback owner (also the primary owner when
 * `actorId` IS the merchant themselves, or has no key of their own).
 *
 * @param {string|null} actorId
 * @param {string} merchantId
 * @returns {Promise<{apiKey:string}|null>}
 */
export async function resolveQuickCredentials(actorId, merchantId) {
  if (actorId) {
    const own = await loadEmployeeQuickCredentials(actorId);
    if (own) return own;
  }
  return loadMerchantQuickCredentials(merchantId);
}
