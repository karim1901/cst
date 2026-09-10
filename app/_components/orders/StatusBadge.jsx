"use client";

import { statusBadgeTone as ozonStatusBadgeTone } from "@/lib/ozon/status";
import { genericStatusBadgeTone } from "@/lib/orders/status-groups";
import { SHIPPING_PROVIDERS } from "@/lib/shipping/providers";
import { useLocale } from "@/app/_components/i18n/LocaleProvider";

const TONE_CLASSES = {
  red: "bg-red-100 text-red-700 dark:bg-red-950/50 dark:text-red-300",
  blue: "bg-blue-100 text-blue-700 dark:bg-blue-950/50 dark:text-blue-300",
  sky: "bg-sky-100 text-sky-700 dark:bg-sky-950/50 dark:text-sky-300",
  green: "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300",
  amber: "bg-amber-100 text-amber-700 dark:bg-amber-950/50 dark:text-amber-300",
  zinc: "bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300",
};

/**
 * Small status pill. Colors are semantic (green = delivered, red = returned,
 * ...), preserved from the old implementation's status → color mapping — not
 * a copy of the reference mockup's styling, since this maps meaning, not
 * aesthetics.
 *
 * `provider` decides which tone function to use — defaults to Ozon Express
 * for 100% backward compatibility with every call site that predates this
 * prop (they keep behaving exactly as before). Quick Livraison (or any
 * other future provider) gets the generic, centralized 3-bucket
 * classification instead (lib/orders/status-groups.js#genericStatusBadgeTone)
 * — Ozon's own richer tone function stays untouched and Ozon-only.
 */
export default function StatusBadge({ status, provider = SHIPPING_PROVIDERS.OZON_EXPRESS }) {
  const { t } = useLocale();
  const tone =
    provider === SHIPPING_PROVIDERS.OZON_EXPRESS
      ? ozonStatusBadgeTone(status)
      : genericStatusBadgeTone(provider, status);
  return (
    <span
      className={`inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-semibold ${TONE_CLASSES[tone]}`}
    >
      {/* `status` is the provider's own status string — real data, shown
          verbatim; only the empty-value fallback is localised. */}
      {status || t("returns.unknown")}
    </span>
  );
}
