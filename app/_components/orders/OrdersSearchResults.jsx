"use client";

import { useEffect, useMemo, useState } from "react";

import DbOrderCard from "@/app/_components/orders/DbOrderCard";
import { Spinner, ErrorBanner } from "@/app/_components/orders/shared";
import { useLocale } from "@/app/_components/i18n/LocaleProvider";
import { isReturnStatus, ORDER_STATUS_FILTERS } from "@/lib/orders/status-groups";

const CLIENT_PAGE_SIZE = 20;
const FETCH_PAGE_SIZE = 50;

/**
 * Server-side Orders search results (app/api/orders/search) — phone number
 * or tracking number — rendered as the SAME order cards the rest of the
 * Orders page uses (DbOrderCard).
 *
 * The search itself stays server-side: it is a security/completeness
 * boundary (merchant isolation, provider, month, employee all enforced on
 * the server; it searches the whole order store, not just a loaded month).
 * But once a result set is loaded, the status tab (All / Livré / Progress /
 * Retour) and the pager are pure CLIENT-side views of it — changing the
 * status tab NEVER refetches. Only a change to the search text/mode or the
 * real scope (provider, employee, month) re-runs the query.
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
  const [allOrders, setAllOrders] = useState([]);
  const [clientPage, setClientPage] = useState(1);

  // Status is intentionally NOT part of the fetch key.
  const fetchKey = `${provider}|${employeeId}|${period}|${searchMode}|${search}`;
  const [renderedForFetchKey, setRenderedForFetchKey] = useState(fetchKey);
  if (fetchKey !== renderedForFetchKey) {
    setRenderedForFetchKey(fetchKey);
    setState("loading");
    setAllOrders([]);
    setClientPage(1);
  }

  const [renderedForStatus, setRenderedForStatus] = useState(status);
  if (status !== renderedForStatus) {
    setRenderedForStatus(status);
    setClientPage(1);
  }

  useEffect(() => {
    const controller = new AbortController();

    async function loadAll() {
      const collected = [];
      let pageNum = 1;
      let totalPages = 1;
      try {
        do {
          const params = new URLSearchParams({
            provider,
            searchMode,
            search,
            page: String(pageNum),
            pageSize: String(FETCH_PAGE_SIZE),
          });
          if (employeeId) params.set("employeeId", employeeId);
          if (period) params.set("period", period);
          // No `status` — filtered locally on the result set below.

          const res = await fetch(`/api/orders/search?${params.toString()}`, {
            signal: controller.signal,
          });
          const body = await res.json().catch(() => ({}));
          if (!res.ok) throw new Error(body?.error || t("orders.couldNotLoad"));
          collected.push(...(body.orders ?? []));
          totalPages = body.totalPages ?? 1;
          pageNum += 1;
        } while (pageNum <= totalPages);

        setAllOrders(collected);
        setState("ready");
      } catch (error) {
        if (error?.name === "AbortError") return;
        setErrorMessage(error?.message || t("orders.couldNotLoad"));
        setState("error");
      }
    }

    loadAll();
    return () => controller.abort();
  }, [provider, employeeId, period, searchMode, search, t]);

  // Same canonical status rule as GET /api/orders (deliveredAt-based).
  const filtered = useMemo(() => {
    if (!status || status === ORDER_STATUS_FILTERS.ALL) return allOrders;
    return allOrders.filter((o) => {
      const delivered = o.deliveredAt != null;
      if (status === ORDER_STATUS_FILTERS.DELIVERED) return delivered;
      if (status === ORDER_STATUS_FILTERS.RETURN) return !delivered && isReturnStatus(o.status);
      return !delivered && !isReturnStatus(o.status); // PROGRESS
    });
  }, [allOrders, status]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / CLIENT_PAGE_SIZE));
  const page = Math.min(clientPage, totalPages);
  const pageOrders = filtered.slice((page - 1) * CLIENT_PAGE_SIZE, page * CLIENT_PAGE_SIZE);

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

  if (filtered.length === 0) {
    return (
      <p className="rounded-2xl border border-dashed border-zinc-300 px-6 py-14 text-center text-sm text-zinc-500 dark:border-zinc-700 dark:text-zinc-400">
        {allOrders.length > 0 ? t("orders.noOrdersForFilter") : t("orders.noOrdersFound")}
      </p>
    );
  }

  return (
    <div>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        {pageOrders.map((order) => (
          <DbOrderCard
            key={order.id}
            order={order}
            provider={provider}
            isFollowedUp={isFollowedUp}
            onFollowUpAdded={onFollowUpAdded}
          />
        ))}
      </div>

      {totalPages > 1 ? (
        <div className="mt-4 flex items-center justify-between gap-3 text-sm">
          <button
            type="button"
            onClick={() => setClientPage((p) => Math.max(1, p - 1))}
            disabled={page <= 1}
            className="rounded-lg border border-zinc-300 px-3 py-1.5 font-medium text-zinc-700 disabled:cursor-not-allowed disabled:opacity-40 dark:border-zinc-700 dark:text-zinc-200"
          >
            {t("common.previous")}
          </button>
          <span className="text-zinc-500 dark:text-zinc-400">
            {t("common.page")} {page} {t("common.of")} {totalPages} · {filtered.length}{" "}
            {filtered.length === 1 ? t("common.order") : t("common.orders")}
          </span>
          <button
            type="button"
            onClick={() => setClientPage((p) => Math.min(totalPages, p + 1))}
            disabled={page >= totalPages}
            className="rounded-lg border border-zinc-300 px-3 py-1.5 font-medium text-zinc-700 disabled:cursor-not-allowed disabled:opacity-40 dark:border-zinc-700 dark:text-zinc-200"
          >
            {t("common.next")}
          </button>
        </div>
      ) : null}
    </div>
  );
}
