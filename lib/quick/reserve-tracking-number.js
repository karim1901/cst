/**
 * Quick Livraison tracking-number reservation.
 *
 * Thin, provider-bound wrapper over the generic monthly-counter CAS
 * implementation in lib/tracking/reserve-counter.js, bound to
 * `SHIPPING_PROVIDERS.QUICK_LIVRAISON` — completely independent from Ozon
 * Express's sequence (see lib/ozon/reserve-tracking-number.js). A Quick
 * reservation/release can only ever touch (ownerId, "quick_livraison",
 * period) documents, so a Quick order can never advance or roll back the
 * Ozon counter, and vice versa.
 */

import {
  reserveNextCounter,
  releaseCounter,
  peekLatestCounter,
} from "@/lib/tracking/reserve-counter";
import { SHIPPING_PROVIDERS } from "@/models/ShippingCompany";

const PROVIDER = SHIPPING_PROVIDERS.QUICK_LIVRAISON;

export async function reserveNextQuickTrackingNumber(ownerId, period) {
  return reserveNextCounter(ownerId, PROVIDER, period);
}

export async function releaseQuickTrackingNumber(reservation) {
  return releaseCounter(reservation);
}

export async function peekLatestQuickCounter(ownerId, period) {
  return peekLatestCounter(ownerId, PROVIDER, period);
}
