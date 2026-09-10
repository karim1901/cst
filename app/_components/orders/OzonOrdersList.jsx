"use client";

import { useEffect, useState } from "react";

import StatusBadge from "@/app/_components/orders/StatusBadge";
import MonthSelect from "@/app/_components/orders/MonthSelect";
import AddToFollowUpButton from "@/app/_components/orders/AddToFollowUpButton";
import { shouldShowComment } from "@/lib/ozon/status";
import { Spinner } from "@/app/_components/orders/shared";
import { useLocale } from "@/app/_components/i18n/LocaleProvider";
import { periodFor } from "@/lib/tracking/counter";
import { SHIPPING_PROVIDERS } from "@/lib/shipping/providers";

/**
 * Ozon Express orders — fetched from our own backend (`GET /api/orders/ozon`),
 * which itself re-fetches tracking/parcel-info from Ozon live (see
 * lib/ozon/fetch-orders.js). Never calls Ozon from the browser.
 *
 * The endpoint streams newline-delimited JSON (one order per line, as soon
 * as it is ready — see the route for why) instead of one big JSON array, so
 * this component renders orders progressively as they arrive rather than
 * waiting for the whole history to finish loading. Orders can arrive out of
 * order (the backend fetches in small concurrent batches); the visible list
 * is always re-sorted by tracking number, newest first, so the FINAL order
 * is correct regardless of arrival order.
 *
 * Preserves the old implementation's display fields (INFOS.*, numbered
 * history steps, COMMENT). Search is NOT done here: the Orders page's
 * search bar (OrdersPageClient / OrdersSearch) runs a dedicated
 * server-side query (app/api/orders/search) and renders its own results
 * instead of this component whenever a search is active — so this list is
 * only ever the plain, progressively-loaded month view.
 */

// Sort key: the plain numeric id the backend generated this tracking number
// from (see lib/ozon/fetch-orders.js), NOT a regex parse of the display
// tracking number — a merchant's derived prefix can itself end in digits
// (e.g. from an email like "shop99@..."), which would fuse with the counter
// under any "trailing digits" string parse and silently corrupt the sort.
function trackingSortKey(order) {
  const value = Number(order?._numericTrackingNumber);
  return Number.isFinite(value) ? value : 0;
}

