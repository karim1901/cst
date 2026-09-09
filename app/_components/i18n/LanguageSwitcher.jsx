"use client";

import { useLocale } from "@/app/_components/i18n/LocaleProvider";
import { LOCALES } from "@/lib/i18n/constants";

/**
 * Global English/Arabic switcher — see LocaleProvider.jsx for persistence
 * (a cookie, read server-side so <html lang/dir> is already correct before
 * this ever mounts, and there is no layout flash when switching). Rendered
 * from the global header, available on every authenticated page.
 */
export default function LanguageSwitcher({ className = "" }) {
  const { locale, setLocale, t } = useLocale();

  return (
    <button
      type="button"
      onClick={() => setLocale(locale === LOCALES.EN ? LOCALES.AR : LOCALES.EN)}
      aria-label={t("common.language")}
      title={locale === LOCALES.EN ? t("common.arabic") : t("common.english")}
      className={`grid h-10 min-w-10 shrink-0 place-items-center rounded-full border border-zinc-200 px-2.5 text-xs font-semibold text-zinc-600 transition hover:bg-zinc-100 dark:border-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-800 ${className}`}
    >
      {locale === LOCALES.EN ? "AR" : "EN"}
    </button>
  );
}
