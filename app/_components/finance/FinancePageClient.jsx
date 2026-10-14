"use client";

import { useEffect, useState } from "react";

import ProviderTabs from "@/app/_components/orders/ProviderTabs";
import MonthSelect from "@/app/_components/orders/MonthSelect";
import { Spinner, ErrorBanner } from "@/app/_components/orders/shared";
import { useBackgroundProviderSync } from "@/app/_components/shared/useBackgroundProviderSync";
import { usePeriodSync } from "@/app/_components/shared/usePeriodSync";
import { useLocale } from "@/app/_components/i18n/LocaleProvider";
import { SHIPPING_PROVIDERS } from "@/lib/shipping/providers";
import { periodFor } from "@/lib/tracking/counter";

import MonthlyOverview from "@/app/_components/finance/MonthlyOverview";
import DailyBreakdown from "@/app/_components/finance/DailyBreakdown";
import AdvertisingManager from "@/app/_components/finance/AdvertisingManager";
import OtherExpensesManager from "@/app/_components/finance/OtherExpensesManager";
import ProductCostsManager from "@/app/_components/finance/ProductCostsManager";
import ShippingPricingManager from "@/app/_components/finance/ShippingPricingManager";

const TABS = ["overview", "daily", "advertising", "productCosts", "otherExpenses", "shippingPricing"];

const TAB_LABEL_KEY = {
  overview: "finance.monthly",
  daily: "finance.daily",
  advertising: "finance.advertising",
  productCosts: "finance.productCosts",
  otherExpenses: "finance.otherExpenses",
  shippingPricing: "finance.shippingCosts",
};

/**
 * "Advertising & Profit" — one page, tabbed: a read-only Monthly/Daily
 * financial report (both computed by the SAME server call — see
 * lib/finance/calculate.js's own comment on why the two always reconcile)
 * plus 4 management tabs for the raw inputs that report is built from
 * (daily ad spend, product costs, other expenses, shipping prices).
 * Provider + month are the ONE shared selection every tab respects — never
 * a per-tab independent filter (item 16).
 */
