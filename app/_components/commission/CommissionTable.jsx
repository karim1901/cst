"use client";

import { useEffect, useState } from "react";

import MonthSelect from "@/app/_components/orders/MonthSelect";
import ProviderTabs from "@/app/_components/orders/ProviderTabs";
import { Spinner, ErrorBanner } from "@/app/_components/orders/shared";
import { useLocale } from "@/app/_components/i18n/LocaleProvider";
import { periodFor } from "@/lib/tracking/counter";
import { SHIPPING_PROVIDERS } from "@/lib/shipping/providers";

/**
 * Monthly employee commission report — fetched from our own backend
 * (`GET /api/commission`), which calculates everything server-side from
 * MongoDB (see lib/commission/report.js). Never calls Ozon/Quick itself.
 *
 * PROVIDER SEPARATION (item 3 — no mixed totals): the ProviderTabs below is
 * the PRIMARY separation mechanism, not a secondary display column —
 * switching it re-fetches an entirely separate, provider-scoped report
 * (`?provider=...`) computed from a provider-filtered order set server-side
 * (see lib/commission/report.js), never a frontend filter of an
 * already-combined dataset. Selecting Ozon Express can never show a
 * Quick-derived unit/threshold/rate/total, and vice versa.
 *
 * Two presentations of the exact same `employees` data/state, toggled by
 * breakpoint (Tailwind's `sm:`, ~640px) rather than two components with
 * their own fetch/state: `EmployeeRows` (a `<table>`, `hidden` below `sm:`)
 * for desktop, `EmployeeCard` (`sm:hidden`) for mobile. One source of
 * truth — this file's own `useState`/`useEffect` above — only the JSX
 * differs; neither reads/derives its numbers independently.
 */

const money = (value) => `${Number(value ?? 0).toLocaleString("en-US")} DH`;

/** Locale-aware short date ("09 Sep 2026" / Arabic equivalent) — the
 * VALUE (`order.deliveredAt`) is a real timestamp; only its rendering is
 * localized. */