export default function OzonOrdersList({
  employeeId = null,
  period: controlledPeriod,
  onPeriodChange,
  status = "all",
  isFollowedUp,
  onFollowUpAdded,
}) {
  const { t } = useLocale();
  // Controlled when a parent passes `period` (the merchant Orders page, so
  // its own OrderFilters is the single month picker on screen instead of a
  // second one duplicated in here) — uncontrolled otherwise (the plain
  // employee view, unchanged from before this prop existed).
  const [internalPeriod, setInternalPeriod] = useState(() => periodFor());
  const isControlled = controlledPeriod !== undefined;
  const period = isControlled ? controlledPeriod : internalPeriod;
  const setPeriod = isControlled ? onPeriodChange : setInternalPeriod;
  const [state, setState] = useState("connecting"); // connecting | streaming | not-configured | fatal
  const [fatalMessage, setFatalMessage] = useState("");
  const [warning, setWarning] = useState("");
  const [orders, setOrders] = useState([]);
  const [streamDone, setStreamDone] = useState(false);

  // Reset per-fetch state when the selected month OR the viewed employee
  // changes — done here, during render (React's recommended "adjust state
  // when a value changes" pattern), rather than as setState calls at the
  // top of the effect below, which trigger an avoidable extra cascading
  // render.
  const resetKey = `${period}|${employeeId}|${status}`;
  const [renderedForKey, setRenderedForKey] = useState(resetKey);
  if (resetKey !== renderedForKey) {
    setRenderedForKey(resetKey);
    setState("connecting");
    setFatalMessage("");
    setWarning("");
    setOrders([]);
    setStreamDone(false);
  }

  useEffect(() => {
    const controller = new AbortController();
    const seen = new Set(); // tracking numbers already added — never render a duplicate

    async function run() {
      let res;
      try {
        const params = new URLSearchParams({ period });
        if (employeeId) params.set("employeeId", employeeId);
        if (status && status !== "all") params.set("status", status);
        res = await fetch(`/api/orders/ozon?${params.toString()}`, {
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
              const trackingNumber = event.order?.INFOS?.["TRACKING-NUMBER"];
              if (trackingNumber) {
                if (seen.has(trackingNumber)) continue;
                seen.add(trackingNumber);
              }
              // Functional update + a full re-sort on each arrival: lists are
              // small enough (bounded by the backend's own request cap) that
              // this is cheap, and it guarantees correct final ordering no
              // matter which order responses actually arrived in.
              setOrders((prev) => {
                const next = [...prev, event.order];
                next.sort((a, b) => trackingSortKey(b) - trackingSortKey(a));
                return next;
              });
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
  }, [period, employeeId, status]);

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
          {orders.length > 0
            ? `${orders.length} ${orders.length === 1 ? t("common.order") : t("common.orders")} ${t("orders.loadingMore")}`
            : t("orders.lookingForOrders")}
        </div>
      ) : warning ? (
        <p className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-700 dark:border-amber-900/50 dark:bg-amber-950/40 dark:text-amber-300">
          {warning}
        </p>
      ) : null}

      {orders.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-zinc-300 px-6 py-14 text-center text-sm text-zinc-500 dark:border-zinc-700 dark:text-zinc-400">
          {streamDone ? t("orders.noOrdersYet") : t("orders.lookingForOrders")}
        </p>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {orders.map((order, index) => (
            <OrderCard
              key={order?.INFOS?.["TRACKING-NUMBER"] ?? index}
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
  const infos = order?.INFOS ?? {};
  const trackingNumber = infos["TRACKING-NUMBER"];
  const displayStatus = order?._displayStatus ?? order?.STATUT;
  const courierPhone = order?._courierPhone ?? "";
  const commentVisible = shouldShowComment(displayStatus);
  const date = order?.["1"]?.TIME_STR;
  const comment = commentVisible ? order?.COMMENT : null;

  return (
    <div className="w-full overflow-hidden rounded-xl border border-zinc-200 bg-white p-4 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
      <div className="mb-2 flex items-start justify-between gap-3">
        <span className="min-w-0 break-all font-mono text-sm text-zinc-700 dark:text-zinc-300">
          {trackingNumber}
        </span>
        <StatusBadge status={displayStatus} />
      </div>

      <div className="divide-y divide-zinc-100 dark:divide-zinc-800">
        <Row label="Client">{infos.RECEIVER}</Row>
        <Row label="Phone">
          <a href={`tel:${infos.PHONE ?? ""}`} className="text-blue-600 dark:text-blue-400">
            {infos.PHONE}
          </a>
        </Row>
        <Row label="City">{infos.CITY_NAME}</Row>
        <Row label="Address">{infos.ADDRESS}</Row>
        <Row label="Product">{infos.NOTE}</Row>
        <Row label="Price">{infos.PRICE != null ? `${infos.PRICE} DH` : "—"}</Row>
        {date ? <Row label="Date">{date}</Row> : null}
        {courierPhone ? <Row label="Courier">{courierPhone}</Row> : null}
      </div>

      {isFollowedUp ? (
        <div className="mt-3">
          <AddToFollowUpButton
            provider={SHIPPING_PROVIDERS.OZON_EXPRESS}
            trackingNumber={trackingNumber}
            isFollowedUp={isFollowedUp(trackingNumber)}
            onAdded={onFollowUpAdded}
          />
        </div>
      ) : null}

      {comment ? (
        <p className="mt-3 rounded-md bg-zinc-50 p-2 text-sm text-zinc-700 dark:bg-zinc-800/60 dark:text-zinc-300">
          {comment}
        </p>
      ) : null}
    </div>
  );
}
