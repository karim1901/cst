"use client";

import { useLocale } from "@/app/_components/i18n/LocaleProvider";

// Provider ids + names. NAMES ("Ozon Express" / "Quick Livraison") are
// company names — shown verbatim, never translated. Only the short
// description under each is static UI text.
const PROVIDERS = [
  { id: "ozon_express", name: "Ozon Express", descKey: "orderForm.sendVia" },
  { id: "quick_livraison", name: "Quick Livraison", descKey: "orderForm.sendVia" },
];

/**
 * Step 1 of order creation — the shipping company must be chosen before
 * anything else, since each provider gets its own order form (and, later,
 * its own backend integration).
 */
export default function ShippingCompanySelector({ onSelect }) {
  const { t } = useLocale();

  return (
    <div>
      <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
        {t("orderForm.chooseCompany")}
      </h2>
      <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">{t("orderForm.formAdapts")}</p>

      <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
        {PROVIDERS.map((provider) => (
          <button
            key={provider.id}
            type="button"
            onClick={() => onSelect(provider.id)}
            className="rounded-2xl border border-zinc-200 bg-white p-5 text-left shadow-sm transition hover:border-zinc-900 hover:shadow-md dark:border-zinc-800 dark:bg-zinc-900 dark:hover:border-zinc-100"
          >
            <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">{provider.name}</h3>
            <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
              {t("orderForm.sendVia")} {provider.name}.
            </p>
            <span className="mt-4 inline-flex items-center gap-1 text-sm font-medium text-zinc-900 dark:text-zinc-100">
              {t("orderForm.select")}
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}