function fmtDate(value, locale) {
  return new Intl.DateTimeFormat(locale === "ar" ? "ar" : "en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).format(new Date(value));
}

/** "202608" -> "August 2026" (locale-aware) — display only, shown on each mobile card so the selected month reads on its own without scrolling back up to the picker. */
function periodLabel(period, locale) {
  const year = Number(period.slice(0, 4));
  const monthIndex = Number(period.slice(4, 6)) - 1;
  if (!Number.isFinite(year) || !Number.isFinite(monthIndex)) return period;
  return new Intl.DateTimeFormat(locale === "ar" ? "ar" : "en-US", {
    month: "long",
    year: "numeric",
  }).format(new Date(year, monthIndex, 1));
}

export default function CommissionTable({ isEmployee = false }) {
  const { t } = useLocale();
  const emptyStateMessage = isEmployee ? t("commission.noDataThisMonth") : t("commission.noEmployees");
  const [provider, setProvider] = useState(SHIPPING_PROVIDERS.OZON_EXPRESS);
  const [period, setPeriod] = useState(() => periodFor());
  const [state, setState] = useState("loading"); // loading | ready | error
  const [errorMessage, setErrorMessage] = useState("");
  const [employees, setEmployees] = useState([]);
  const [expandedId, setExpandedId] = useState(null);

  // Reset per-fetch state when the provider or selected month changes —
  // done here, during render (React's recommended "adjust state when a
  // value changes" pattern), rather than as setState calls at the top of
  // the effect below, same fix already applied throughout this app
  // (ReturnsList.jsx, DashboardStats.jsx, ...).
  const fetchKey = `${provider}|${period}`;
  const [renderedForFetchKey, setRenderedForFetchKey] = useState(fetchKey);
  if (fetchKey !== renderedForFetchKey) {
    setRenderedForFetchKey(fetchKey);
    setState("loading");
    setErrorMessage("");
    setExpandedId(null);
  }

  useEffect(() => {
    const controller = new AbortController();

    fetch(`/api/commission?provider=${provider}&period=${encodeURIComponent(period)}`, {
      signal: controller.signal,
    })
      .then(async (res) => {
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          throw new Error(data?.error || "Could not load the commission report.");
        }
        setEmployees(data.employees ?? []);
        setState("ready");
      })
      .catch((error) => {
        if (error?.name === "AbortError") return;
        setErrorMessage(error?.message || "Could not load the commission report.");
        setState("error");
      });

    return () => controller.abort();
  }, [provider, period]);

  return (
    <div>
      <header className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
          {t("commission.title")}
        </h1>
        <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
          {isEmployee ? t("commission.subtitleEmployee") : t("commission.subtitleMerchant")}
        </p>
      </header>

      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
        <ProviderTabs value={provider} onChange={setProvider} />
        <div className="flex items-center gap-3">
          <MonthSelect value={period} onChange={setPeriod} disabled={state === "loading"} />
          {state === "loading" ? (
            <span className="inline-flex items-center gap-2 text-sm text-zinc-500 dark:text-zinc-400">
              <Spinner /> {t("common.loading")}
            </span>
          ) : null}
        </div>
      </div>

      {state === "error" ? <ErrorBanner>{errorMessage}</ErrorBanner> : null}

      {state === "ready" && employees.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-zinc-300 px-6 py-10 text-center text-sm text-zinc-500 dark:border-zinc-700 dark:text-zinc-400">
          {emptyStateMessage}
        </p>
      ) : null}

      {employees.length > 0 ? (
        <>
          {/* Desktop / tablet — the existing table, scrollable inside its
              own container (never the page) for anything narrower than its
              min-width. Hidden (not just visually collapsed) below `sm:` so
              it can never be a source of mobile overflow. */}
          <div
            className="hidden overflow-x-auto rounded-2xl border border-zinc-200 shadow-sm sm:block dark:border-zinc-800"
            style={{ WebkitOverflowScrolling: "touch" }}
          >
            <table className="w-full min-w-160 text-left text-sm">
              <thead className="bg-zinc-50 text-xs uppercase tracking-wide text-zinc-500 dark:bg-zinc-900 dark:text-zinc-400">
                <tr>
                  <th className="sticky left-0 z-1 bg-zinc-50 px-4 py-3 font-medium dark:bg-zinc-900">
                    {t("commission.employee")}
                  </th>
                  <th className="px-4 py-3 font-medium text-right">{t("commission.delivered")}</th>
                  <th className="px-4 py-3 font-medium text-right">{t("commission.units")}</th>
                  <th className="px-4 py-3 font-medium text-right">{t("commission.threshold")}</th>
                  <th className="px-4 py-3 font-medium text-right">{t("commission.rate")}</th>
                  <th className="px-4 py-3 font-medium text-right">{t("commission.total")}</th>
                  <th className="px-4 py-3" />
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-200 bg-white dark:divide-zinc-800 dark:bg-zinc-950">
                {employees.map((employee) => (
                  <EmployeeRows
                    key={employee.employeeId}
                    employee={employee}
                    expanded={expandedId === employee.employeeId}
                    onToggle={() =>
                      setExpandedId((current) =>
                        current === employee.employeeId ? null : employee.employeeId
                      )
                    }
                  />
                ))}
              </tbody>
            </table>
          </div>

          {/* Mobile — dedicated cards, not a shrunk table. Same `employees`
              array, same expand/collapse state as the desktop table above
              (`expandedId`) — tapping "View orders" on one and switching to
              a wide viewport shows it already expanded in the table too. */}
          <div className="space-y-3 sm:hidden">
            {employees.map((employee) => (
              <EmployeeCard
                key={employee.employeeId}
                employee={employee}
                period={period}
                expanded={expandedId === employee.employeeId}
                onToggle={() =>
                  setExpandedId((current) =>
                    current === employee.employeeId ? null : employee.employeeId
                  )
                }
              />
            ))}
          </div>
        </>
      ) : null}
    </div>
  );
}

/** Small "person" glyph for the mobile card header — purely decorative, no icon library. */
function PersonIcon() {
  return (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.75" className="h-4.5 w-4.5">
      <circle cx="10" cy="6.5" r="3" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M3.5 17c.8-3.7 3.2-5.7 6.5-5.7s5.7 2 6.5 5.7" />
    </svg>
  );
}

