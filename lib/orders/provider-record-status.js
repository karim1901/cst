/**
 * Client-safe constants for an `Order`'s existence at the shipping
 * PROVIDER — completely separate from `lastKnownStatus` (the provider's
 * live shipping/delivery status text) and from `returnValidationStatus`
 * (lib/returns/constants.js — the merchant's own internal "did I get the
 * physical parcel back" state). This one answers a third, independent
 * question: does the provider still know about this tracking number at
 * all?
 *
 * Root cause this exists to fix: when an order is deleted directly in the
 * Ozon Express (or Quick Livraison) dashboard, this app's local `Order`
 * mirror previously had no way to represent that — it just kept showing
 * the order everywhere (Returns, Dashboard, Commission, Finance) forever,
 * and Finance kept charging its product/shipping cost. Kept independent of
 * any Mongoose model, same reason as lib/returns/constants.js and
 * lib/shipping/providers.js — importing a model drags mongoose/mongodb
 * into the browser bundle. models/Order.js imports the status values from
 * here, not the other way around.
 *
 * "active" is the default for EVERY order — new or pre-existing. Nothing
 * ever sets "deleted" except confirmed provider reconciliation
 * (lib/orders/reconcile-stale-orders.js, the ONE writer) or manual repair.
 * A provider-deleted order's local Mongo document is NEVER physically
 * removed — this is a soft-delete/audit-trail marker, preserving historical
 * financial/reporting data (see that module's own comment for why a hard
 * delete is the wrong tool here). Reconciliation NEVER rewrites
 * `lastKnownStatus`/`deliveredAt` when marking a record deleted — provider
 * existence and shipping/delivery status are deliberately orthogonal.
 */
export const PROVIDER_RECORD_STATUSES = Object.freeze({
  ACTIVE: "active",
  DELETED: "deleted",
});

export const PROVIDER_RECORD_STATUS_VALUES = Object.freeze(
  Object.values(PROVIDER_RECORD_STATUSES)
);

/**
 * The Mongo filter clause that means "still active at the provider" —
 * `$ne` (not "$in: [ACTIVE]") is deliberate: it also matches a legacy
 * document that predates this field and therefore has it unset entirely
 * (the exact same "missing field defaults to the safe/inclusive state"
 * rule already established for `returnValidationStatus` — see
 * lib/returns/constants.js's own comment and the Returns-page pending-
 * filter fix it documents). A legacy order is never wrongly excluded just
 * because this field did not exist yet when it was written.
 */
export const ACTIVE_PROVIDER_ORDER_FILTER = Object.freeze({
  $ne: PROVIDER_RECORD_STATUSES.DELETED,
});

/**
 * Pure decision: given a provider lookup's classification for ONE local
 * order (lib/ozon/lookup.js / lib/quick/lookup.js's 3-way
 * "exists"/"not_found"/"unknown") and that order's CURRENT
 * `providerRecordStatus`, what should reconciliation do? The single source
 * of truth for lib/orders/reconcile-stale-orders.js,
 * lib/quick/reconcile-current-month.js, lib/commission/sync-historical-orders.js
 * and lib/quick/sync-order.js's revive logic — so all four call sites (and
 * this rule's own regression test) can never drift apart.
 *
 *  - "not_found" + currently active   -> "markDeleted" (soft-delete).
 *  - "not_found" + already deleted    -> "none" (nothing changed; avoids a
 *    redundant write — in practice this case never reaches here, since
 *    reconciliation's own query already excludes already-deleted orders).
 *  - "exists" + currently deleted     -> "revive" (the provider's current,
 *    authoritative answer wins — it was recreated, or an earlier deletion
 *    determination no longer holds).
 *  - "exists" + already active        -> "none" (nothing to do; status/
 *    price refresh is a completely separate concern, handled elsewhere).
 *  - "unknown" (API/network failure, ambiguous even after retrying)
 *                                      -> ALWAYS "none". A temporary
 *    failure must never be treated as a confirmed absence, and must never
 *    revive/undo anything either.
 *
 * @param {{classification:"exists"|"not_found"|"unknown", currentStatus:string|null|undefined}} args
 *   `currentStatus` — the order's stored `providerRecordStatus`; `null`/
 *   `undefined` (a legacy row, or one that simply defaults) is treated as
 *   "active", same as `ACTIVE_PROVIDER_ORDER_FILTER`'s own `$ne` semantics.
 * @returns {{action:"none"|"markDeleted"|"revive"}}
 */
export function reconciliationAction({ classification, currentStatus }) {
  const isDeleted = currentStatus === PROVIDER_RECORD_STATUSES.DELETED;
  if (classification === "not_found") {
    return { action: isDeleted ? "none" : "markDeleted" };
  }
  if (classification === "exists") {
    return { action: isDeleted ? "revive" : "none" };
  }
  return { action: "none" }; // "unknown" -> never touch
}
