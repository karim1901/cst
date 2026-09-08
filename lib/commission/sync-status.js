/**
 * Opportunistic, best-effort local status cache — shared by both providers'
 * order-listing GET handlers (app/api/orders/ozon/route.js and
 * app/api/orders/quick/route.js). Every time either route re-fetches an
 * order's live status from its provider (which already happens whenever the
 * Orders page is viewed for a given month — no new polling is introduced
 * here), it also calls this so the local `Order` mirror's `lastKnownStatus`
 * stays fresh and `deliveredAt` gets recorded the moment a delivery is first
 * observed. This is what lets the commission system (lib/commission/*)
 * calculate entirely from MongoDB, without calling Ozon/Quick itself — see
 * the README's "Commission" section for the full rationale.
 *
 * Fire-and-forget on purpose (never awaited by callers): this must never add
 * latency to, or be able to fail, the order-listing response it rides along
 * with. Same posture the Quick route already had for its own status cache
 * before this file existed.
 */

import Order from "@/models/Order";
import { isDeliveredDisplayStatus } from "@/lib/commission/status";

/**
 * @param {{provider:string, trackingNumber:string, status:string|null, deliveredAt?:Date|null}} args
 *   `deliveredAt`, when known (Ozon's history gives the real "Livré" event
 *   time — see lib/ozon/history.js#findDeliveredAt), is used exactly as-is
 *   so a delivery observed late is still attributed to the month it actually
 *   happened in. When omitted (Quick, whose API doesn't expose a delivery
 *   timestamp) this falls back to "now" — the best available signal.
 */
export function syncOrderStatus({ provider, trackingNumber, status, deliveredAt = undefined }) {
  if (!status || !trackingNumber) return;

  const delivered = isDeliveredDisplayStatus(provider, status);
  const knownDeliveredAt = delivered && deliveredAt instanceof Date ? deliveredAt : null;

  // A pipeline update so "set deliveredAt only the first time, never
  // overwrite it afterward" is a single atomic write instead of a
  // read-then-write race between concurrent requests (e.g. two Orders-page
  // tabs open at once).
  Order.updateOne(
    { provider, trackingNumber },
    [
      {
        $set: {
          lastKnownStatus: status,
          deliveredAt: delivered
            ? {
                $cond: [
                  { $eq: ["$deliveredAt", null] },
                  knownDeliveredAt ?? "$$NOW",
                  "$deliveredAt",
                ],
              }
            : "$deliveredAt",
        },
      },
    ],
    { updatePipeline: true }
  ).catch((err) => {
    console.error(
      "[commission] failed to sync local status for",
      trackingNumber,
      "-",
      err?.message
    );
  });
}
