"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";

import ReturnsFilters from "@/app/_components/returns/ReturnsFilters";
import DeliveredFilters from "@/app/_components/returns/DeliveredFilters";
import MonthSelect from "@/app/_components/orders/MonthSelect";
import StatusBadge from "@/app/_components/orders/StatusBadge";
import { Spinner, ErrorBanner } from "@/app/_components/orders/shared";
import { SHIPPING_PROVIDERS } from "@/lib/shipping/providers";
import {
  ORDER_LIFECYCLE_SECTIONS,
  ORDER_LIFECYCLE_SECTION_VALUES,
  ORDER_LIFECYCLE_SECTION_LABELS,
} from "@/lib/returns/constants";

const PROVIDER_LABEL = {
  ozon_express: "Ozon Express",
  quick_livraison: "Quick Livraison",
};

const dateTimeFormatter = new Intl.DateTimeFormat("en-GB", {
  day: "2-digit",
  month: "short",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});

const PAGE_SIZE = 20;

const EMPTY_MESSAGE = {
  all: "No orders found",
  delivered: "No delivered orders found",
  returns: "No returns found",
};

/**
 * Order-lifecycle page — 3 sections (All / Delivered / Returns), all
 * filtered views of the SAME `Order` dataset, never a separate collection
 * or a manual "move order" action: which section an order belongs to is
 * decided purely by its already-synchronized `lastKnownStatus`/`deliveredAt`
 * (see lib/returns/list.js#queryOrdersForSection) — the instant provider
 * sync updates those fields, the order shows up in the right section on the
 * next read, automatically.
 *
 *  - All: every order, no extra filters.
 *  - Delivered: `deliveredAt` is set, filterable by Employee and by a
 *    Delivery Date range (see DeliveredFilters.jsx) — always against the
 *    REAL delivery date (`deliveredAt`), never `createdAt`.
 *  - Returns: the ORIGINAL Returns feature, entirely unchanged — cancelled/
 *    refused/returned orders, filterable by shipping-status reason and by
 *    the merchant's own internal return-validation state. "Validate
 *    Return"/"Mark as Pending" are ONLY ever rendered for this section —
 *    see ReturnCard's `section` prop below.
 *
 * Same overall shape as app/_components/track/FollowUpList.jsx (client-
 * driven fetch + local state, inline card component) and
 * app/_components/orders/OrdersBrowser.jsx (server-paginated/filtered local
 * DB read) — reads/writes GET /api/returns, POST /api/returns/sync, and
 * POST /api/returns/[id]/validate|unvalidate (Returns section only).
 *
 * Loading flow follows the feature's own "fast page loading" rule: the
 * local list renders immediately from GET /api/returns; a lightweight
 * background sync (current month only) fires once right after that, and
 * only refreshes the list if it actually completes — a slow/failed sync
 * never blocks or hides what's already on screen. Changing a section,
 * filter, or page only ever re-reads the local DB, never re-triggers a
 * provider sync.
 */
