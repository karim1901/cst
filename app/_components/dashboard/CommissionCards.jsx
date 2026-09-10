"use client";

import { useEffect, useState } from "react";

import { Spinner, ErrorBanner } from "@/app/_components/orders/shared";
import { useLocale } from "@/app/_components/i18n/LocaleProvider";
import { SHIPPING_PROVIDERS } from "@/lib/shipping/providers";

// Same money format the Commission page uses
// (app/_components/commission/CommissionTable.jsx) so the two never render
// an amount differently.
const money = (value) => `${Number(value ?? 0).toLocaleString("en-US")} DH`;

const CARD =
  "rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm dark:border-zinc-800 dark:bg-zinc-900";

function CommissionCard({ label, value, emphasis }) {
  return (
    <div
      className={`${CARD} ${
        emphasis ? "bg-zinc-900 text-white dark:bg-white dark:text-zinc-900" : ""
      }`}
    >
      <p
        className={`text-sm font-medium ${
          emphasis ? "text-zinc-300 dark:text-zinc-600" : "text-zinc-500 dark:text-zinc-400"
        }`}
      >
        {label}
      </p>
      <p
        className={`mt-1 text-2xl font-semibold tracking-tight ${
          emphasis ? "text-white dark:text-zinc-900" : "text-zinc-900 dark:text-zinc-50"
        }`}
      >
        {money(value)}
      </p>
    </div>
  );
}

/**
 * The Dashboard's "Total Commission" section — the signed-in employee's
 * commission for the selected month, split by shipping provider and summed.
 *
 * Reads app/api/dashboard/commission, which is a pure consumer of the
 * existing commission service (lib/commission/report.js) — the exact same
 * calculation, rules and provider separation as the Commission page. This
 * is NOT an "income" figure; it is the employee's commission.
 *
 * Always shows BOTH providers, regardless of the ProviderTabs selection in
 * the statistics section above (item 12). `period` is the only input; the
 * section re-fetches when the month changes. Compact cards, no table —
 * fits a phone screen with no horizontal scroll (item 21).
 */
export default function CommissionCards({ period }) {
  const { t } = useLocale();
  const [state, setState] = useState("loading"); // loading | ready | error
  const [data, setData] = useState(null);
  const [errorMessage, setErrorMessage] = useState("");

  const [renderedForPeriod, setRenderedForPeriod] = useState(period);
  if (period !== renderedForPeriod) {
    setRenderedForPeriod(period);
    setState("loading");
  }

  useEffect(() => {
    const controller = new AbortController();
    const qs = period ? `?period=${encodeURIComponent(period)}` : "";
    fetch(`/api/dashboard/commission${qs}`, { signal: controller.signal })
      .then(async (res) => {
        const body = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(body?.error || t("common.error"));
        return body;
      })
      .then((body) => {
        setData(body);
        setState("ready");
      })
      .catch((error) => {
        if (error?.name === "AbortError") return;
        setErrorMessage(error?.message || t("common.error"));
        setState("error");
      });
    return () => controller.abort();
  }, [period, t]);

  return (
    <section className="mb-10">
      <h2 className="mb-3 text-sm font-semibold text-zinc-900 dark:text-zinc-50">
        {t("dashboard.totalCommission")}
      </h2>

      {state === "loading" && !data ? (
        <div className="flex items-center justify-center gap-2 rounded-2xl border border-dashed border-zinc-300 px-6 py-10 text-sm text-zinc-500 dark:border-zinc-700 dark:text-zinc-400">
          <Spinner />
          {t("common.loading")}
        </div>
      ) : state === "error" ? (
        <ErrorBanner>{errorMessage}</ErrorBanner>
      ) : data ? (
        <>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            {/* Provider names verbatim — never translated. */}
            <CommissionCard
              label={t(`providers.${SHIPPING_PROVIDERS.OZON_EXPRESS}`)}
              value={data.ozon.commission}
            />
            <CommissionCard
              label={t(`providers.${SHIPPING_PROVIDERS.QUICK_LIVRAISON}`)}
              value={data.quick.commission}
            />
            <CommissionCard label={t("common.total")} value={data.total} emphasis />
          </div>
          {data.unknownPriceOrders > 0 ? (
            <p className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-700 dark:border-amber-900/50 dark:bg-amber-950/40 dark:text-amber-300">
              {data.unknownPriceOrders} {t("commission.unknownPriceNote")}
            </p>
          ) : null}
        </>
      ) : null}
    </section>
  );
}
