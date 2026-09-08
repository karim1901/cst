"use client";

import { useState } from "react";

import ShippingCompanySelector from "@/app/_components/orders/ShippingCompanySelector";
import OzonOrderForm from "@/app/_components/orders/OzonOrderForm";
import QuickLivraisonOrderForm from "@/app/_components/orders/QuickLivraisonOrderForm";

const PROVIDER_LABELS = {
  ozon_express: "Ozon Express",
  quick_livraison: "Quick Livraison",
};

/**
 * Owns which shipping company is selected (frontend-only state — nothing is
 * persisted). Step 1 is always the provider selector; once one is chosen,
 * step 2 renders that provider's own order form. Backend integration is
 * intentionally out of scope here — see OzonOrderForm / QuickLivraisonOrderForm.
 */
export default function CreateOrder() {
  const [provider, setProvider] = useState(null);

  if (!provider) {
    return <ShippingCompanySelector onSelect={setProvider} />;
  }

  return (
    <div>
      <div className="mb-4 flex items-center justify-between gap-4 rounded-xl border border-zinc-200 bg-zinc-50 px-4 py-3 dark:border-zinc-800 dark:bg-zinc-900">
        <p className="text-sm text-zinc-700 dark:text-zinc-300">
          Shipping company:{" "}
          <span className="font-semibold text-zinc-900 dark:text-zinc-100">
            {PROVIDER_LABELS[provider]}
          </span>
        </p>
        <button
          type="button"
          onClick={() => setProvider(null)}
          className="shrink-0 text-sm font-medium text-zinc-900 underline underline-offset-2 dark:text-zinc-100"
        >
          Change
        </button>
      </div>

      <div className="rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm sm:p-8 dark:border-zinc-800 dark:bg-zinc-900">
        {provider === "ozon_express" ? <OzonOrderForm /> : <QuickLivraisonOrderForm />}
      </div>
    </div>
  );
}