export default function ReturnsList({ employees }) {
  const [section, setSection] = useState(ORDER_LIFECYCLE_SECTIONS.ALL);

  // All-section-only filter: which month, by the SAME tracking-number-
  // derived "YYYYMM" convention the Orders page's own MonthSelect already
  // uses (see lib/returns/list.js's own comment) — "" means "All Months".
  const [period, setPeriod] = useState("");

  // Returns-section-only filters (unchanged from before this page grew the
  // other 2 sections).
  const [shippingStatus, setShippingStatus] = useState("all");
  const [validation, setValidation] = useState("all");

  // Delivered-section-only filters.
  const [employeeId, setEmployeeId] = useState(null);
  const [deliveryDate, setDeliveryDate] = useState("all");
  const [customDate, setCustomDate] = useState("");
  const [customStart, setCustomStart] = useState("");
  const [customEnd, setCustomEnd] = useState("");

  const [page, setPage] = useState(1);

  const [state, setState] = useState("loading"); // loading | ready | error
  const [errorMessage, setErrorMessage] = useState("");
  const [data, setData] = useState({
    returns: [],
    page: 1,
    totalPages: 1,
    total: 0,
    counts: { all: 0, delivered: 0, returns: 0 },
  });
  // Starts `true` (not set inside the mount effect below) — the automatic
  // background sync that effect kicks off genuinely begins the instant this
  // component mounts, so this is the correct initial value, not a
  // synchronous setState-in-effect (which the react-hooks linter flags as a
  // cascading-render risk).
  const [syncing, setSyncing] = useState(true);
  const [pendingIds, setPendingIds] = useState(() => new Set());

  // Reset to page 1 whenever a filter (or the section itself) changes —
  // adjusted during render (not a synchronous setState inside the fetch
  // effect), same pattern already used by OrdersBrowser.jsx/SidebarNav.jsx
  // in this app.
  const filterKey = `${section}|${period}|${shippingStatus}|${validation}|${employeeId}|${deliveryDate}|${customDate}|${customStart}|${customEnd}`;
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

  const load = useCallback(
    (signal) => {
      const params = new URLSearchParams({
        section,
        page: String(page),
        pageSize: String(PAGE_SIZE),
      });
      if (section === ORDER_LIFECYCLE_SECTIONS.ALL) {
        if (period) params.set("period", period);
      } else if (section === ORDER_LIFECYCLE_SECTIONS.RETURNS) {
        if (shippingStatus !== "all") params.set("shippingStatus", shippingStatus);
        if (validation !== "all") params.set("validation", validation);
      } else if (section === ORDER_LIFECYCLE_SECTIONS.DELIVERED) {
        if (employeeId) params.set("employeeId", employeeId);
        if (deliveryDate !== "all") params.set("deliveryDate", deliveryDate);
        if (deliveryDate === "customDate" && customDate) params.set("customDate", customDate);
        if (deliveryDate === "customRange") {
          if (customStart) params.set("customStart", customStart);
          if (customEnd) params.set("customEnd", customEnd);
        }
      }
      return fetch(`/api/returns?${params.toString()}`, { signal }).then(async (res) => {
        const body = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(body?.error || "Could not load orders.");
        return body;
      });
    },
    [section, period, shippingStatus, validation, employeeId, deliveryDate, customDate, customStart, customEnd, page]
  );

  useEffect(() => {
    const controller = new AbortController();
    load(controller.signal)
      .then((body) => {
        setData(body);
        setState("ready");
      })
      .catch((error) => {
        if (error?.name === "AbortError") return;
        setErrorMessage(error?.message || "Could not load orders.");
        setState("error");
      });
    return () => controller.abort();
  }, [load]);

  // One-time, lightweight background sync right after the page's first
  // load — never re-triggered by a section/filter/page change. See the
  // module comment's "fast page loading" note.
  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/returns/sync", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ full: false }),
      signal: controller.signal,
    })
      .then((res) => (res.ok ? load(controller.signal) : null))
      .then((body) => {
        if (body) setData(body);
      })
      .catch(() => {})
      .finally(() => setSyncing(false));
    return () => controller.abort();
    // Intentionally once-only (mount), not on every `load` identity change —
    // see the module comment.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleSyncNow() {
    setSyncing(true);
    try {
      const res = await fetch("/api/returns/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ full: true }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body?.error || "Synchronization failed.");
      }
      const body = await load();
      setData(body);
      setState("ready");
    } catch (error) {
      window.alert(error?.message || "Synchronization failed.");
    } finally {
      setSyncing(false);
    }
  }

  // Validate/unvalidate remain Returns-section-only actions (see
  // ReturnCard's `section` prop below, which is what actually hides the
  // buttons on All/Delivered — these handlers are simply never reachable
  // from those sections' cards).
  async function handleValidate(id) {
    if (!window.confirm("Confirm you have physically received this returned package?")) return;
    setPendingIds((current) => new Set(current).add(id));
    try {
      const res = await fetch(`/api/returns/${id}/validate`, { method: "POST" });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body?.error || "Could not validate this return.");
      setData((current) => ({
        ...current,
        returns: current.returns.map((item) => (item.id === id ? body.order : item)),
      }));
    } catch (error) {
      window.alert(error?.message || "Could not validate this return.");
    } finally {
      setPendingIds((current) => {
        const next = new Set(current);
        next.delete(id);
        return next;
      });
    }
  }

  async function handleUnvalidate(id) {
    if (!window.confirm("Mark this return as pending again?")) return;
    setPendingIds((current) => new Set(current).add(id));
    try {
      const res = await fetch(`/api/returns/${id}/unvalidate`, { method: "POST" });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body?.error || "Could not update this return.");
      setData((current) => ({
        ...current,
        returns: current.returns.map((item) => (item.id === id ? body.order : item)),
      }));
    } catch (error) {
      window.alert(error?.message || "Could not update this return.");
    } finally {
      setPendingIds((current) => {
        const next = new Set(current);
        next.delete(id);
        return next;
      });
    }
  }

  const counts = data.counts ?? { all: 0, delivered: 0, returns: 0 };

  return (
    <div>
      <div
        role="tablist"
        aria-label="Order section"
        className="mb-4 inline-flex flex-wrap gap-1 rounded-xl border border-zinc-200 bg-zinc-100 p-1 dark:border-zinc-800 dark:bg-zinc-900"
      >
        {ORDER_LIFECYCLE_SECTION_VALUES.map((value) => {
          const active = value === section;
          return (
            <button
              key={value}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => setSection(value)}
              className={`rounded-lg px-3 py-1.5 text-xs font-medium transition sm:text-sm ${
                active
                  ? "bg-white text-zinc-900 shadow-sm dark:bg-zinc-950 dark:text-zinc-50"
                  : "text-zinc-500 hover:text-zinc-700 dark:text-zinc-400 dark:hover:text-zinc-200"
              }`}
            >
              {ORDER_LIFECYCLE_SECTION_LABELS[value]} ({counts[value] ?? 0})
            </button>
          );
        })}
      </div>

      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        {section === ORDER_LIFECYCLE_SECTIONS.ALL ? (
          <div className="flex flex-col gap-1">
            <span className="text-xs font-medium text-zinc-500 dark:text-zinc-400">Month</span>
            <MonthSelect value={period} onChange={setPeriod} allowAll />
          </div>
        ) : section === ORDER_LIFECYCLE_SECTIONS.RETURNS ? (
          <ReturnsFilters
            shippingStatus={shippingStatus}
            onShippingStatusChange={setShippingStatus}
            validation={validation}
            onValidationChange={setValidation}
          />
        ) : (
          <DeliveredFilters
            employees={employees}
            employeeId={employeeId}
            onEmployeeChange={setEmployeeId}
            deliveryDate={deliveryDate}
            onDeliveryDateChange={setDeliveryDate}
            customDate={customDate}
            onCustomDateChange={setCustomDate}
            customStart={customStart}
            onCustomStartChange={setCustomStart}
            customEnd={customEnd}
            onCustomEndChange={setCustomEnd}
          />
        )}
        <button
          type="button"
          onClick={handleSyncNow}
          disabled={syncing}
          className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-zinc-300 px-3 py-1.5 text-xs font-medium text-zinc-700 transition hover:bg-zinc-100 disabled:cursor-not-allowed disabled:opacity-60 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-800"
        >
          {syncing ? <Spinner /> : null}
          {syncing ? "Syncing…" : "Sync now"}
        </button>
      </div>

      {state === "loading" ? (
        <div className="flex items-center justify-center gap-2 rounded-2xl border border-dashed border-zinc-300 px-6 py-14 text-sm text-zinc-500 dark:border-zinc-700 dark:text-zinc-400">
          <Spinner />
          Loading...
        </div>
      ) : state === "error" ? (
        <ErrorBanner>{errorMessage}</ErrorBanner>
      ) : data.returns.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-zinc-300 px-6 py-14 text-center text-sm text-zinc-500 dark:border-zinc-700 dark:text-zinc-400">
          {EMPTY_MESSAGE[section] ?? "No orders found"}
        </p>
      ) : (
        <>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            {data.returns.map((item) => (
              <ReturnCard
                key={item.id}
                item={item}
                section={section}
                pending={pendingIds.has(item.id)}
                onValidate={() => handleValidate(item.id)}
                onUnvalidate={() => handleUnvalidate(item.id)}
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
        </>
      )}
    </div>
  );
}

