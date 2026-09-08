/**
 * Quick Livraison tracking-number format for this application.
 *
 * Thin, provider-bound wrapper over the generic lib/tracking/counter.js —
 * see that module for the actual format/rules. Same format as Ozon Express
 * (`prefix + period + "01" + counter`), but backed by its OWN monthly
 * counter documents (`provider: "quick_livraison"` in
 * models/TrackingCounter.js, see lib/quick/reserve-tracking-number.js) so
 * the two providers' sequences never share state.
 */

import { trackingPrefixFor, buildFullTrackingNumber } from "@/lib/tracking/counter";

export const quickTrackingPrefixFor = trackingPrefixFor;
export const buildFullQuickTrackingNumber = buildFullTrackingNumber;
