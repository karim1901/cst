"use client";

import { useEffect, useState } from "react";

import ProviderTabs from "@/app/_components/orders/ProviderTabs";
import MonthSelect from "@/app/_components/orders/MonthSelect";
import StatsCards from "@/app/_components/dashboard/StatsCards";
import { Spinner, ErrorBanner } from "@/app/_components/orders/shared";
import { useLocale } from "@/app/_components/i18n/LocaleProvider";
import { SHIPPING_PROVIDERS } from "@/lib/shipping/providers";

/**
 * Dashboard's provider+month-scoped statistics — see
 * app/api/dashboard/stats/route.js (server-enforced provider/month
 * filtering, never a frontend-only filter — item 11/27's explicit
 * requirement) and lib/orders/dashboard-stats.js for the counting rules.
 *
 * Ozon Express and Quick Livraison are NEVER combined into one number
 * (item 3's explicit requirement) — switching the provider tab re-fetches
 * an entirely separate, provider-scoped query; it never filters an
 * already-fetched combined dataset in the browser.
 */
export default function DashboardStats() {
  const { t } = useLocale();
  const [provider, setProvider] = useState(SHIPPING_PROVIDERS.OZON_EXPRESS);
  const [period, setPeriod] = useState(""); // "" = all time
  const [state, setState] = useState("loading"); // loading | ready | error
  const [stats, setStats] = useState(null);
  const [errorMessage, setErrorMessage] = useState("");

  // Reset to "loading" when provider/period changes — adjusted during
  // render (React's recommended pattern), not a synchronous setState at
  // the top of the effect below, same fix already applied throughout this
  // app (ReturnsList.jsx, OzonOrdersList.jsx, CommissionTable.jsx, ...).
  const fetchKey = `${provider}|${period}`;
  const [renderedForFetchKey, setRenderedForFetchKey] = useState(fetchKey);
  if (fetchKey !== renderedForFetchKey) {
    setRenderedForFetchKey(fetchKey);
    setState("loading");
  }

  useEffect(() => {
    const controller = new AbortController();
    const params = new URLSearchParams({ provider });
    if (period) params.set("period", period);
    fetch(`/api/dashboard/stats?${params.toString()}`, { signal: controller.signal })
      .then(async (res) => {
        const body = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(body?.error || "Could not load statistics.");
        return body;
      })
      .then((body) => {
        setStats(body.stats);
        setState("ready");
      })
      .catch((error) => {
        if (error?.name === "AbortError") return;
        setErrorMessage(error?.message || "Could not load statistics.");
        setState("error");
      });
    return () => controller.abort();
  }, [provider, period]);

  return (
    <div>
      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
        <ProviderTabs value={provider} onChange={setProvider} />
        <div className="flex flex-col gap-1">
          <span className="text-xs font-medium text-zinc-500 dark:text-zinc-400">{t("common.month")}</span>
          <MonthSelect value={period} onChange={setPeriod} allowAll />
        </div>
      </div>

      {state === "loading" && !stats ? (
        <div className="mb-10 flex items-center justify-center gap-2 rounded-2xl border border-dashed border-zinc-300 px-6 py-14 text-sm text-zinc-500 dark:border-zinc-700 dark:text-zinc-400">
          <Spinner />
          {t("common.loading")}
        </div>
      ) : state === "error" ? (
        <div className="mb-10">
          <ErrorBanner>{errorMessage}</ErrorBanner>
        </div>
      ) : stats ? (
        <StatsCards stats={stats} />
      ) : null}
    </div>
  );
}