function StatRow({ label, value, emphasized }) {
  return (
    <div className="flex items-center justify-between py-2">
      <span className={`text-sm ${emphasized ? "font-medium text-zinc-900 dark:text-zinc-100" : "text-zinc-500 dark:text-zinc-400"}`}>
        {label}
      </span>
      <span
        className={`tabular-nums ${
          emphasized
            ? "text-lg font-semibold text-zinc-900 dark:text-zinc-50"
            : "text-sm font-medium text-zinc-700 dark:text-zinc-300"
        }`}
      >
        {value}
      </span>
    </div>
  );
}

function EmployeeCard({ employee, period, expanded, onToggle }) {
  const { t, locale } = useLocale();
  return (
    <div className="overflow-hidden rounded-2xl border border-zinc-200 bg-white shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
      <div className="flex items-start justify-between gap-3 p-4">
        <div className="flex min-w-0 items-start gap-2.5">
          <span className="mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-full bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400">
            <PersonIcon />
          </span>
          <div className="min-w-0">
            {/* Real employee name / username — never translated. */}
            <p className="truncate text-sm font-semibold text-zinc-900 dark:text-zinc-50">
              {employee.employeeName}
            </p>
            <p className="truncate text-xs text-zinc-400">@{employee.username}</p>
          </div>
        </div>
        <span className="shrink-0 rounded-full bg-zinc-100 px-2.5 py-1 text-xs font-medium text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400">
          {periodLabel(period, locale)}
        </span>
      </div>

      {!employee.configured ? (
        <p className="border-t border-zinc-100 px-4 py-4 text-sm text-zinc-400 dark:border-zinc-800">
          {t("commission.notConfigured")}
        </p>
      ) : (
        <>
          <div className="divide-y divide-zinc-100 border-t border-zinc-100 px-4 dark:divide-zinc-800/80 dark:border-zinc-800">
            <StatRow label={t("commission.delivered")} value={employee.deliveredOrders} />
            <StatRow label={t("commission.units")} value={employee.commissionUnits} />
            <StatRow label={t("commission.threshold")} value={employee.threshold} />
            <StatRow label={t("commission.rate")} value={money(employee.commissionRate)} />
            <StatRow label={t("commission.total")} value={money(employee.totalCommission)} emphasized />
          </div>

          {employee.unknownPriceOrders > 0 ? (
            <p className="border-t border-amber-200 bg-amber-50 px-4 py-2 text-xs text-amber-700 dark:border-amber-900/50 dark:bg-amber-950/40 dark:text-amber-300">
              {employee.unknownPriceOrders} {t("commission.unknownPriceNote")}
            </p>
          ) : null}

          <button
            type="button"
            onClick={onToggle}
            aria-expanded={expanded}
            className="flex w-full items-center justify-center gap-1.5 border-t border-zinc-100 py-3 text-sm font-medium text-zinc-700 transition active:bg-zinc-50 dark:border-zinc-800 dark:text-zinc-300 dark:active:bg-zinc-800"
          >
            {expanded ? t("commission.hideOrders") : t("commission.viewOrders")}
            <span aria-hidden="true" className={`transition-transform ${expanded ? "rotate-180" : ""}`}>
              ▾
            </span>
          </button>

          {expanded ? (
            <div className="border-t border-zinc-100 bg-zinc-50 p-3 dark:border-zinc-800 dark:bg-zinc-900/60">
              {employee.orders.length === 0 ? (
                <p className="px-1 py-2 text-sm text-zinc-500 dark:text-zinc-400">
                  {t("commission.noDeliveredThisMonth")}
                </p>
              ) : (
                <div className="space-y-2">
                  {employee.orders.map((order) => (
                    <MobileOrderRow key={order.id} order={order} />
                  ))}
                </div>
              )}
            </div>
          ) : null}
        </>
      )}
    </div>
  );
}

function MobileOrderRow({ order }) {
  const { t, locale } = useLocale();
  return (
    <div className="rounded-xl border border-zinc-200 bg-white p-3 dark:border-zinc-800 dark:bg-zinc-950">
      <div className="mb-1.5 flex items-center justify-between gap-2">
        {/* Real tracking number — never translated. */}
        <span className="min-w-0 truncate font-mono text-xs text-zinc-700 dark:text-zinc-300">
          {order.trackingNumber}
        </span>
      </div>
      <div className="flex items-center justify-between text-xs text-zinc-500 dark:text-zinc-400">
        <span>{fmtDate(order.deliveredAt, locale)}</span>
        <span className="tabular-nums text-zinc-700 dark:text-zinc-300">
          {order.priceUsable === false ? "—" : money(order.price)}
        </span>
        <span className="tabular-nums font-semibold text-zinc-900 dark:text-zinc-50">
          {order.commissionUnits}{" "}
          {order.commissionUnits === 1 ? t("commission.unitSuffix") : t("commission.unitsSuffix")}
        </span>
      </div>
    </div>
  );
}

