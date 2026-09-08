"use client";

import { ORDER_STATUS_FILTERS } from "@/lib/orders/status-groups";

// Labels exactly as requested — "Livré"/"Retour"/"Progress" already match
// this app's own established vocabulary (the same words the Dashboard's
// stat cards use — see app/_components/dashboard/StatsCards.jsx).
const OPTIONS = [
  { id: ORDER_STATUS_FILTERS.ALL, label: "Tous" },
  { id: ORDER_STATUS_FILTERS.DELIVERED, label: "Livré" },
  { id: ORDER_STATUS_FILTERS.PROGRESS, label: "Progress" },
  { id: ORDER_STATUS_FILTERS.RETURN, label: "Retour" },
];

/**
 * Which of the 4 status buckets (see lib/orders/status-groups.js) the
 * Orders page shows — combines with whichever provider/employee/month
 * filters are also active (see app/_components/orders/OrdersPageClient.jsx,
 * the one place all of these are composed). Same visual pattern as
 * ProviderTabs, one level down in visual weight (smaller, wraps on narrow
 * screens instead of forcing a horizontal scroll).
 */
export default function StatusFilter({ value, onChange }) {
  return (
    <div
      role="tablist"
      aria-label="Order status"
      className="inline-flex flex-wrap gap-1 rounded-xl border border-zinc-200 bg-zinc-100 p-1 dark:border-zinc-800 dark:bg-zinc-900"
    >
      {OPTIONS.map((option) => {
        const active = option.id === value;
        return (
          <button
            key={option.id}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onChange(option.id)}
            className={`rounded-lg px-3 py-1.5 text-xs font-medium transition sm:text-sm ${
              active
                ? "bg-white text-zinc-900 shadow-sm dark:bg-zinc-950 dark:text-zinc-50"
                : "text-zinc-500 hover:text-zinc-700 dark:text-zinc-400 dark:hover:text-zinc-200"
            }`}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
