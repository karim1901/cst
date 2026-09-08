"use client";

import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";

import ProviderTabs from "@/app/_components/orders/ProviderTabs";
import StatusFilter from "@/app/_components/orders/StatusFilter";
import OrderFilters from "@/app/_components/orders/OrderFilters";
import OrdersBrowser from "@/app/_components/orders/OrdersBrowser";
import OzonOrdersList from "@/app/_components/orders/OzonOrdersList";
import QuickOrdersList from "@/app/_components/orders/QuickOrdersList";
import { SHIPPING_PROVIDERS, SHIPPING_PROVIDER_VALUES } from "@/lib/shipping/providers";
import { periodFor } from "@/lib/tracking/counter";

function followUpKey(provider, trackingNumber) {
  return `${provider}|${trackingNumber}`;
}

/**
 * Composes the Orders page: a provider tab switcher and status filter
 * (everyone), plus — merchants only — an employee/month filter and the
 * Follow-up "add"/"already added" affordance on every card. See
 * app/dashboard/orders/page.jsx for the server-side data (employees list)
 * this receives, and this folder's ProviderTabs/StatusFilter/OrderFilters/
 * OrdersBrowser for the pieces.
 *
 * `employeeFilter` drives which data source is used:
 *   "me"          -> the caller's own live tracking sequence (existing
 *                    OzonOrdersList/QuickOrdersList, unchanged behavior).
 *   one employeeId -> that employee's own live tracking sequence (same
 *                    components, now pointed at a different actor via the
 *                    `employeeId` prop — see those routes' own comments).
 *   "all"         -> every employee, from the local DB (OrdersBrowser) —
 *                    live-fetching every employee one by one would be slow.
 */
export default function OrdersPageClient({ isMerchant, employees }) {
  // Deep-link support for Follow-up's "Open Order" (open the original order) —
  // see app/_components/track/FollowUpList.jsx, which links here with
  // `?provider=&employee=&phone=` instead of building a second order-detail
  // view. Read once, on mount, as plain initial state (not kept in sync
  // afterwards) — this only ever seeds where the page starts, the filters
  // stay normal interactive React state from then on.
  const searchParams = useSearchParams();
  const initialProvider = searchParams.get("provider");
  const initialEmployee = searchParams.get("employee");
  const initialPhone = searchParams.get("phone");

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

  // The merchant's own Follow-up set — fetched once (not per card, not per
  // filter change) so every order card across all three listing surfaces
  // can show "Added to Follow-up" vs. "Add to Follow-up" without an extra
  // request each. Employees never see this feature (see app/api/order-followups/
  // route.js's module comment), so `null` for them — every card treats a
  // `null` set as "don't render the follow-up affordance at all".
  const [followUpKeys, setFollowUpKeys] = useState(null);

  useEffect(() => {
    if (!isMerchant) return;
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
          // A follow-up-status hiccup must never break the Orders page —
          // the "add" button just won't know it's already added until the
          // next successful load; adding again is still safe (see the
          // API's own duplicate-prevention, not just this client hint).
        }
      });
    return () => controller.abort();
  }, [isMerchant]);

  function isFollowedUp(trackingNumber) {
    return followUpKeys?.has(followUpKey(provider, trackingNumber)) ?? false;
  }

  function handleFollowUpAdded(trackingNumber) {
    setFollowUpKeys((current) => {
      const next = new Set(current);
      next.add(followUpKey(provider, trackingNumber));
      return next;
    });
  }

  const viewingEmployeeId = employeeFilter !== "me" && employeeFilter !== "all" ? employeeFilter : null;

  const followUpProps = isMerchant
    ? { followUpSet: followUpKeys, isFollowedUp, onFollowUpAdded: handleFollowUpAdded }
    : { followUpSet: null, isFollowedUp: () => false, onFollowUpAdded: undefined };

  return (
    <div>
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
        ) : null}
      </div>

      {isMerchant && employeeFilter === "all" ? (
        <OrdersBrowser
          provider={provider}
          employeeId={null}
          period={period}
          status={status}
          {...followUpProps}
        />
      ) : provider === SHIPPING_PROVIDERS.OZON_EXPRESS ? (
        <OzonOrdersList
          employeeId={viewingEmployeeId}
          period={isMerchant ? period : undefined}
          onPeriodChange={isMerchant ? setPeriod : undefined}
          status={status}
          initialSearch={initialPhone || undefined}
          {...followUpProps}
        />
      ) : (
        <QuickOrdersList
          employeeId={viewingEmployeeId}
          period={isMerchant ? period : undefined}
          onPeriodChange={isMerchant ? setPeriod : undefined}
          status={status}
          initialSearch={initialPhone || undefined}
          {...followUpProps}
        />
      )}
    </div>
  );
}