function EmployeeRows({ employee, expanded, onToggle }) {
  const { t, locale } = useLocale();
  if (!employee.configured) {
    return (
      <tr>
        <td className="sticky left-0 z-1 bg-white px-4 py-3 font-medium text-zinc-900 dark:bg-zinc-950 dark:text-zinc-50">
          {employee.employeeName}
          <span className="ml-2 text-xs font-normal text-zinc-400">@{employee.username}</span>
        </td>
        <td colSpan={6} className="px-4 py-3 text-right text-xs text-zinc-400">
          {t("commission.notConfigured")}
        </td>
      </tr>
    );
  }

  return (
    <>
      <tr
        className="cursor-pointer transition hover:bg-zinc-50 dark:hover:bg-zinc-900"
        onClick={onToggle}
      >
        <td className="sticky left-0 z-1 bg-white px-4 py-3 font-medium text-zinc-900 dark:bg-zinc-950 dark:text-zinc-50">
          {employee.employeeName}
          <span className="ml-2 text-xs font-normal text-zinc-400">@{employee.username}</span>
        </td>
        <td className="px-4 py-3 text-right tabular-nums text-zinc-700 dark:text-zinc-300">
          {employee.deliveredOrders}
        </td>
        <td className="px-4 py-3 text-right tabular-nums text-zinc-700 dark:text-zinc-300">
          {employee.commissionUnits}
        </td>
        <td className="px-4 py-3 text-right tabular-nums text-zinc-500 dark:text-zinc-400">
          {employee.threshold}
        </td>
        <td className="px-4 py-3 text-right tabular-nums text-zinc-700 dark:text-zinc-300">
          {money(employee.commissionRate)}
        </td>
        <td className="px-4 py-3 text-right font-semibold tabular-nums text-zinc-900 dark:text-zinc-50">
          {money(employee.totalCommission)}
        </td>
        <td className="px-4 py-3 text-right text-zinc-400">{expanded ? "▲" : "▼"}</td>
      </tr>
      {expanded ? (
        <tr>
          <td colSpan={7} className="bg-zinc-50 px-4 py-3 dark:bg-zinc-900/60">
            {employee.unknownPriceOrders > 0 ? (
              <p className="mb-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-700 dark:border-amber-900/50 dark:bg-amber-950/40 dark:text-amber-300">
                {employee.unknownPriceOrders} {t("commission.unknownPriceNote")}
              </p>
            ) : null}
            {employee.orders.length === 0 ? (
              <p className="text-sm text-zinc-500 dark:text-zinc-400">
                {t("commission.noDeliveredThisMonth")}
              </p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-120 text-left text-xs">
                  <thead className="text-zinc-500 dark:text-zinc-400">
                    <tr>
                      <th className="py-1.5 pr-3 font-medium">{t("commission.tracking")}</th>
                      <th className="py-1.5 pr-3 font-medium">{t("commission.delivered")}</th>
                      <th className="py-1.5 pr-3 font-medium text-right">{t("commission.price")}</th>
                      <th className="py-1.5 pr-3 font-medium text-right">{t("commission.units")}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-zinc-200 dark:divide-zinc-800">
                    {employee.orders.map((order) => (
                      <tr key={order.id}>
                        <td className="py-1.5 pr-3 font-mono text-zinc-700 dark:text-zinc-300">
                          {order.trackingNumber}
                        </td>
                        <td className="py-1.5 pr-3 text-zinc-500 dark:text-zinc-400">
                          {fmtDate(order.deliveredAt, locale)}
                        </td>
                        <td className="py-1.5 pr-3 text-right tabular-nums text-zinc-700 dark:text-zinc-300">
                          {order.priceUsable === false ? "—" : money(order.price)}
                        </td>
                        <td className="py-1.5 pr-3 text-right tabular-nums font-semibold text-zinc-900 dark:text-zinc-50">
                          {order.commissionUnits}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </td>
        </tr>
      ) : null}
    </>
  );
}
