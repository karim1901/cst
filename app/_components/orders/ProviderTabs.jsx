"use client";

import { useLocale } from "@/app/_components/i18n/LocaleProvider";
import { SHIPPING_PROVIDERS } from "@/lib/shipping/providers";

const PROVIDER_IDS = [SHIPPING_PROVIDERS.OZON_EXPRESS, SHIPPING_PROVIDERS.QUICK_LIVRAISON];

/**
 * Switches which provider's orders are shown — only one at a time. Used
 * across Orders, Returns, Follow-up, and the Dashboard's statistics (see
 * each page's own module comment) so there is exactly ONE provider
 * switcher implementation, never a per-page reimplementation. Distinct
 * from ShippingCompanySelector.jsx, which is a one-shot "pick once, then a
 * form appears" step used at order CREATION; this is a persistent toggle a
 * user flips back and forth while browsing. Built so a third provider is
 * just one more entry in `PROVIDER_IDS` — nothing else here is
 * provider-specific.
 */
export default function ProviderTabs({ value, onChange }) {
  const { t } = useLocale();

  return (
    <div
      role="tablist"
      aria-label={t("providers.shippingCompany")}
      className="inline-flex w-full gap-1 rounded-xl border border-zinc-200 bg-zinc-100 p-1 sm:w-auto dark:border-zinc-800 dark:bg-zinc-900"
    >
      {PROVIDER_IDS.map((providerId) => {
        const active = providerId === value;
        return (
          <button
            key={providerId}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onChange(providerId)}
            className={`flex-1 rounded-lg px-4 py-2 text-sm font-medium transition sm:flex-initial ${
              active
                ? "bg-white text-zinc-900 shadow-sm dark:bg-zinc-950 dark:text-zinc-50"
                : "text-zinc-500 hover:text-zinc-700 dark:text-zinc-400 dark:hover:text-zinc-200"
            }`}
          >
            {t(`providers.${providerId}`)}
          </button>
        );
      })}
    </div>
  );
}