export default function FinancePageClient() {
  const { t } = useLocale();
  // Same root-cause fix as Dashboard/Commission — Finance is computed
  // entirely from the local order mirror (lib/finance/calculate.js). This
  // page is already merchant-only (enforced server-side in
  // app/dashboard/finance/page.jsx), so the trigger always fires here — see
  // app/_components/shared/useBackgroundProviderSync.js's own comment.
  useBackgroundProviderSync(true);
  const [provider, setProvider] = useState(SHIPPING_PROVIDERS.OZON_EXPRESS);
  const [period, setPeriod] = useState(() => periodFor());
  const [tab, setTab] = useState("overview");

  const [state, setState] = useState("loading"); // loading | ready | error
  const [stats, setStats] = useState(null);
  const [errorMessage, setErrorMessage] = useState("");

  // ROOT-CAUSE FIX ("stuck on Loading… after data is already displayed"):
  // `refetch()` used to reset `renderedForFetchKey` to force a refetch, but
  // the fetch effect below only ever depended on `[provider, period]` — a
  // same-scope refetch (triggered by a background sync finding a real
  // change, or by saving an ad-spend/product-cost/other-expense/shipping-
  // price entry elsewhere on this page) flipped `state` to "loading" via the
  // block below, yet NEVER re-ran the effect that could flip it back to
  // "ready", since neither `provider` nor `period` had actually changed.
  // The indicator was then stuck forever even though `stats` still held
  // perfectly good data.
  //
  // Fixed by separating the two concerns `renderedForFetchKey` was
  // conflating: `fetchKey` (below) detects a genuine SCOPE change
  // (provider/month) — the only case that should show the full loading
  // view, since there is genuinely no usable data yet for a brand-new
  // scope — while `refreshToken` is what the fetch effect ACTUALLY depends
  // on to know when to run again, for either reason.
  const fetchKey = `${provider}|${period}`;
  const [renderedForFetchKey, setRenderedForFetchKey] = useState(fetchKey);
  const isScopeChange = fetchKey !== renderedForFetchKey;
  if (isScopeChange) {
    setRenderedForFetchKey(fetchKey);
    setState("loading");
  }

  const [refreshToken, setRefreshToken] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    fetch(`/api/finance/stats?provider=${provider}&period=${period}`, { signal: controller.signal })
      .then(async (res) => {
        const body = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(body?.error || "Could not load financial statistics.");
        return body;
      })
      .then((body) => {
        setStats(body);
        setState("ready");
      })
      .catch((error) => {
        if (error?.name === "AbortError") return;
        // A background refresh failing must never blow away already-good
        // data or get the user stuck — only show the error view when there
        // is genuinely no usable data yet (item 3: "retain the last valid
        // financial data" / "a failed statistics refresh does not cause an
        // infinite loading state").
        setErrorMessage(error?.message || "Could not load financial statistics.");
        setState((prev) => (prev === "ready" ? prev : "error"));
      });
    return () => controller.abort();
  }, [provider, period, refreshToken]);

  // Triggers a refetch of the SAME scope without ever showing the full
  // loading view — already-rendered figures stay on screen the whole time,
  // matching every other "onChanged" caller on this page (saving an
  // expense, a background sync finding a real change) and item 2's own
  // "do not activate the primary loading state just because synchronization
  // is running" requirement.
  function refetch() {
    setRefreshToken((n) => n + 1);
  }

  // Root-cause fix (see lib/sync/period-sync.js's own comment): the
  // background trigger above only ever covers the CURRENT month, once per
  // page mount — it never follows the merchant to whichever historical
  // month they actually select here, and never re-checks again while the
  // page stays open with nothing changed. `usePeriodSync`
  // (app/_components/shared/usePeriodSync.js, shared with
  // OrdersBrowser.jsx) targets the EXACT selected (provider, period)
  // instead, with no month-age limit, and keeps re-checking it for as long
  // as this exact selection stays active and the tab is visible — not just
  // once on mount/change.
  const { checking: checkingUpdates } = usePeriodSync({ provider, period, onChanged: refetch });

  return (
    <div>
      <header className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
          {t("finance.title")}
        </h1>
        {checkingUpdates ? (
          <p className="mt-1 flex items-center gap-1.5 text-xs text-zinc-400 dark:text-zinc-500">
            <Spinner />
            {t("finance.checkingForUpdates")}
          </p>
        ) : null}
      </header>

      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
        <ProviderTabs value={provider} onChange={setProvider} />
        <div className="flex flex-col gap-1">
          <span className="text-xs font-medium text-zinc-500 dark:text-zinc-400">{t("common.month")}</span>
          <MonthSelect value={period} onChange={setPeriod} />
        </div>
      </div>

      <div
        role="tablist"
        aria-label={t("finance.sectionAria")}
        className="mb-4 inline-flex flex-wrap gap-1 rounded-xl border border-zinc-200 bg-zinc-100 p-1 dark:border-zinc-800 dark:bg-zinc-900"
      >
        {TABS.map((id) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={tab === id}
            onClick={() => setTab(id)}
            className={`rounded-lg px-3 py-1.5 text-xs font-medium transition sm:text-sm ${
              tab === id
                ? "bg-white text-zinc-900 shadow-sm dark:bg-zinc-950 dark:text-zinc-50"
                : "text-zinc-500 hover:text-zinc-700 dark:text-zinc-400 dark:hover:text-zinc-200"
            }`}
          >
            {t(TAB_LABEL_KEY[id])}
          </button>
        ))}
      </div>

      {tab === "overview" || tab === "daily" ? (
        state === "loading" ? (
          <div className="flex items-center justify-center gap-2 rounded-2xl border border-dashed border-zinc-300 px-6 py-14 text-sm text-zinc-500 dark:border-zinc-700 dark:text-zinc-400">
            <Spinner />
            {t("common.loading")}
          </div>
        ) : state === "error" ? (
          <ErrorBanner>{errorMessage}</ErrorBanner>
        ) : tab === "overview" ? (
          <MonthlyOverview stats={stats} />
        ) : (
          <DailyBreakdown stats={stats} />
        )
      ) : tab === "advertising" ? (
        <AdvertisingManager provider={provider} period={period} onChanged={refetch} />
      ) : tab === "productCosts" ? (
        <ProductCostsManager onChanged={refetch} />
      ) : tab === "otherExpenses" ? (
        <OtherExpensesManager period={period} onChanged={refetch} />
      ) : (
        <ShippingPricingManager provider={provider} onChanged={refetch} />
      )}
    </div>
  );
}
