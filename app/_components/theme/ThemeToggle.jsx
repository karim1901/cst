"use client";

import { useTheme } from "@/app/_components/theme/ThemeProvider";
import { useLocale } from "@/app/_components/i18n/LocaleProvider";

const SUN = (
  <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.75" className="h-4.5 w-4.5">
    <circle cx="10" cy="10" r="3.5" />
    <path strokeLinecap="round" d="M10 2.5v2M10 15.5v2M17.5 10h-2M4.5 10h-2M15.3 4.7l-1.4 1.4M6.1 13.9l-1.4 1.4M15.3 15.3l-1.4-1.4M6.1 6.1 4.7 4.7" />
  </svg>
);

const MOON = (
  <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.75" className="h-4.5 w-4.5">
    <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 12.3A6.5 6.5 0 0 1 7.7 3.5a6.5 6.5 0 1 0 8.8 8.8Z" />
  </svg>
);

/**
 * Global light/dark toggle — see app/_components/theme/ThemeProvider.jsx
 * for persistence (a cookie, read server-side so there is no flash on
 * load/navigation). Rendered from the global header, so it is available on
 * every authenticated page, not just the Dashboard (item 18's explicit
 * requirement).
 */
export default function ThemeToggle({ className = "" }) {
  const { theme, toggleTheme } = useTheme();
  const { t } = useLocale();
  const isDark = theme === "dark";

  return (
    <button
      type="button"
      onClick={toggleTheme}
      aria-label={t("common.theme")}
      title={isDark ? t("common.light") : t("common.dark")}
      className={`grid h-10 w-10 shrink-0 place-items-center rounded-full border border-zinc-200 text-zinc-600 transition hover:bg-zinc-100 dark:border-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-800 ${className}`}
    >
      {isDark ? SUN : MOON}
    </button>
  );
}
