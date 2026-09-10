"use client";

import { useState } from "react";
import Link from "next/link";

import ShippingCompanySelector from "@/app/_components/orders/ShippingCompanySelector";
import OzonOrderForm from "@/app/_components/orders/OzonOrderForm";
import QuickLivraisonOrderForm from "@/app/_components/orders/QuickLivraisonOrderForm";
import { useLocale } from "@/app/_components/i18n/LocaleProvider";

/**
 * Owns which shipping company is selected (frontend-only state — nothing is
 * persisted). Step 1 is always the provider selector; once one is chosen,
 * step 2 renders that provider's own order form. Backend integration is
 * intentionally out of scope here — see OzonOrderForm / QuickLivraisonOrderForm.
 *
 * The provider NAME ("Ozon Express"/"Quick Livraison") is a company name —
 * shown verbatim, never translated. Everything else here is static UI text.
 */
export default function CreateOrder() {
  const { t } = useLocale();
  const [provider, setProvider] = useState(null);

  return (
    <div>
      <Link
        href="/dashboard/orders"
        className="text-sm font-medium text-zinc-500 underline underline-offset-2 dark:text-zinc-400"
      >
        {t("orderForm.backToOrders")}
      </Link>

      <h1 className="mt-3 text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
        {t("orderForm.pageTitle")}
      </h1>
      <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">{t("orderForm.pageSubtitle")}</p>

      <div className="mt-8">
        {!provider ? (
          <ShippingCompanySelector onSelect={setProvider} />
        ) : (
          <div>
            <div className="mb-4 flex items-center justify-between gap-4 rounded-xl border border-zinc-200 bg-zinc-50 px-4 py-3 dark:border-zinc-800 dark:bg-zinc-900">
              <p className="text-sm text-zinc-700 dark:text-zinc-300">
                {t("orderForm.shippingCompanyLabel")}{" "}
                <span className="font-semibold text-zinc-900 dark:text-zinc-100">
                  {provider === "ozon_express" ? "Ozon Express" : "Quick Livraison"}
                </span>
              </p>
              <button
                type="button"
                onClick={() => setProvider(null)}
                className="shrink-0 text-sm font-medium text-zinc-900 underline underline-offset-2 dark:text-zinc-100"
              >
                {t("orderForm.change")}
              </button>
            </div>

            <div className="rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm sm:p-8 dark:border-zinc-800 dark:bg-zinc-900">
              {provider === "ozon_express" ? <OzonOrderForm /> : <QuickLivraisonOrderForm />}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
