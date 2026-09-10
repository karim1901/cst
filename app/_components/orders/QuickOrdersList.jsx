"use client";

import { useEffect, useState } from "react";

import StatusBadge from "@/app/_components/orders/StatusBadge";
import MonthSelect from "@/app/_components/orders/MonthSelect";
import AddToFollowUpButton from "@/app/_components/orders/AddToFollowUpButton";
import { Spinner } from "@/app/_components/orders/shared";
import { useLocale } from "@/app/_components/i18n/LocaleProvider";
import { periodFor } from "@/lib/tracking/counter";
import { SHIPPING_PROVIDERS } from "@/lib/shipping/providers";
import { matchesStatusFilter } from "@/lib/orders/status-groups";

/**
 * Quick Livraison orders — fetched from our own backend
 * (`GET /api/orders/quick`). MongoDB is the source of truth for every
 * customer/order field here; Quick is only asked for each order's current
 * live status (see that route's own module comment). Never calls Quick from
 * the browser.
 *
 * The endpoint streams newline-delimited JSON (one order per line, as soon
 * as it is confirmed — either a live-status refresh for the current month,
 * or discovered+synced on the fly for a historical month) instead of one
 * big JSON array — same shape/protocol as OzonOrdersList's own stream — so
 * this component renders orders progressively rather than waiting for the
 * whole month to finish. For a historical month, the backend also streams
 * `{type:"progress"}` events (see the progress indicator below).
 *
 * Orders can arrive OUT of tracking-number order (concurrent batches don't
 * resolve in strict sequence) — this re-sorts the list by tracking
 * sequence, descending, on EVERY arrival (using `_numericCounter`, which
 * the backend computes purely for this purpose), the same
 * never-trust-arrival-order pattern OzonOrdersList.jsx already established
 * for Ozon. Never sorted by `createdAt` or insertion order.
 */

// Sort key: the numeric counter embedded in the tracking number (see
// lib/quick/sync-order.js#numericCounterFromTrackingNumber, computed
// server-side) — NOT `createdAt`, NOT arrival order, NOT MongoDB insertion
// order. Same rationale as OzonOrdersList.jsx's own `trackingSortKey`.
function trackingSortKey(order) {
  const value = Number(order?._numericCounter);
  return Number.isFinite(value) ? value : 0;
}

