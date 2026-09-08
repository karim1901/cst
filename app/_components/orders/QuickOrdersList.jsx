"use client";

import { useEffect, useMemo, useState } from "react";

import MonthSelect from "@/app/_components/orders/MonthSelect";
import AddToFollowUpButton from "@/app/_components/orders/AddToFollowUpButton";
import { Spinner } from "@/app/_components/orders/shared";
import { periodFor } from "@/lib/tracking/counter";
import { SHIPPING_PROVIDERS } from "@/lib/shipping/providers";

/**
 * Quick Livraison orders — fetched from our own backend
 * (`GET /api/orders/quick`). MongoDB is the source of truth for every
 * customer/order field here (Quick's API doesn't expose enough to
 * reconstruct that); Quick is only asked for each order's current live
 * status — see app/api/orders/quick/route.js. Never calls Quick from the
 * browser, and never scans tracking numbers to "discover" orders.
 *
 * Unlike OzonOrdersList, this does NOT color-code status into
 * delivered/returned/... buckets: Quick's status vocabulary isn't
 * documented for this integration (see lib/quick/parse.js), so the raw
 * status text is shown as-is rather than guessing at a classification.
 */
export default function QuickOrdersList({
  employeeId = null,
  period: controlledPeriod,
  onPeriodChange,
  status = "all",
  initialSearch = "",
  isFollowedUp,
  onFollowUpAdded,
}) {
  // Controlled when a parent passes `period` (the merchant Orders page) —
  // uncontrolled otherwise (the plain employee view). Same pattern as
  // OzonOrdersList.
  const [internalPeriod, setInternalPeriod] = useState(() => periodFor());
  const isControlled = controlledPeriod !== undefined;
  const period = isControlled ? controlledPeriod : internalPeriod;
  const setPeriod = isControlled ? onPeriodChange : setInternalPeriod;
  const [state, setState] = useState("loading"); // loading | ready | not-configured | error
  const [errorMessage, setErrorMessage] = useState("");
  const [orders, setOrders] = useState([]);
  const [search, setSearch] = useState(initialSearch);

  // Reset per-fetch state when the selected month OR the viewed employee
  // changes — done here, during render (React's recommended "adjust state
  // when a value changes" pattern), rather than as setState calls at the
  // top of the effect below, which trigger an avoidable extra cascading
  // render.
  const resetKey = `${period}|${employeeId}|${status}`;
  const [renderedForKey, setRenderedForKey] = useState(resetKey);
  if (resetKey !== renderedForKey) {
    setRenderedForKey(resetKey);
    setState("loading");
    setErrorMessage("");
  }

  useEffect(() => {
    const controller = new AbortController();

    const params = new URLSearchParams({ period });
    if (employeeId) params.set("employeeId", employeeId);
    if (status && status !== "all") params.set("status", status);

    fetch(`/api/orders/quick?${params.toString()}`, { signal: controller.signal })
      .then(async (res) => {
        const data = await res.json().catch(() => ({}));
        if (res.status === 409) {
          setState("not-configured");
          return;
        }
        if (!res.ok) {
          setState("error");
          setErrorMessage(data?.error || "Could not load orders.");
          return;
        }
        setOrders(Array.isArray(data?.orders) ? data.orders : []);
        setState("ready");
      })
      .catch((error) => {
        if (error?.name === "AbortError") return;
        setState("error");
        setErrorMessage("Could not load orders.");
      });

    return () => controller.abort();
  }, [period, employeeId, status]);

  const visible = useMemo(() => {
    const query = search.trim();
    if (!query) return orders;
    return orders.filter((order) => String(order?.phone ?? "").includes(query));
  }, [orders, search]);

  if (state === "loading") {
    return (
      <div className="flex items-center justify-center gap-2 rounded-2xl border border-dashed border-zinc-300 px-6 py-14 text-sm text-zinc-500 dark:border-zinc-700 dark:text-zinc-400">
        <Spinner />
        Loading Quick Livraison orders…
      </div>
    );
  }

  if (state === "not-configured") {
    return (
      <div className="rounded-2xl border border-dashed border-zinc-300 px-6 py-14 text-center dark:border-zinc-700">
        <p className="text-sm font-medium text-zinc-900 dark:text-zinc-100">
          Quick Livraison is not configured yet
        </p>
        <p className="mx-auto mt-1 max-w-sm text-sm text-zinc-500 dark:text-zinc-400">
          Ask your merchant to add a Quick Livraison API key under Shipping Companies before
          creating or viewing orders.
        </p>
      </div>
    );
  }

  if (state === "error") {
    return (
      <div className="rounded-2xl border border-red-200 bg-red-50 px-6 py-10 text-center text-sm text-red-700 dark:border-red-900/50 dark:bg-red-950/40 dark:text-red-300">
        {errorMessage}
      </div>
    );
  }

  return (
    <div>
      <div className="mb-4 flex flex-col gap-2 sm:flex-row">
        {!isControlled ? (
          <MonthSelect value={period} onChange={setPeriod} disabled={state === "loading"} />
        ) : null}
        <input
          type="search"
          inputMode="tel"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Search by phone number"
          className="h-10 w-full rounded-lg border border-zinc-300 bg-white px-4 text-sm text-zinc-900 shadow-sm outline-none transition focus:border-zinc-900 focus:ring-2 focus:ring-zinc-900/10 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-100 dark:focus:border-zinc-100 dark:focus:ring-zinc-100/10"
        />
      </div>

      {visible.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-zinc-300 px-6 py-14 text-center text-sm text-zinc-500 dark:border-zinc-700 dark:text-zinc-400">
          {orders.length === 0 ? "No orders yet." : "No orders match this phone number."}
        </p>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {visible.map((order, index) => (
            <OrderCard
              key={order?.id ?? order?.trackingNumber ?? index}
              order={order}
              isFollowedUp={isFollowedUp}
              onFollowUpAdded={onFollowUpAdded}
            />
          ))}
        </div>
      )}
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

function OrderCard({ order, isFollowedUp, onFollowUpAdded }) {
  const statusLabel = order.statusUnavailable ? "Status unavailable" : order.status || "Unknown";

  return (
    <div className="w-full overflow-hidden rounded-xl border border-zinc-200 bg-white p-4 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
      <div className="mb-2 flex items-start justify-between gap-3">
        <span className="min-w-0 break-all font-mono text-sm text-zinc-700 dark:text-zinc-300">
          {order.trackingNumber}
        </span>
        <span
          className={`inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-semibold ${
            order.statusUnavailable
              ? "bg-amber-100 text-amber-700 dark:bg-amber-950/50 dark:text-amber-300"
              : "bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300"
          }`}
        >
          {statusLabel}
        </span>
      </div>

      <div className="divide-y divide-zinc-100 dark:divide-zinc-800">
        <Row label="Client">{order.receiver ?? "—"}</Row>
        <Row label="Phone">
          <a href={`tel:${order.phone ?? ""}`} className="text-blue-600 dark:text-blue-400">
            {order.phone ?? "—"}
          </a>
        </Row>
        <Row label="Address">{order.address ?? "—"}</Row>
        <Row label="Product">
          {order.product ?? "—"}
          {order.quantity != null ? ` × ${order.quantity}` : ""}
        </Row>
        <Row label="Price">{order.price != null ? `${order.price} DH` : "—"}</Row>
        {order.note ? <Row label="Note">{order.note}</Row> : null}
      </div>

      {isFollowedUp ? (
        <div className="mt-3">
          <AddToFollowUpButton
            provider={SHIPPING_PROVIDERS.QUICK_LIVRAISON}
            trackingNumber={order.trackingNumber}
            isFollowedUp={isFollowedUp(order.trackingNumber)}
            onAdded={onFollowUpAdded}
          />
        </div>
      ) : null}
    </div>
  );
}
