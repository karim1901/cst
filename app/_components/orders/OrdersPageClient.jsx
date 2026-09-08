"use client";

import { useState } from "react";

import ProviderTabs from "@/app/_components/orders/ProviderTabs";
import OrderFilters from "@/app/_components/orders/OrderFilters";
import OrdersBrowser from "@/app/_components/orders/OrdersBrowser";
import OzonOrdersList from "@/app/_components/orders/OzonOrdersList";
import QuickOrdersList from "@/app/_components/orders/QuickOrdersList";
import { SHIPPING_PROVIDERS } from "@/lib/shipping/providers";
import { periodFor } from "@/lib/tracking/counter";

/**
 * Composes the Orders page: a provider tab switcher (everyone), plus —
 * merchants only — an employee/month filter. See app/dashboard/orders/
 * page.jsx for the server-side data (employees list) this receives, and
 * this folder's ProviderTabs/OrderFilters/OrdersBrowser for the pieces.
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
  const [provider, setProvider] = useState(SHIPPING_PROVIDERS.OZON_EXPRESS);
  const [employeeFilter, setEmployeeFilter] = useState("me");
  const [period, setPeriod] = useState(() => periodFor());

  const viewingEmployeeId = employeeFilter !== "me" && employeeFilter !== "all" ? employeeFilter : null;

  return (
    <div>
      <div className="mb-4 flex flex-col gap-3">
        <ProviderTabs value={provider} onChange={setProvider} />
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
        <OrdersBrowser provider={provider} employeeId={null} period={period} />
      ) : provider === SHIPPING_PROVIDERS.OZON_EXPRESS ? (
        <OzonOrdersList
          employeeId={viewingEmployeeId}
          period={isMerchant ? period : undefined}
          onPeriodChange={isMerchant ? setPeriod : undefined}
        />
      ) : (
        <QuickOrdersList
          employeeId={viewingEmployeeId}
          period={isMerchant ? period : undefined}
          onPeriodChange={isMerchant ? setPeriod : undefined}
        />
      )}
    </div>
  );
}