export default function QuickOrdersList({
  active = true,
  employeeId = null,
  period: controlledPeriod,
  onPeriodChange,
  status = "all",
  isFollowedUp,
  onFollowUpAdded,
}) {
  const { t } = useLocale();
  // Mounted-but-hidden when it's the non-selected provider tab (see
  // OrdersPageClient). Streams its month exactly ONCE, the first time it
  // becomes `active`, and keeps that data afterwards — toggling back to
  // Quick never re-streams. `activated` latches true.
  const [activated, setActivated] = useState(active);
  if (active && !activated) setActivated(true);
  // Controlled when a parent passes `period` (the merchant Orders page) —
  // uncontrolled otherwise (the plain employee view). Same pattern as
  // OzonOrdersList.
  const [internalPeriod, setInternalPeriod] = useState(() => periodFor());
  const isControlled = controlledPeriod !== undefined;
  const period = isControlled ? controlledPeriod : internalPeriod;
  const setPeriod = isControlled ? onPeriodChange : setInternalPeriod;
  const [state, setState] = useState("connecting"); // connecting | streaming | not-configured | fatal
  const [fatalMessage, setFatalMessage] = useState("");
  const [warning, setWarning] = useState("");
  const [orders, setOrders] = useState([]);
  const [streamDone, setStreamDone] = useState(false);
  // Historical-month-only progress ({checked, total, found}); `null` for
  // the current month, which has no counter range to walk and so nothing
  // to report progress on — see the route's own module comment.
  const [progress, setProgress] = useState(null);

  // Reset per-fetch state ONLY when the actual data-fetch scope changes —
  // the selected month or the viewed employee. The status filter is
  // DELIBERATELY NOT in this key: it is a pure client-side view of the
  // already-loaded month (see `visibleOrders` below), never a reason to
  // re-stream. Done during render — same pattern as OzonOrdersList.
  const resetKey = `${period}|${employeeId}`;
  const [renderedForKey, setRenderedForKey] = useState(resetKey);
  if (resetKey !== renderedForKey) {
    setRenderedForKey(resetKey);
    setState("connecting");
    setFatalMessage("");
    setWarning("");
    setOrders([]);
    setStreamDone(false);
    setProgress(null);
  }

  useEffect(() => {
    if (!activated) return; // dormant (hidden provider tab) — don't stream until first shown
    const controller = new AbortController();
    const seen = new Set(); // tracking numbers already added — never render a duplicate

    async function run() {
      let res;
      try {
        // The WHOLE month is streamed once — every status. The status tab
        // filters this dataset locally; it is never sent to the server.
        const params = new URLSearchParams({ period });
        if (employeeId) params.set("employeeId", employeeId);
        res = await fetch(`/api/orders/quick?${params.toString()}`, {
          signal: controller.signal,
        });
      } catch (error) {
        if (error?.name === "AbortError") return;
        setState("fatal");
        setFatalMessage("Could not load orders.");
        return;
      }

      if (res.status === 409) {
        setState("not-configured");
        return;
      }
      if (!res.ok || !res.body) {
        const data = await res.json().catch(() => ({}));
        setState("fatal");
        setFatalMessage(data?.error || "Could not load orders.");
        return;
      }

      setState("streaming");

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      try {
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });

          let newlineIndex = buffer.indexOf("\n");
          while (newlineIndex !== -1) {
            const line = buffer.slice(0, newlineIndex);
            buffer = buffer.slice(newlineIndex + 1);
            newlineIndex = buffer.indexOf("\n");

            if (!line.trim()) continue;
            let event;
            try {
              event = JSON.parse(line);
            } catch {
              continue; // one malformed line must not break the whole stream
            }

            if (event.type === "order") {
              const trackingNumber = event.order?.trackingNumber;
              if (trackingNumber) {
                if (seen.has(trackingNumber)) continue;
                seen.add(trackingNumber);
              }
              // Functional update + a full re-sort on each arrival — lists
              // are small enough (bounded by the backend's own counter
              // range) that this is cheap, and it guarantees correct final
              // ordering no matter which order responses actually arrived
              // in. Same pattern as OzonOrdersList.jsx.
              setOrders((prev) => {
                const next = [...prev, event.order];
                next.sort((a, b) => trackingSortKey(b) - trackingSortKey(a));
                return next;
              });
            } else if (event.type === "progress") {
              setProgress({ checked: event.checked, total: event.total, found: event.found });
            } else if (event.type === "error") {
              // A soft, mid-stream problem — orders already shown stay put.
              setWarning(event.message || "Some orders could not be loaded.");
            }
          }
        }
      } catch (error) {
        if (error?.name !== "AbortError") {
          setWarning("The connection was interrupted before all orders finished loading.");
        }
      } finally {
        setStreamDone(true);
      }
    }

    run();

    return () => controller.abort();
  }, [period, employeeId, activated]);

  // Pure client-side view of the already-streamed month — recomputed each
  // render. Switching the status tab NEVER refetches; orders still arriving
  // that match the active filter appear automatically as `orders` grows.
  const visibleOrders =
    !status || status === "all"
      ? orders
      : orders.filter((o) =>
          matchesStatusFilter(SHIPPING_PROVIDERS.QUICK_LIVRAISON, o?.status, status)
        );

  if (state === "connecting") {
    return (
      <div className="flex items-center justify-center gap-2 rounded-2xl border border-dashed border-zinc-300 px-6 py-14 text-sm text-zinc-500 dark:border-zinc-700 dark:text-zinc-400">
        <Spinner />
        {t("orders.loadingOrders")}
      </div>
    );
  }

  if (state === "not-configured") {
    return (
      <div className="rounded-2xl border border-dashed border-zinc-300 px-6 py-14 text-center dark:border-zinc-700">
        <p className="text-sm font-medium text-zinc-900 dark:text-zinc-100">
          {t("orders.notConfigured")}
        </p>
        <p className="mx-auto mt-1 max-w-sm text-sm text-zinc-500 dark:text-zinc-400">
          {t("orders.askMerchant")}
        </p>
      </div>
    );
  }

  if (state === "fatal") {
    return (
      <div className="rounded-2xl border border-red-200 bg-red-50 px-6 py-10 text-center text-sm text-red-700 dark:border-red-900/50 dark:bg-red-950/40 dark:text-red-300">
        {fatalMessage}
      </div>
    );
  }

  return (
    <div>
      {!isControlled ? (
        <div className="mb-4">
          <MonthSelect value={period} onChange={setPeriod} disabled={!streamDone} />
        </div>
      ) : null}

      {!streamDone ? (
        <div className="mb-4 flex items-center gap-2 text-sm text-zinc-500 dark:text-zinc-400">
          <Spinner />
          {progress
            ? `${t("orders.loadingOrders")} ${progress.checked} / ${progress.total} · ${progress.found}`
            : visibleOrders.length > 0
              ? `${visibleOrders.length} ${visibleOrders.length === 1 ? t("common.order") : t("common.orders")} ${t("orders.loadingMore")}`
              : t("orders.lookingForOrders")}
        </div>
      ) : warning ? (
        <p className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-700 dark:border-amber-900/50 dark:bg-amber-950/40 dark:text-amber-300">
          {warning}
        </p>
      ) : null}

      {visibleOrders.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-zinc-300 px-6 py-14 text-center text-sm text-zinc-500 dark:border-zinc-700 dark:text-zinc-400">
          {!streamDone
            ? t("orders.lookingForOrders")
            : orders.length > 0
              ? t("orders.noOrdersForFilter")
              : t("orders.noOrdersYet")}
        </p>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {visibleOrders.map((order, index) => (
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
  const statusLabel = order.statusUnavailable ? "Status unavailable" : order.status;

  return (
    <div className="w-full overflow-hidden rounded-xl border border-zinc-200 bg-white p-4 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
      <div className="mb-2 flex items-start justify-between gap-3">
        <span className="min-w-0 break-all font-mono text-sm text-zinc-700 dark:text-zinc-300">
          {order.trackingNumber}
        </span>
        {order.statusUnavailable ? (
          <span className="inline-flex items-center gap-1 whitespace-nowrap rounded-full bg-amber-100 px-2.5 py-0.5 text-xs font-semibold text-amber-700 dark:bg-amber-950/50 dark:text-amber-300">
            {statusLabel}
          </span>
        ) : (
          <StatusBadge status={statusLabel} provider={SHIPPING_PROVIDERS.QUICK_LIVRAISON} />
        )}
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
