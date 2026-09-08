"use client";

import {
  SHIPPING_STATUS_FILTER_VALUES,
  SHIPPING_STATUS_LABELS,
  RETURN_VALIDATION_FILTER_VALUES,
  VALIDATION_LABELS,
} from "@/lib/returns/constants";

/**
 * One pill group — same visual language as
 * app/_components/orders/StatusFilter.jsx, generalized to take any option
 * list/labels since the Returns page needs two independent groups
 * (shipping status + return validation) rather than one.
 */
function Pills({ label, options, labels, value, onChange }) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-xs font-medium text-zinc-500 dark:text-zinc-400">{label}</span>
      <div
        role="tablist"
        aria-label={label}
        className="inline-flex flex-wrap gap-1 rounded-xl border border-zinc-200 bg-zinc-100 p-1 dark:border-zinc-800 dark:bg-zinc-900"
      >
        {options.map((option) => {
          const active = option === value;
          return (
            <button
              key={option}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => onChange(option)}
              className={`rounded-lg px-3 py-1.5 text-xs font-medium transition sm:text-sm ${
                active
                  ? "bg-white text-zinc-900 shadow-sm dark:bg-zinc-950 dark:text-zinc-50"
                  : "text-zinc-500 hover:text-zinc-700 dark:text-zinc-400 dark:hover:text-zinc-200"
              }`}
            >
              {labels[option]}
            </button>
          );
        })}
      </div>
    </div>
  );
}

/**
 * The two filters combine — see lib/returns/list.js's queryReturnsForMerchant,
 * which ANDs them together server-side (both narrow the same MongoDB query,
 * never two separate client-side passes).
 */
export default function ReturnsFilters({
  shippingStatus,
  onShippingStatusChange,
  validation,
  onValidationChange,
}) {
  return (
    <div className="flex flex-wrap items-end gap-4">
      <Pills
        label="Shipping Status"
        options={SHIPPING_STATUS_FILTER_VALUES}
        labels={SHIPPING_STATUS_LABELS}
        value={shippingStatus}
        onChange={onShippingStatusChange}
      />
      <Pills
        label="Return Status"
        options={RETURN_VALIDATION_FILTER_VALUES}
        labels={VALIDATION_LABELS}
        value={validation}
        onChange={onValidationChange}
      />
    </div>
  );
}
