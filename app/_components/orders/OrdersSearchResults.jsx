"use client";

import { useEffect, useState } from "react";

import DbOrderCard from "@/app/_components/orders/DbOrderCard";
import { Spinner, ErrorBanner } from "@/app/_components/orders/shared";
import { useLocale } from "@/app/_components/i18n/LocaleProvider";

/**
 * Server-side Orders search results (app/api/orders/search) — phone number
 * or tracking number — rendered as the SAME order cards the rest of the
 * Orders page uses (DbOrderCard, also used by the "All employees" browser),
 * not a second order UI.
 *
 * The server is authoritative for every constraint (merchant isolation,
 * provider, month, employee, status); this component only forwards the
 * current selections and shows what comes back. It never talks to a
 * provider API, so a slow/failing provider can't hide a result.
 */
export default function OrdersSearchResults({
  provider,
  employeeId, // "me" | <id> | undefined  — merchants only; ignored server-side for employees
  period,
  status = "all",
  searchMode,
  search,
  isFollowedUp,
  onFollowUpAdded,
}) {
  const { t } = useLocale();
  const [state, setState] = useState("loading"); // loading | ready | error
  const [errorMessage, setErrorMessage] = useState("");
  const [data, setData] = useState({ orders: [], page: 1, totalPages: 1, total: 0 });
  const [page, setPage] = useState(1);

  // Reset to page 1 whenever the search/filters change — "adjust state
  // during render", the same pattern OrdersBrowser uses.
  const filterKey = `${provider}|${employeeId}|${period}|${status}|${searchMode}|${search}`;
  const [renderedForFilterKey, setRenderedForFilterKey] = useState(filterKey);
  if (filterKey !== renderedForFilterKey) {
    setRenderedForFilterKey(filterKey);
    setPage(1);
  }

  const fetchKey = `${filterKey}|${page}`;
  const [renderedForFetchKey, setRenderedForFetchKey] = useState(fetchKey);
  if (fetchKey !== renderedForFetchKey) {
    setRenderedForFetchKey(fetchKey);
    setState("loading");
  }

  useEffect(() => {
    const controller = new AbortController();

    const params = new URLSearchParams({
      provider,
      searchMode,
      search,
      page: String(page),
    });
    if (employeeId) params.set("employeeId", employeeId);
    if (period) params.set("period", period);
    if (status && status !== "all") params.set("status", status);

    fetch(`/api/orders/search?${params.toString()}`, { signal: controller.signal })
      .then(async (res) => {
        const body = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(body?.error || t("orders.couldNotLoad"));
        setData(body);
        setState("ready");
      })
      .catch((error) => {
        if (error?.name === "AbortError") return;
        setErrorMessage(error?.message || t("orders.couldNotLoad"));
        setState("error");
      });

    return () => controller.abort();
  }, [provider, employeeId, period, status, searchMode, search, page, t]);

  if (state === "loading") {
    return (
      <div className="flex items-center justify-center gap-2 rounded-2xl border border-dashed border-zinc-300 px-6 py-14 text-sm text-zinc-500 dark:border-zinc-700 dark:text-zinc-400">
        <Spinner />
        {t("orders.searching")}
      </div>
    );
  }

  if (state === "error") {
    return <ErrorBanner>{errorMessage}</ErrorBanner>;
  }

  if (data.orders.length === 0) {
    return (
      <p className="rounded-2xl border border-dashed border-zinc-300 px-6 py-14 text-center text-sm text-zinc-500 dark:border-zinc-700 dark:text-zinc-400">
        {t("orders.noOrdersFound")}
      </p>
    );
  }

  return (
    <div>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        {data.orders.map((order) => (
          <DbOrderCard
            key={order.id}
            order={order}
            provider={provider}
            isFollowedUp={isFollowedUp}
            onFollowUpAdded={onFollowUpAdded}
          />
        ))}
      </div>

      {data.totalPages > 1 ? (
        <div className="mt-4 flex items-center justify-between gap-3 text-sm">
          <button
            type="button"
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            disabled={page <= 1}
            className="rounded-lg border border-zinc-300 px-3 py-1.5 font-medium text-zinc-700 disabled:cursor-not-allowed disabled:opacity-40 dark:border-zinc-700 dark:text-zinc-200"
          >
            {t("common.previous")}
          </button>
          <span className="text-zinc-500 dark:text-zinc-400">
            {t("common.page")} {data.page} {t("common.of")} {data.totalPages} · {data.total}{" "}
            {data.total === 1 ? t("common.order") : t("common.orders")}
          </span>
          <button
            type="button"
            onClick={() => setPage((p) => Math.min(data.totalPages, p + 1))}
            disabled={page >= data.totalPages}
            className="rounded-lg border border-zinc-300 px-3 py-1.5 font-medium text-zinc-700 disabled:cursor-not-allowed disabled:opacity-40 dark:border-zinc-700 dark:text-zinc-200"
          >
            {t("common.next")}
          </button>
        </div>
      ) : null}
    </div>
  );
}
