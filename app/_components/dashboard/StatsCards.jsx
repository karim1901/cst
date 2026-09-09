"use client";

import DeliveryProgressRing from "@/app/_components/dashboard/DeliveryProgressRing";
import { useLocale } from "@/app/_components/i18n/LocaleProvider";
import { STATUS_FILTER_LABELS } from "@/lib/orders/status-groups";

const CARD =
  "rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm dark:border-zinc-800 dark:bg-zinc-900";

function CountCard({ label, value, tone, icon }) {
  const toneClasses = {
    emerald: "bg-emerald-50 text-emerald-600 dark:bg-emerald-950/50 dark:text-emerald-400",
    red: "bg-red-50 text-red-600 dark:bg-red-950/50 dark:text-red-400",
    amber: "bg-amber-50 text-amber-600 dark:bg-amber-950/50 dark:text-amber-400",
    zinc: "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300",
  }[tone];

  return (
    <div className={CARD}>
      <div className="flex items-center gap-3">
        <span className={`grid h-10 w-10 shrink-0 place-items-center rounded-xl ${toneClasses}`}>
          {icon}
        </span>
        <div className="min-w-0">
          <p className="text-sm font-medium text-zinc-500 dark:text-zinc-400">{label}</p>
          <p className="text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
            {value.toLocaleString()}
          </p>
        </div>
      </div>
    </div>
  );
}

const DELIVERED_ICON = (
  <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.75" className="h-5 w-5">
    <path strokeLinecap="round" strokeLinejoin="round" d="M4 10.5 8 14.5 16 5.5" />
  </svg>
);

const RETURN_ICON = (
  <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.75" className="h-5 w-5">
    <path strokeLinecap="round" strokeLinejoin="round" d="M12 5 6 10l6 5" />
    <path strokeLinecap="round" strokeLinejoin="round" d="M6 10h9a3.5 3.5 0 0 1 0 7h-1" />
  </svg>
);

const PROGRESS_ICON = (
  <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.75" className="h-5 w-5">
    <circle cx="10" cy="10" r="7" />
    <path strokeLinecap="round" strokeLinejoin="round" d="M10 6v4l2.5 2.5" />
  </svg>
);

const TOTAL_ICON = (
  <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.75" className="h-5 w-5">
    <rect x="3.5" y="3.5" width="13" height="13" rx="2" />
    <path strokeLinecap="round" d="M7 8h6M7 11h6M7 14h3.5" />
  </svg>
);

/**
 * The dashboard's "order performance" section — Total / Livré / Retour /
 * Progress counts plus the delivered-vs-returned ring. `stats` is
 * lib/orders/dashboard-stats.js#computeOrderDeliveryStats's return value,
 * already scoped to ONE provider and (optionally) ONE month by the caller
 * (app/_components/dashboard/DashboardStats.jsx) — this component itself
 * has no provider/month awareness, it only ever renders whatever numbers
 * it is given.
 */
export default function StatsCards({ stats }) {
  const { totalOrders, delivered, returned, inProgress } = stats;
  const { t } = useLocale();

  return (
    <section className="mb-10 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
      <CountCard label={t("dashboard.totalOrders")} value={totalOrders} tone="zinc" icon={TOTAL_ICON} />
      {/* "Livré"/"Retour"/"Progress" — from the ONE source of truth
          (lib/orders/status-groups.js#STATUS_FILTER_LABELS), never i18n —
          see that constant's own comment. */}
      <CountCard label={STATUS_FILTER_LABELS.delivered} value={delivered} tone="emerald" icon={DELIVERED_ICON} />
      <CountCard label={STATUS_FILTER_LABELS.return} value={returned} tone="red" icon={RETURN_ICON} />
      <CountCard
        label={STATUS_FILTER_LABELS.progress}
        value={Math.max(0, inProgress ?? 0)}
        tone="amber"
        icon={PROGRESS_ICON}
      />

      <div className={`${CARD} sm:col-span-2 lg:col-span-4`}>
        <p className="mb-3 text-sm font-medium text-zinc-500 dark:text-zinc-400">
          {STATUS_FILTER_LABELS.progress}
        </p>
        <DeliveryProgressRing delivered={delivered} returned={returned} />
        <p className="mt-3 text-center text-xs text-zinc-400 dark:text-zinc-500">
          {totalOrders.toLocaleString()} {totalOrders === 1 ? t("dashboard.orderSuffix") : t("dashboard.ordersSuffix")}
        </p>
      </div>
    </section>
  );
}
