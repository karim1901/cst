"use client";

import { useState } from "react";

import { useLocale } from "@/app/_components/i18n/LocaleProvider";

/**
 * Compact replacement for the old full "Your account" card — name, active
 * status, and a notifications affordance in one row. There is no
 * notifications backend in this app yet, so the bell honestly shows an
 * empty state rather than a fabricated unread badge — see the plan's
 * explicit "never hardcode/invent data" rule.
 */
export default function DashboardHeader({ name, isActive }) {
  const [open, setOpen] = useState(false);
  const { t } = useLocale();

  return (
    <div className="mb-6 flex items-center justify-between gap-3 sm:mb-8">
      <div className="flex min-w-0 items-center gap-2">
        <span className="truncate text-lg font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
          {name}
        </span>
        <span
          className={`inline-flex shrink-0 items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium ${
            isActive
              ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300"
              : "bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400"
          }`}
        >
          <span className={`h-1.5 w-1.5 rounded-full ${isActive ? "bg-emerald-500" : "bg-zinc-400"}`} />
          {isActive ? t("common.active") : t("common.inactive")}
        </span>
      </div>

      <div className="relative shrink-0">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          aria-label={t("common.notifications")}
          className="grid h-10 w-10 place-items-center rounded-full border border-zinc-200 text-zinc-600 transition hover:bg-zinc-100 dark:border-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-800"
        >
          <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.75" className="h-5 w-5">
            <path strokeLinecap="round" strokeLinejoin="round" d="M5 8a5 5 0 0 1 10 0c0 3.5 1.2 4.5 1.2 4.5H3.8S5 11.5 5 8Z" />
            <path strokeLinecap="round" d="M8.2 15.5a1.9 1.9 0 0 0 3.6 0" />
          </svg>
        </button>

        {open ? (
          <div className="absolute end-0 z-10 mt-2 w-56 rounded-xl border border-zinc-200 bg-white p-3 text-sm shadow-lg dark:border-zinc-800 dark:bg-zinc-900">
            <p className="font-medium text-zinc-900 dark:text-zinc-100">{t("common.notifications")}</p>
            <p className="mt-1 text-zinc-500 dark:text-zinc-400">{t("common.noNotifications")}</p>
          </div>
        ) : null}
      </div>
    </div>
  );
}
