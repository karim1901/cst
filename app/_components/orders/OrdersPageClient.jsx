"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";

import ProviderTabs from "@/app/_components/orders/ProviderTabs";
import StatusFilter from "@/app/_components/orders/StatusFilter";
import OrderFilters from "@/app/_components/orders/OrderFilters";
import MonthSelect from "@/app/_components/orders/MonthSelect";
import OrdersSearch from "@/app/_components/orders/OrdersSearch";
import OrdersSearchResults from "@/app/_components/orders/OrdersSearchResults";
import OrdersBrowser from "@/app/_components/orders/OrdersBrowser";
import OzonOrdersList from "@/app/_components/orders/OzonOrdersList";
import QuickOrdersList from "@/app/_components/orders/QuickOrdersList";
import { useLocale } from "@/app/_components/i18n/LocaleProvider";
import { SHIPPING_PROVIDERS, SHIPPING_PROVIDER_VALUES } from "@/lib/shipping/providers";
import { periodFor } from "@/lib/tracking/counter";
import { ORDER_SEARCH_MODES } from "@/lib/orders/search";

function followUpKey(provider, trackingNumber) {
  return `${provider}|${trackingNumber}`;
}

const SEARCH_DEBOUNCE_MS = 350;

/**
 * Composes the Orders page: a provider tab switcher and status filter
 * (everyone), a month picker, a two-mode search bar (phone / tracking), and
 * — merchants only — an employee filter, plus the Follow-up "add" affordance
 * on every card.
 *
 * The search bar is authoritative when it has a value: it replaces the
 * normal listing with server-side results (app/api/orders/search) that
 * respect the SAME provider / month / employee / status selections. Clearing
 * it restores the normal filtered list with every other selection intact.
 * The live progressive lists (OzonOrdersList / QuickOrdersList) and the
 * local-DB "All employees" browser (OrdersBrowser) are unchanged — they
 * only render while no search is active.
 *
 * `employeeFilter` drives which data source the NON-search view uses:
 *   "me"          -> the caller's own live tracking sequence.
 *   one employeeId -> that employee's own live tracking sequence.
 *   "all"         -> every employee, from the local DB (OrdersBrowser).
 */