function Row({ label, children }) {
  return (
    <div className="flex gap-2 py-0.5 text-sm">
      <span className="w-28 shrink-0 text-zinc-500 dark:text-zinc-400">{label}</span>
      <span className="min-w-0 flex-1 break-words font-medium text-zinc-900 dark:text-zinc-100">{children}</span>
    </div>
  );
}

function ReturnCard({ item, section, pending, onValidate, onUnvalidate }) {
  const providerLabel = PROVIDER_LABEL[item.provider] ?? item.provider;
  const isValidated = item.returnValidationStatus === "validated";
  // "Validate Return"/"Mark as Pending" and the Pending/Validated badge are
  // ONLY ever shown for the Returns section — an order in All/Delivered
  // that happens to carry a leftover "pending" default is not a return at
  // all, so showing that badge/action there would be meaningless (see this
  // file's module comment).
  const isReturnsSection = section === ORDER_LIFECYCLE_SECTIONS.RETURNS;
  const isDeliveredSection = section === ORDER_LIFECYCLE_SECTIONS.DELIVERED;

  // "Open Order" reuses the Orders page's own existing filters, same
  // pattern as Follow-up's own card (app/_components/track/FollowUpList.jsx).
  const openOrderHref = `/dashboard/orders?${new URLSearchParams({
    provider: item.provider,
    ...(item.employee ? { employee: item.employee.id } : {}),
    ...(item.phone ? { phone: item.phone } : {}),
  }).toString()}`;

  return (
    <div className="flex w-full flex-col overflow-hidden rounded-2xl border border-zinc-200 bg-white p-4 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
      <div className="mb-2 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-zinc-900 dark:text-zinc-50">{item.receiver}</p>
          {item.phone ? (
            <a href={`tel:${item.phone}`} className="truncate text-xs text-blue-600 dark:text-blue-400">
              {item.phone}
            </a>
          ) : null}
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1">
          {item.provider === SHIPPING_PROVIDERS.OZON_EXPRESS ? (
            <StatusBadge status={item.status} />
          ) : (
            <span className="inline-flex items-center gap-1 whitespace-nowrap rounded-full bg-zinc-100 px-2.5 py-0.5 text-xs font-semibold text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300">
              {item.status || "Unknown"}
            </span>
          )}
          {isReturnsSection ? (
            <span
              className={`inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-semibold ${
                isValidated
                  ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300"
                  : "bg-amber-100 text-amber-700 dark:bg-amber-950/50 dark:text-amber-300"
              }`}
            >
              {isValidated ? "Validated" : "Pending"}
            </span>
          ) : null}
        </div>
      </div>

      <div className="divide-y divide-zinc-100 text-sm dark:divide-zinc-800">
        <Row label="City">{item.city}</Row>
        <Row label="Address">{item.address}</Row>
        <Row label="Price">{item.price != null ? `${item.price} DH` : "—"}</Row>
        {item.employee ? <Row label="Employee">{item.employee.name}</Row> : null}
        <Row label="Shipping Company">{providerLabel}</Row>
        <Row label="Tracking Number">
          <span className="break-all font-mono text-xs">{item.trackingNumber}</span>
        </Row>
        <Row label="Created">{dateTimeFormatter.format(new Date(item.createdAt))}</Row>
        <Row label="Last Updated">{dateTimeFormatter.format(new Date(item.updatedAt))}</Row>
        {isDeliveredSection && item.deliveredAt ? (
          <Row label="Delivered At">{dateTimeFormatter.format(new Date(item.deliveredAt))}</Row>
        ) : null}
        {isReturnsSection && isValidated && item.returnValidatedAt ? (
          <Row label="Validated At">
            {dateTimeFormatter.format(new Date(item.returnValidatedAt))}
            {item.returnValidatedBy?.name ? ` · ${item.returnValidatedBy.name}` : ""}
          </Row>
        ) : null}
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <Link
          href={openOrderHref}
          className="rounded-lg border border-zinc-300 px-3 py-1.5 text-xs font-medium text-zinc-700 transition hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-800"
        >
          Open Order
        </Link>
        {isReturnsSection ? (
          isValidated ? (
            <button
              type="button"
              onClick={onUnvalidate}
              disabled={pending}
              className="rounded-lg border border-zinc-300 px-3 py-1.5 text-xs font-medium text-zinc-700 transition hover:bg-zinc-100 disabled:cursor-not-allowed disabled:opacity-60 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-800"
            >
              Mark as Pending
            </button>
          ) : (
            <button
              type="button"
              onClick={onValidate}
              disabled={pending}
              className="rounded-lg border border-emerald-300 px-3 py-1.5 text-xs font-medium text-emerald-700 transition hover:bg-emerald-50 disabled:cursor-not-allowed disabled:opacity-60 dark:border-emerald-800 dark:text-emerald-300 dark:hover:bg-emerald-950/40"
            >
              {pending ? "Validating…" : "Validate Return"}
            </button>
          )
        ) : null}
      </div>
    </div>
  );
}
