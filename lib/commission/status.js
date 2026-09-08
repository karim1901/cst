/**
 * "Is this order delivered?" — the one predicate the commission system uses
 * to decide whether an order contributes to a month's calculation (see
 * lib/commission/calculate.js). Provider-aware because Ozon and Quick speak
 * different status vocabularies for the same real-world event:
 *
 *  - Ozon Express: French history-derived statuses (see lib/ozon/status.js)
 *    — "Livré" is delivered.
 *  - Quick Livraison: the `status` field's raw value (see
 *    lib/quick/parse.js#quickDisplayStatus, and the earlier fix that made
 *    sure this is `status`, never `situation`) — "DELIVERED" is delivered.
 */

import { SHIPPING_PROVIDERS } from "@/models/ShippingCompany";
import { isDelivered as isOzonDeliveredStatus } from "@/lib/ozon/status";

const QUICK_DELIVERED_STATUS = "DELIVERED";

/** @param {string} provider one of SHIPPING_PROVIDERS @param {string|null} status */
export function isDeliveredDisplayStatus(provider, status) {
  if (!status) return false;
  if (provider === SHIPPING_PROVIDERS.OZON_EXPRESS) {
    return isOzonDeliveredStatus(status);
  }
  if (provider === SHIPPING_PROVIDERS.QUICK_LIVRAISON) {
    return String(status).toUpperCase() === QUICK_DELIVERED_STATUS;
  }
  return false;
}
