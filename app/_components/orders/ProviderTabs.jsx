"use client";

const PROVIDERS = [
  { id: "ozon_express", label: "Ozon Express" },
  { id: "quick_livraison", label: "Quick Livraison" },
];

/**
 * Switches which provider's orders are shown — only one at a time (see
 * app/dashboard/orders/page.jsx). Distinct from
 * ShippingCompanySelector.jsx, which is a one-shot "pick once, then a form
 * appears" step used at order CREATION; this is a persistent toggle a user
 * flips back and forth while browsing. Built so a third provider is just
 * one more entry in `PROVIDERS` — nothing else here is provider-specific.
 */
export default function ProviderTabs({ value, onChange }) {
  return (
    <div
      role="tablist"
      aria-label="Shipping company"
      className="inline-flex w-full gap-1 rounded-xl border border-zinc-200 bg-zinc-100 p-1 sm:w-auto dark:border-zinc-800 dark:bg-zinc-900"
    >
      {PROVIDERS.map((provider) => {
        const active = provider.id === value;
        return (
          <button
            key={provider.id}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onChange(provider.id)}
            className={`flex-1 rounded-lg px-4 py-2 text-sm font-medium transition sm:flex-initial ${
              active
                ? "bg-white text-zinc-900 shadow-sm dark:bg-zinc-950 dark:text-zinc-50"
                : "text-zinc-500 hover:text-zinc-700 dark:text-zinc-400 dark:hover:text-zinc-200"
            }`}
          >
            {provider.label}
          </button>
        );
      })}
    </div>
  );
}
