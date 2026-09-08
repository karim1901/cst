"use client";

// Simple "YYYYMM" month picker for the Orders list — lets an employee/
// merchant select which month's tracking-number range to fetch (see
// app/api/orders/{ozon,quick}/route.js's `?period=` param). Local-only
// state, no fetching of its own.

function lastTwelvePeriods(now = new Date()) {
  const periods = [];
  const cursor = new Date(now.getFullYear(), now.getMonth(), 1);
  for (let i = 0; i < 12; i++) {
    const year = cursor.getFullYear();
    const month = String(cursor.getMonth() + 1).padStart(2, "0");
    periods.push({
      value: `${year}${month}`,
      label: cursor.toLocaleDateString("en-US", { month: "long", year: "numeric" }),
    });
    cursor.setMonth(cursor.getMonth() - 1);
  }
  return periods;
}

// `allowAll` prepends an "All Months" option (value `""`) — opt-in, off by
// default, so every existing caller (the Orders page) keeps its exact
// current behavior unchanged. Used by the Returns page's All section (see
// app/_components/returns/ReturnsList.jsx) where "no month selected" is a
// real, meaningful choice, not just a field left blank.
export default function MonthSelect({ value, onChange, disabled, allowAll = false }) {
  const periods = lastTwelvePeriods();
  const withAll = allowAll ? [{ value: "", label: "All Months" }, ...periods] : periods;
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
      aria-label="Month"
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
