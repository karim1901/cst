"use client";

import { useState } from "react";

import { useLocale } from "@/app/_components/i18n/LocaleProvider";

function money(value) {
  return value == null ? "—" : `${value.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} DH`;
}

/**
 * Day-by-day cards (mobile-first — no desktop table, item 15/27) for the
 * selected provider+month. Every number here is one row of the SAME
 * `days` array the Monthly totals are summed from (see
 * lib/finance/calculate.js) — the two views can never disagree.
 */
export default function DailyBreakdown({ stats }) {
  const { t } = useLocale();
  const [expanded, setExpanded] = useState(null);
  if (!stats) return null;

  // Only real days that actually had activity (orders or spend) are shown
  // by default — a month has ~30 empty rows otherwise, which is noise, not
  // useful data. Still fully accurate: an omitted day genuinely had zero
  // orders/revenue/costs (see lib/finance/calculate.js, which builds every
  // calendar day upfront so none are silently skipped in the underlying
  // calculation itself).
  const activeDays = stats.days.filter(
    (day) => day.orders > 0 || day.adSpend > 0 || day.otherExpense > 0
  );

  if (activeDays.length === 0) {
    return (
      <p className="rounded-2xl border border-dashed border-zinc-300 px-6 py-14 text-center text-sm text-zinc-500 dark:border-zinc-700 dark:text-zinc-400">
        {t("dashboard.noData")}
      </p>
    );
  }

  return (
    <div className="space-y-3">
      {activeDays.map((day) => {
        const isOpen = expanded === day.date;
        return (
          <div
            key={day.date}
            className="overflow-hidden rounded-2xl border border-zinc-200 bg-white shadow-sm dark:border-zinc-800 dark:bg-zinc-900"
          >
            <button
              type="button"
              onClick={() => setExpanded(isOpen ? null : day.date)}
              className="flex w-full items-center justify-between gap-3 p-4 text-left"
            >
              <div>
                <p className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">{day.date}</p>
                <p className="mt-0.5 text-xs text-zinc-500 dark:text-zinc-400">
                  {t("common.orders")}: {day.orders} · Livré: {day.delivered} · Retour: {day.returned} ·
                  Progress: {day.progress}
                </p>
              </div>
              <div className="text-right">
                <p
                  className={`text-sm font-semibold ${
                    day.profit >= 0 ? "text-emerald-600 dark:text-emerald-400" : "text-red-600 dark:text-red-400"
                  }`}
                >
                  {money(day.profit)}
                </p>
                <p className="text-xs text-zinc-400">{t("finance.profit")}</p>
              </div>
            </button>

            {isOpen ? (
              <div className="border-t border-zinc-100 bg-zinc-50 p-4 text-sm dark:border-zinc-800 dark:bg-zinc-900/60">
                <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 sm:grid-cols-3">
                  <Row label={t("finance.revenue")} value={money(day.revenue)} />
                  <Row label={t("finance.returnValue")} value={money(day.returnValue)} />
                  <Row label={t("finance.adSpend")} value={money(day.adSpend)} />
                  <Row label={t("finance.productCosts")} value={money(day.productCost)} />
                  <Row label={t("finance.shippingCosts")} value={money(day.shippingCost)} />
                  <Row label={t("finance.totalCosts")} value={money(day.totalCost)} />
                </div>
                {!day.profitComplete ? (
                  <p className="mt-2 text-xs text-amber-700 dark:text-amber-400">
                    {t("finance.costNotConfigured")}
                  </p>
                ) : null}
                {day.orderDateMissing > 0 ? (
                  <p className="mt-2 text-xs text-amber-700 dark:text-amber-400">
                    {day.orderDateMissing} {t("finance.ordersApproxDate")}
                  </p>
                ) : null}
                {day.returnValueUnknownPriceOrders > 0 ? (
                  <p className="mt-2 text-xs text-amber-700 dark:text-amber-400">
                    {day.returnValueUnknownPriceOrders} {t("finance.returnValueUnknownNote")}
                  </p>
                ) : null}

                {day.orderRows?.length > 0 ? (
                  <div className="mt-3 space-y-2">
                    {day.orderRows.map((order) => (
                      <div
                        key={order.id}
                        className="rounded-xl border border-zinc-200 bg-white p-2.5 text-xs dark:border-zinc-800 dark:bg-zinc-950"
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="min-w-0 truncate font-mono text-zinc-700 dark:text-zinc-300">
                            {order.trackingNumber}
                          </span>
                          <span className="shrink-0 text-zinc-500 dark:text-zinc-400">{order.status}</span>
                        </div>
                        <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-zinc-500 dark:text-zinc-400">
                          <span>
                            {order.productNature} × {order.quantity}
                          </span>
                          <span>{money(order.price)}</span>
                          <span>
                            {t("finance.productCosts")}:{" "}
                            {order.productCost == null ? t("finance.costNotConfigured") : money(order.productCost)}
                          </span>
                          <span>
                            {t("finance.shippingCosts")}:{" "}
                            {order.shippingCost == null ? t("finance.costNotConfigured") : money(order.shippingCost)}
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : null}
              </div>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}

function Row({ label, value }) {
  return (
    <div>
      <p className="text-xs text-zinc-500 dark:text-zinc-400">{label}</p>
      <p className="font-medium text-zinc-900 dark:text-zinc-100">{value}</p>
    </div>
  );
}
