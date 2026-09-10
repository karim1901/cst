"use client";

import { ORDER_STATUS_FILTER_VALUES, STATUS_FILTER_LABELS } from "@/lib/orders/status-groups";
import { useLocale } from "@/app/_components/i18n/LocaleProvider";

/**
 * Which of the 4 status buckets (see lib/orders/status-groups.js) the
 * Orders page shows — combines with whichever provider/employee/month
 * filters are also active (see app/_components/orders/OrdersPageClient.jsx,
 * the one place all of these are composed). Same visual pattern as
 * ProviderTabs, one level down in visual weight (smaller, wraps on narrow
 * screens instead of forcing a horizontal scroll).
 *
 * Labels come from lib/orders/status-groups.js#STATUS_FILTER_LABELS — the
 * ONE source of truth for "Tous"/"Livré"/"Progress"/"Retour", NEVER routed
 * through i18n/translated (see that constant's own comment). Only the
 * wrapper's aria-label (not shown on screen) is localised.
 */
export default function StatusFilter({ value, onChange }) {
  const { t } = useLocale();
  return (
    <div
      role="tablist"
      aria-label={t("orders.orderStatus")}
      className="inline-flex flex-wrap gap-1 rounded-xl border border-zinc-200 bg-zinc-100 p-1 dark:border-zinc-800 dark:bg-zinc-900"
    >
      {ORDER_STATUS_FILTER_VALUES.map((id) => {
        const active = id === value;
        return (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onChange(id)}
            className={`rounded-lg px-3 py-1.5 text-xs font-medium transition sm:text-sm ${
              active
                ? "bg-white text-zinc-900 shadow-sm dark:bg-zinc-950 dark:text-zinc-50"
                : "text-zinc-500 hover:text-zinc-700 dark:text-zinc-400 dark:hover:text-zinc-200"
            }`}
          >
            {STATUS_FILTER_LABELS[id]}
          </button>
        );
      })}
    </div>
  );
}
