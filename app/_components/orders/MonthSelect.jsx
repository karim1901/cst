"use client";

import { useLocale } from "@/app/_components/i18n/LocaleProvider";

// Simple "YYYYMM" month picker for the Orders list — lets an employee/
// merchant select which month's tracking-number range to fetch (see
// app/api/orders/{ozon,quick}/route.js's `?period=` param). Local-only
// state, no fetching of its own.
//
// The month LABEL ("September 2026" / "سبتمبر 2026") is formatted with the
// ACTIVE locale via Intl.DateTimeFormat — never a hardcoded "en-US" — so
// it reads in the same language as the rest of the UI. The underlying
// VALUE ("202609") is unchanged; only its human-readable rendering is
// localized (this is locale-aware DATE FORMATTING, not translating a
// stored business value).

function lastTwelvePeriods(now = new Date()) {
  const periods = [];
  const cursor = new Date(now.getFullYear(), now.getMonth(), 1);
  for (let i = 0; i < 12; i++) {
    const year = cursor.getFullYear();
    const month = String(cursor.getMonth() + 1).padStart(2, "0");
    periods.push({ value: `${year}${month}`, date: new Date(cursor) });
    cursor.setMonth(cursor.getMonth() - 1);
  }
  return periods;
}

// `allowAll` prepends an "All Months" option (value `""`) — opt-in, off by
// default, so every existing caller (the Orders page) keeps its exact
// current behavior unchanged.
export default function MonthSelect({ value, onChange, disabled, allowAll = false }) {
  const { locale, t } = useLocale();
  const fmt = new Intl.DateTimeFormat(locale === "ar" ? "ar" : "en-US", {
    month: "long",
    year: "numeric",
  });

  const periods = lastTwelvePeriods().map((p) => ({ value: p.value, label: fmt.format(p.date) }));
  const withAll = allowAll ? [{ value: "", label: t("common.allMonths") }, ...periods] : periods;
  // The currently-selected period might not be one of the last 12 (an old
  // link, a bookmark) — keep it selectable/visible rather than silently
  // snapping to something else.
  const options = withAll.some((p) => p.value === value)
    ? withAll
    : [{ value, label: value }, ...withAll];

  return (
    <select
      value={value}
      onChange={(event) => onChange(event.target.value)}
      disabled={disabled}
      aria-label={t("common.month")}
      className="h-10 shrink-0 rounded-lg border border-zinc-300 bg-white px-3 text-sm text-zinc-900 shadow-sm outline-none transition focus:border-zinc-900 focus:ring-2 focus:ring-zinc-900/10 disabled:opacity-60 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-100 dark:focus:border-zinc-100 dark:focus:ring-zinc-100/10"
    >
      {options.map((period) => (
        <option key={period.value} value={period.value}>
          {period.label}
        </option>
      ))}
    </select>
  );
}