export default function OrdersPageClient({ isMerchant, employees }) {
  const { t } = useLocale();

  // Deep-link seed, read once on mount (not kept in sync afterwards) — same
  // as this page has always done for Follow-up's "Open Order"
  // (?provider=&employee=&phone=). Now also seeds the search bar: an
  // explicit ?search=&searchMode=, or the legacy ?phone= alias.
  const searchParams = useSearchParams();
  const initialProvider = searchParams.get("provider");
  const initialEmployee = searchParams.get("employee");
  const legacyPhone = searchParams.get("phone");
  const urlSearch = searchParams.get("search");
  const urlSearchMode = searchParams.get("searchMode");

  const [provider, setProvider] = useState(
    initialProvider && SHIPPING_PROVIDER_VALUES.includes(initialProvider)
      ? initialProvider
      : SHIPPING_PROVIDERS.OZON_EXPRESS
  );
  const [employeeFilter, setEmployeeFilter] = useState(
    isMerchant && initialEmployee ? initialEmployee : "me"
  );
  const [period, setPeriod] = useState(() => periodFor());
  const [status, setStatus] = useState("all");

  // --- search state --------------------------------------------------
  const seededValue = (urlSearch ?? legacyPhone ?? "").trim();
  const [searchMode, setSearchMode] = useState(
    ORDER_SEARCH_MODES.includes(urlSearchMode) ? urlSearchMode : "phone"
  );
  const [searchInput, setSearchInput] = useState(seededValue);
  // The debounced/submitted value actually sent to the server.
  const [searchQuery, setSearchQuery] = useState(seededValue);

  // Debounce typing -> query (Enter / Clear / mode-change bypass this).
  useEffect(() => {
    const id = setTimeout(() => setSearchQuery(searchInput.trim()), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(id);
  }, [searchInput]);

  // Keep the search in the URL so a refresh preserves it — the same
  // seed-from-URL contract this page already uses for provider/employee,
  // via replaceState so it doesn't push history or refetch anything else.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    if (searchQuery) {
      params.set("search", searchQuery);
      params.set("searchMode", searchMode);
    } else {
      params.delete("search");
      params.delete("searchMode");
    }
    params.delete("phone"); // legacy alias — normalise onto ?search
    const qs = params.toString();
    window.history.replaceState(null, "", qs ? `?${qs}` : window.location.pathname);
  }, [searchQuery, searchMode]);

  function handleSearchSubmit() {
    setSearchQuery(searchInput.trim());
  }
  function handleSearchModeChange(nextMode) {
    setSearchMode(nextMode);
    // Re-run immediately in the new mode if there's something to search for.
    if (searchInput.trim()) setSearchQuery(searchInput.trim());
  }
  function handleSearchClear() {
    setSearchInput("");
    setSearchQuery("");
  }

  const isSearching = searchQuery.length > 0;

  // --- Follow-up set, fetched once ---------------------------------
  // Both merchants and employees have their OWN follow-up list now; the
  // API scopes GET to the authenticated owner, so this is the caller's
  // own set of already-followed-up orders either way.
  const [followUpKeys, setFollowUpKeys] = useState(null);

  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/order-followups", { signal: controller.signal })
      .then(async (res) => {
        const data = await res.json().catch(() => ({}));
        if (!res.ok) return;
        const keys = new Set(
          (data.followUps ?? []).map((item) =>
            followUpKey(item.provider, item.order?.trackingNumber)
          )
        );
        setFollowUpKeys(keys);
      })
      .catch((error) => {
        if (error?.name !== "AbortError") {
          // A follow-up-status hiccup must never break the Orders page.
        }
      });
    return () => controller.abort();
  }, []);

  function isFollowedUp(trackingNumber) {
    return followUpKeys?.has(followUpKey(provider, trackingNumber)) ?? false;
  }

  // Automatic background reconciliation (item 2/27) — fires ONCE, silently,
  // right after the Orders page loads, so a provider-deleted order is
  // detected without the merchant ever visiting Returns or clicking a
  // "Sync" button. Reuses the SAME endpoint/mechanism the Returns page's
  // own background sync already calls (lib/returns/sync.js#
  // syncReturnsForMerchant, `full: false` — current month, both providers)
  // rather than a second, disconnected sync path. Merchant-only, matching
  // that endpoint's own existing authorization boundary — an employee
  // session simply skips this call (their merchant's own visit to any page
  // that triggers it keeps everyone's data fresh; the scheduled cron job,
  // app/api/cron/reconcile-ozon, is the reliable backstop either way, not
  // dependent on any page ever being opened). Fire-and-forget: never blocks
  // rendering, never shown to the user, a failure here is silently ignored
  // (the already-loaded live/local data is still shown normally).
  useEffect(() => {
    if (!isMerchant) return;
    const controller = new AbortController();
    fetch("/api/returns/sync", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ full: false }),
      signal: controller.signal,
    }).catch(() => {});
    return () => controller.abort();
    // Intentionally once-only (mount) — never re-triggered by a filter/tab
    // change, same rule as the Returns page's own identical effect.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function handleFollowUpAdded(trackingNumber) {
    setFollowUpKeys((current) => {
      const next = new Set(current);
      next.add(followUpKey(provider, trackingNumber));
      return next;
    });
  }

  const viewingEmployeeId =
    employeeFilter !== "me" && employeeFilter !== "all" ? employeeFilter : null;

  // Follow-up is available to both roles now — a merchant adds to their own
  // merchant list, an employee to their own employee list (the server
  // decides the owner from the session). The set here is always the
  // caller's own already-followed-up orders.
  const followUpProps = {
    followUpSet: followUpKeys,
    isFollowedUp,
    onFollowUpAdded: handleFollowUpAdded,
  };

  // Which employee scope the search endpoint should apply (merchants only —
  // an employee is always scoped to themselves server-side). "all" -> send
  // nothing (every employee); "me" or an id -> send it.
  const searchEmployeeId = isMerchant && employeeFilter !== "all" ? employeeFilter : undefined;

  return (
    <div>
      <header className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
            {t("orders.title")}
          </h1>
          <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
            {isMerchant ? t("orders.subtitleMerchant") : t("orders.subtitleEmployee")}
          </p>
        </div>
        <Link
          href="/dashboard/orders/new"
          className="inline-flex shrink-0 items-center gap-1.5 rounded-lg bg-zinc-900 px-4 py-2 text-sm font-semibold text-white transition hover:bg-zinc-800 dark:bg-white dark:text-black dark:hover:bg-zinc-200"
        >
          {t("orders.addOrder")}
        </Link>
      </header>

      <div className="mb-4 flex flex-col gap-3">
        <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center">
          <ProviderTabs value={provider} onChange={setProvider} />
          <StatusFilter value={status} onChange={setStatus} />
        </div>
        {isMerchant ? (
          <OrderFilters
            employees={employees}
            employeeFilter={employeeFilter}
            onEmployeeChange={setEmployeeFilter}
            period={period}
            onPeriodChange={setPeriod}
          />
        ) : (
          <MonthSelect value={period} onChange={setPeriod} />
        )}
        <OrdersSearch
          mode={searchMode}
          value={searchInput}
          onModeChange={handleSearchModeChange}
          onValueChange={setSearchInput}
          onSubmit={handleSearchSubmit}
          onClear={handleSearchClear}
        />
      </div>

      {isSearching ? (
        <OrdersSearchResults
          provider={provider}
          employeeId={searchEmployeeId}
          period={period}
          status={status}
          searchMode={searchMode}
          search={searchQuery}
          {...followUpProps}
        />
      ) : isMerchant && employeeFilter === "all" ? (
        <OrdersBrowser
          provider={provider}
          employeeId={null}
          period={period}
          status={status}
          {...followUpProps}
        />
      ) : (
        // BOTH provider lists stay mounted; only the selected one is
        // visible. Each streams its month ONCE, the first time it becomes
        // active, and keeps that dataset afterwards — so switching Ozon <->
        // Quick within the page session never re-streams an already-loaded
        // provider (a full browser refresh still fetches fresh). The status
        // tab filters each list's loaded dataset locally (see the list
        // components) — it never refetches either.
        <>
          <div hidden={provider !== SHIPPING_PROVIDERS.OZON_EXPRESS}>
            <OzonOrdersList
              active={provider === SHIPPING_PROVIDERS.OZON_EXPRESS}
              employeeId={viewingEmployeeId}
              period={period}
              onPeriodChange={setPeriod}
              status={status}
              {...followUpProps}
            />
          </div>
          <div hidden={provider !== SHIPPING_PROVIDERS.QUICK_LIVRAISON}>
            <QuickOrdersList
              active={provider === SHIPPING_PROVIDERS.QUICK_LIVRAISON}
              employeeId={viewingEmployeeId}
              period={period}
              onPeriodChange={setPeriod}
              status={status}
              {...followUpProps}
            />
          </div>
        </>
      )}
    </div>
  );
}
