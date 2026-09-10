"use client";

import MonthSelect from "@/app/_components/orders/MonthSelect";
import { useLocale } from "@/app/_components/i18n/LocaleProvider";

const SELECT =
  "h-10 rounded-lg border border-zinc-300 bg-white px-3 text-sm text-zinc-900 shadow-sm outline-none transition focus:border-zinc-900 focus:ring-2 focus:ring-zinc-900/10 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-100 dark:focus:border-zinc-100 dark:focus:ring-zinc-100/10";

/**
 * Merchant-only Orders-page filters: which employee, and which month.
 * `employeeFilter` is one of "me" (the merchant's own tracking sequence),
 * "all" (every employee, browsed from the local DB — see
 * app/_components/orders/OrdersBrowser.jsx), or one employee's id (that
 * employee's own live tracking sequence). See app/dashboard/orders/page.jsx
 * for how each value maps to a data source.
 *
 * Employee NAMES/usernames in the <option> list are real business data —
 * shown verbatim, never translated. Only the two synthetic options ("My
 * own orders" / "All employees") and the field label are static UI text.
 */
export default function OrderFilters({ employees, employeeFilter, onEmployeeChange, period, onPeriodChange, disabled }) {
  const { t } = useLocale();

  return (
    <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
      <select
        aria-label={t("common.employee")}
        value={employeeFilter}
        onChange={(event) => onEmployeeChange(event.target.value)}
        disabled={disabled}
        className={SELECT}
      >
        <option value="me">{t("orders.myOwnOrders")}</option>
        <option value="all">{t("orders.allEmployees")}</option>
        {employees.map((employee) => (
          <option key={employee.id} value={employee.id}>
            {employee.name} (@{employee.username})
          </option>
        ))}
      </select>

      <MonthSelect value={period} onChange={onPeriodChange} disabled={disabled} />
    </div>
  );
}
