"use client";

import { useLocale } from "@/app/_components/i18n/LocaleProvider";

const CARD =
  "rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm dark:border-zinc-800 dark:bg-zinc-900";

function money(value) {
  return value == null ? "—" : `${value.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} DH`;
}

function percent(value) {
  return value == null ? "—" : `${Math.round(value * 1000) / 10}%`;
}

function StatCard({ label, value, tone }) {
  const toneClasses = {
    zinc: "text-zinc-900 dark:text-zinc-50",
    emerald: "text-emerald-600 dark:text-emerald-400",
    red: "text-red-600 dark:text-red-400",
    amber: "text-amber-600 dark:text-amber-400",
  }[tone ?? "zinc"];

  return (
    <div className={CARD}>
      <p className="text-sm font-medium text-zinc-500 dark:text-zinc-400">{label}</p>
      <p className={`mt-1 text-xl font-semibold tracking-tight ${toneClasses}`}>{value}</p>
    </div>
  );
}

/**
 * The Monthly view — one provider, one month, computed entirely by
 * GET /api/finance/stats -> lib/finance/calculate.js#calculateMonthlyFinancials
 * (this component itself does zero calculation, only display — item 20).
 */
export default function MonthlyOverview({ stats }) {
  const { t } = useLocale();
  if (!stats) return null;
  const { totals, ratios } = stats;

  return (
    <div>
      {!totals.profitComplete ? (
        <div className="mb-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800 dark:border-amber-900/50 dark:bg-amber-950/30 dark:text-amber-300">
          {totals.productCostMissing > 0
            ? `${totals.productCostMissing} ${t("finance.ordersUnconfiguredProduct")}`
            : null}
          {totals.productCostMissing > 0 && totals.shippingCostMissing > 0 ? " " : null}
          {totals.shippingCostMissing > 0
            ? `${totals.shippingCostMissing} ${t("finance.ordersNoShippingPrice")}`
            : null}
          {" "}
          {t("finance.costNotConfigured")} {t("finance.profitUnderstated")}
        </div>
      ) : null}

      {totals.orderDateMissing > 0 ? (
        <div className="mb-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800 dark:border-amber-900/50 dark:bg-amber-950/30 dark:text-amber-300">
          {totals.orderDateMissing} {t("finance.ordersApproxDate")}
        </div>
      ) : null}

      {totals.returnValueUnknownPriceOrders > 0 ? (
        <div className="mb-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800 dark:border-amber-900/50 dark:bg-amber-950/30 dark:text-amber-300">
          {totals.returnValueUnknownPriceOrders} {t("finance.returnValueUnknownNote")}
        </div>
      ) : null}

      {totals.validatedReturnValueUnknownPriceOrders > 0 ? (
        <div className="mb-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800 dark:border-amber-900/50 dark:bg-amber-950/30 dark:text-amber-300">
          {totals.validatedReturnValueUnknownPriceOrders} {t("finance.validatedReturnValueUnknownNote")}
        </div>
      ) : null}

      <section className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatCard label={t("common.orders")} value={totals.orders} />
        {/* "Livré"/"Retour"/"Progress" — this app's own established status
            vocabulary, deliberately NEVER translated (see
            lib/i18n/dictionaries/*.js's own comment). */}
        <StatCard label="Livré" value={totals.delivered} tone="emerald" />
        <StatCard label="Retour" value={totals.returned} tone="red" />
        <StatCard label="Progress" value={totals.progress} tone="amber" />
      </section>

      <section className="mb-6 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <StatCard label={t("finance.revenue")} value={money(totals.revenue)} tone="emerald" />
        {/* Return Value / Validated Return Value — the two halves of
            return-category orders' monetary value, split by the merchant's
            own physical-validation state. Both additive reporting metrics;
            NEITHER is part of the cost/profit math. */}
        <StatCard label={t("finance.returnValue")} value={money(totals.returnValue)} tone="red" />
        <StatCard label={t("finance.validatedReturnValue")} value={money(totals.validatedReturnValue)} tone="amber" />
        <StatCard label={t("finance.adSpend")} value={money(totals.adSpend)} />
        <StatCard label={t("finance.productCosts")} value={money(totals.productCost)} />
        <StatCard label={t("finance.shippingCosts")} value={money(totals.shippingCost)} />
        {/* Employee Commission — sourced from the same authoritative
            Commission-page calculation (lib/commission/report.js), included
            once in Total Costs below; see lib/finance/calculate.js's own
            comment. Month-level figure only (see that module's comment for
            why it has no daily breakdown). */}
        <StatCard label={t("finance.employeeCommission")} value={money(totals.employeeCommission)} />
        <StatCard label={t("finance.otherExpenses")} value={money(totals.otherExpense)} />
        <StatCard label={t("finance.totalCosts")} value={money(totals.totalCost)} tone="red" />
      </section>

      {/* Two INDEPENDENT profit cards, side by side — the existing,
          unchanged Net Profit (charges product/shipping cost across every
          order this month, delivered or not) and the new Delivered-Only
          Net Profit (same revenue, same ad-spend/other-expense allocation,
          but product/shipping cost restricted to Delivered orders only —
          see lib/finance/calculate.js's module comment). Neither replaces
          the other; they may legitimately disagree. */}
      <section className="mb-6 grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className={CARD}>
          <p className="text-sm font-medium text-zinc-500 dark:text-zinc-400">{t("finance.netProfit")}</p>
          <p
            className={`mt-1 text-3xl font-bold tracking-tight ${
              totals.profit >= 0 ? "text-emerald-600 dark:text-emerald-400" : "text-red-600 dark:text-red-400"
            }`}
          >
            {money(totals.profit)}
          </p>
        </div>
        <div className={CARD}>
          <p className="text-sm font-medium text-zinc-500 dark:text-zinc-400">{t("finance.netProfitDeliveredOnly")}</p>
          <p
            className={`mt-1 text-3xl font-bold tracking-tight ${
              totals.deliveredOnlyProfit >= 0 ? "text-emerald-600 dark:text-emerald-400" : "text-red-600 dark:text-red-400"
            }`}
          >
            {money(totals.deliveredOnlyProfit)}
          </p>
          {!totals.deliveredOnlyProfitComplete ? (
            <p className="mt-2 text-xs text-amber-700 dark:text-amber-400">{t("finance.costNotConfigured")}</p>
          ) : null}
        </div>
      </section>

      <section className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <StatCard label={t("finance.adCostPerOrder")} value={money(ratios.adCostPerOrder)} />
        <StatCard label={t("finance.adCostPerDelivered")} value={money(ratios.adCostPerDelivered)} />
        <StatCard label={t("finance.profitPerDelivered")} value={money(ratios.profitPerDelivered)} />
        <StatCard label={t("finance.deliveredOnlyProfitPerDelivered")} value={money(ratios.deliveredOnlyProfitPerDelivered)} />
        <StatCard label={t("finance.averageOrderValue")} value={money(ratios.averageOrderValue)} />
        <StatCard label={t("finance.deliveryRate")} value={percent(ratios.deliveryRate)} tone="emerald" />
        <StatCard label={t("finance.returnRate")} value={percent(ratios.returnRate)} tone="red" />
      </section>
    </div>
  );
}
