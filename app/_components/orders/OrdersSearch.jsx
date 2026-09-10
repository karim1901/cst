"use client";

import { useLocale } from "@/app/_components/i18n/LocaleProvider";

const MODES = ["phone", "tracking"];

/**
 * The Orders-page search bar: a two-mode selector (phone number / tracking
 * number) + one input + a Clear button. Purely presentational and fully
 * controlled — the parent (OrdersPageClient) owns the mode and value,
 * debounces the value, keeps it in the URL, and runs the actual
 * server-side search (app/api/orders/search). Nothing here is a data
 * source.
 *
 * The two mode labels, the placeholder and the Clear label are the only
 * static UI text — no phone/tracking/customer/employee value is ever
 * translated. The placeholder switches with the selected mode.
 *
 * Layout is mobile-first: the two mode buttons sit on their own row and
 * split the width on a narrow screen, the input is always full width, and
 * the Clear button is an absolutely-positioned overlay — so the bar never
 * causes horizontal scrolling and never grows tall. `pe-*` / `end-*` are
 * logical properties, so the Clear button lands on the correct side under
 * RTL too.
 */
export default function OrdersSearch({
  mode,
  value,
  onModeChange,
  onValueChange,
  onSubmit,
  onClear,
}) {
  const { t } = useLocale();
  const placeholder = mode === "tracking" ? t("orders.searchByTracking") : t("orders.searchByPhone");

  return (
    <div className="flex flex-col gap-2">
      <div
        role="tablist"
        aria-label={t("common.search")}
        className="inline-flex w-full flex-wrap gap-1 rounded-xl border border-zinc-200 bg-zinc-100 p-1 sm:w-auto dark:border-zinc-800 dark:bg-zinc-900"
      >
        {MODES.map((m) => {
          const active = m === mode;
          return (
            <button
              key={m}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => onModeChange(m)}
              className={`flex-1 whitespace-nowrap rounded-lg px-3 py-1.5 text-xs font-medium transition sm:flex-none sm:text-sm ${
                active
                  ? "bg-white text-zinc-900 shadow-sm dark:bg-zinc-950 dark:text-zinc-50"
                  : "text-zinc-500 hover:text-zinc-700 dark:text-zinc-400 dark:hover:text-zinc-200"
              }`}
            >
              {m === "tracking" ? t("orders.searchModeTracking") : t("orders.searchModePhone")}
            </button>
          );
        })}
      </div>

      <div className="relative">
        <input
          type="search"
          inputMode={mode === "phone" ? "tel" : "text"}
          value={value}
          onChange={(event) => onValueChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              onSubmit();
            }
          }}
          placeholder={placeholder}
          className="h-10 w-full rounded-lg border border-zinc-300 bg-white px-4 pe-10 text-sm text-zinc-900 shadow-sm outline-none transition focus:border-zinc-900 focus:ring-2 focus:ring-zinc-900/10 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-100 dark:focus:border-zinc-100 dark:focus:ring-zinc-100/10"
        />
        {value ? (
          <button
            type="button"
            onClick={onClear}
            aria-label={t("common.clear")}
            title={t("common.clear")}
            className="absolute inset-y-0 end-1 my-auto grid h-7 w-7 place-items-center rounded-md text-zinc-400 transition hover:bg-zinc-100 hover:text-zinc-700 dark:hover:bg-zinc-800 dark:hover:text-zinc-200"
          >
            <svg
              viewBox="0 0 20 20"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.75"
              className="h-4 w-4"
              aria-hidden="true"
            >
              <path strokeLinecap="round" d="m5 5 10 10M15 5 5 15" />
            </svg>
          </button>
        ) : null}
      </div>
    </div>
  );
}
