import DeliveryProgressRing from "@/app/_components/dashboard/DeliveryProgressRing";

const CARD =
  "rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm dark:border-zinc-800 dark:bg-zinc-900";

function CountCard({ label, value, tone, icon }) {
  const toneClasses = {
    emerald: "bg-emerald-50 text-emerald-600 dark:bg-emerald-950/50 dark:text-emerald-400",
    red: "bg-red-50 text-red-600 dark:bg-red-950/50 dark:text-red-400",
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

/**
 * The dashboard's "order performance" section — Livré / Retour counts plus
 * the delivered-vs-returned ring. `stats` is
 * lib/orders/dashboard-stats.js#computeOrderDeliveryStats's return value;
 * always real data read by the page, never hardcoded here.
 */
export default function StatsCards({ stats }) {
  const { delivered, returned, totalOrders } = stats;

  return (
    <section className="mb-10 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
      <CountCard label="Livré" value={delivered} tone="emerald" icon={DELIVERED_ICON} />
      <CountCard label="Retour" value={returned} tone="red" icon={RETURN_ICON} />

      <div className={`${CARD} sm:col-span-2 lg:col-span-1`}>
        <p className="mb-3 text-sm font-medium text-zinc-500 dark:text-zinc-400">Progress</p>
        <DeliveryProgressRing delivered={delivered} returned={returned} />
        <p className="mt-3 text-center text-xs text-zinc-400 dark:text-zinc-500">
          {totalOrders.toLocaleString()} total order{totalOrders === 1 ? "" : "s"}
        </p>
      </div>
    </section>
  );
}
