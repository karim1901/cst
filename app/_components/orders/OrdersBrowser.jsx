"use client";

import { useEffect, useState } from "react";

import StatusBadge from "@/app/_components/orders/StatusBadge";
import { Spinner, ErrorBanner } from "@/app/_components/orders/shared";
import { SHIPPING_PROVIDERS } from "@/lib/shipping/providers";

const dateFormatter = new Intl.DateTimeFormat("en-GB", {
  day: "2-digit",
  month: "short",
  year: "numeric",
});

/**
 * "All employees" order browsing — reads GET /api/orders (local DB,
 * server-paginated/filtered — see that route's module comment for why this
 * is a separate, DB-backed path rather than N live provider fetches).
 * Merchant-only, mirrors the visual language of OzonOrdersList/
 * QuickOrdersList's cards rather than introducing a table.
 */
export default function OrdersBrowser({ provider, employeeId, period }) {
  const [state, setState] = useState("loading"); // loading | ready | error
  const [errorMessage, setErrorMessage] = useState("");
  const [data, setData] = useState({ orders: [], page: 1, totalPages: 1, total: 0 });
  const [page, setPage] = useState(1);

  // Reset to page 1 whenever the filters themselves change — same "adjust
  // state during render" pattern used by the other order-list components in
  // this folder.
  const filterKey = `${provider}|${employeeId}|${period}`;
  const [renderedForFilterKey, setRenderedForFilterKey] = useState(filterKey);
  if (filterKey !== renderedForFilterKey) {
    setRenderedForFilterKey(filterKey);
    setPage(1);
  }

  // Back to "loading" whenever what's about to be fetched changes (filters
  // OR page) — also adjusted during render rather than as a synchronous
  // setState at the top of the effect below, which React's linter flags as
  // a cascading-render risk.
  const fetchKey = `${filterKey}|${page}`;
  const [renderedForFetchKey, setRenderedForFetchKey] = useState(fetchKey);
  if (fetchKey !== renderedForFetchKey) {
    setRenderedForFetchKey(fetchKey);
    setState("loading");
  }

  useEffect(() => {
    const controller = new AbortController();

    const params = new URLSearchParams({ provider, page: String(page) });
    if (employeeId) params.set("employeeId", employeeId);
    if (period) params.set("period", period);

    fetch(`/api/orders?${params.toString()}`, { signal: controller.signal })
      .then(async (res) => {
        const body = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(body?.error || "Could not load orders.");
        setData(body);
        setState("ready");
      })
      .catch((error) => {
        if (error?.name === "AbortError") return;
        setErrorMessage(error?.message || "Could not load orders.");
        setState("error");
      });

    return () => controller.abort();
  }, [provider, employeeId, period, page]);

  if (state === "loading") {
    return (
      <div className="flex items-center justify-center gap-2 rounded-2xl border border-dashed border-zinc-300 px-6 py-14 text-sm text-zinc-500 dark:border-zinc-700 dark:text-zinc-400">
        <Spinner />
        Loading orders…
      </div>
    );
  }

  if (state === "error") {
    return <ErrorBanner>{errorMessage}</ErrorBanner>;
  }

  if (data.orders.length === 0) {
    return (
      <p className="rounded-2xl border border-dashed border-zinc-300 px-6 py-14 text-center text-sm text-zinc-500 dark:border-zinc-700 dark:text-zinc-400">
        No orders for this period.
      </p>
    );
  }

  return (
    <div>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        {data.orders.map((order) => (
          <OrderCard key={order.id} order={order} provider={provider} />
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
            ← Previous
          </button>
          <span className="text-zinc-500 dark:text-zinc-400">
            Page {data.page} of {data.totalPages} · {data.total} order{data.total === 1 ? "" : "s"}
          </span>
          <button
            type="button"
            onClick={() => setPage((p) => Math.min(data.totalPages, p + 1))}
            disabled={page >= data.totalPages}
            className="rounded-lg border border-zinc-300 px-3 py-1.5 font-medium text-zinc-700 disabled:cursor-not-allowed disabled:opacity-40 dark:border-zinc-700 dark:text-zinc-200"
          >
            Next →
          </button>
        </div>
      ) : null}
    </div>
  );
}

function Row({ label, children }) {
  return (
    <div className="flex gap-2 py-0.5 text-sm">
      <span className="w-20 shrink-0 text-zinc-500 dark:text-zinc-400">{label}</span>
      <span className="min-w-0 flex-1 break-words font-medium text-zinc-900 dark:text-zinc-100">
        {children}
      </span>
    </div>
  );
}

function OrderCard({ order, provider }) {
  return (
    <div className="w-full overflow-hidden rounded-xl border border-zinc-200 bg-white p-4 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
      <div className="mb-2 flex items-start justify-between gap-3">
        <span className="min-w-0 break-all font-mono text-sm text-zinc-700 dark:text-zinc-300">
          {order.trackingNumber}
        </span>
        {provider === SHIPPING_PROVIDERS.OZON_EXPRESS ? (
          <StatusBadge status={order.status} />
        ) : (
          <span className="inline-flex items-center gap-1 whitespace-nowrap rounded-full bg-zinc-100 px-2.5 py-0.5 text-xs font-semibold text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300">
            {order.status || "Unknown"}
          </span>
        )}
      </div>

      <div className="divide-y divide-zinc-100 dark:divide-zinc-800">
        {order.employee ? <Row label="Employee">{order.employee.name}</Row> : null}
        <Row label="Client">{order.receiver}</Row>
        <Row label="Phone">
          <a href={`tel:${order.phone ?? ""}`} className="text-blue-600 dark:text-blue-400">
            {order.phone}
          </a>
        </Row>
        <Row label="City">{order.city}</Row>
        <Row label="Product">{order.product}</Row>
        <Row label="Price">{order.price != null ? `${order.price} DH` : "—"}</Row>
        <Row label="Created">{dateFormatter.format(new Date(order.createdAt))}</Row>
      </div>
    </div>
  );
}
