/**
 * Ozon Express tracking-number format for this application.
 *
 * Thin, provider-bound wrapper over the generic lib/tracking/counter.js —
 * see that module for the actual format/rules (monthly counter, fixed "01"
 * day segment, 1000 boundary). Kept as a separate file (rather than
 * inlining the generic calls at each call site) so
 * app/api/orders/ozon/route.js didn't need to change when Quick Livraison's
 * equivalent (lib/quick/tracking-number.js) was added — same exported
 * names, same signatures, just bound to Ozon's own counter semantics.
 */

import { trackingPrefixFor, buildFullTrackingNumber } from "@/lib/tracking/counter";

export const ozonTrackingPrefixFor = trackingPrefixFor;
export const buildFullOzonTrackingNumber = buildFullTrackingNumber;
