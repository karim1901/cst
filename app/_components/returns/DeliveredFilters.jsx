"use client";

import { DELIVERY_DATE_FILTER_VALUES } from "@/lib/returns/constants";
import { useLocale } from "@/app/_components/i18n/LocaleProvider";

// Same select styling convention as app/_components/orders/OrderFilters.jsx/
// MonthSelect.jsx, reused here rather than introducing a new input style.
const SELECT =
  "h-10 rounded-lg border border-zinc-300 bg-white px-3 text-sm text-zinc-900 shadow-sm outline-none transition focus:border-zinc-900 focus:ring-2 focus:ring-zinc-900/10 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-100 dark:focus:border-zinc-100 dark:focus:ring-zinc-100/10";

function Field({ label, children }) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-xs font-medium text-zinc-500 dark:text-zinc-400">{label}</span>
      {children}
    </div>
  );
}

/**
 * Delivered-section-only filters: which employee, and which delivery date
 * range — see the Delivered section's own comment in ReturnsList.jsx for
 * why both are always matched against `Order.deliveredAt`, never
 * `createdAt`, and combine (AND, not OR) with each other. Employees are
 * loaded dynamically from the merchant's own list
 * (app/dashboard/returns/page.jsx) — never hardcoded.
 */
export default function DeliveredFilters({
  employees,
  employeeId,
  onEmployeeChange,
  deliveryDate,
  onDeliveryDateChange,
  customDate,
  onCustomDateChange,
  customStart,
  onCustomStartChange,
  customEnd,
  onCustomEndChange,
}) {
  const { t } = useLocale();

  const dateLabels = {
    all: t("returnsFilters.dateAll"),
    today: t("returnsFilters.dateToday"),
    yesterday: t("returnsFilters.dateYesterday"),
    last7: t("returnsFilters.dateLast7"),
    customDate: t("returnsFilters.dateCustomDate"),
    customRange: t("returnsFilters.dateCustomRange"),
  };

  return (
    <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-end">
      <Field label={t("returnsFilters.employee")}>
        <select
          aria-label={t("returnsFilters.employee")}
          value={employeeId ?? ""}
          onChange={(event) => onEmployeeChange(event.target.value || null)}
          className={SELECT}
        >
          <option value="">{t("returnsFilters.allEmployees")}</option>
          {employees.map((employee) => (
            <option key={employee.id} value={employee.id}>
              {employee.name}
            </option>
          ))}
        </select>
      </Field>

      <Field label={t("returnsFilters.deliveryDate")}>
        <select
          aria-label={t("returnsFilters.deliveryDate")}
          value={deliveryDate}
          onChange={(event) => onDeliveryDateChange(event.target.value)}
          className={SELECT}
        >
          {DELIVERY_DATE_FILTER_VALUES.map((value) => (
            <option key={value} value={value}>
              {dateLabels[value] ?? value}
            </option>
          ))}
        </select>
      </Field>

      {deliveryDate === "customDate" ? (
        <Field label={t("returnsFilters.date")}>
          <input
            type="date"
            aria-label={t("returnsFilters.customDeliveryDate")}
            value={customDate}
            onChange={(event) => onCustomDateChange(event.target.value)}
            className={SELECT}
          />
        </Field>
      ) : null}

      {deliveryDate === "customRange" ? (
        <>
          <Field label={t("returnsFilters.from")}>
            <input
              type="date"
              aria-label={t("returnsFilters.customRangeStart")}
              value={customStart}
              onChange={(event) => onCustomStartChange(event.target.value)}
              className={SELECT}
            />
          </Field>
          <Field label={t("returnsFilters.to")}>
            <input
              type="date"
              aria-label={t("returnsFilters.customRangeEnd")}
              value={customEnd}
              onChange={(event) => onCustomEndChange(event.target.value)}
              className={SELECT}
            />
          </Field>
        </>
      ) : null}
    </div>
  );
}
