"use client";

const PROVIDERS = [
  {
    id: "ozon_express",
    name: "Ozon Express",
    description: "Send this order through Ozon Express.",
  },
  {
    id: "quick_livraison",
    name: "Quick Livraison",
    description: "Send this order through Quick Livraison.",
  },
];

/**
 * Step 1 of order creation — the shipping company must be chosen before
 * anything else, since each provider gets its own order form (and, later,
 * its own backend integration).
 */
export default function ShippingCompanySelector({ onSelect }) {
  return (
    <div>
      <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
        1. Select a shipping company
      </h2>
      <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
        The order form adapts to what the chosen provider needs.
      </p>

      <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
        {PROVIDERS.map((provider) => (
          <button
            key={provider.id}
            type="button"
            onClick={() => onSelect(provider.id)}
            className="rounded-2xl border border-zinc-200 bg-white p-5 text-left shadow-sm transition hover:border-zinc-900 hover:shadow-md dark:border-zinc-800 dark:bg-zinc-900 dark:hover:border-zinc-100"
          >
            <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
              {provider.name}
            </h3>
            <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
              {provider.description}
            </p>
            <span className="mt-4 inline-flex items-center gap-1 text-sm font-medium text-zinc-900 dark:text-zinc-100">
              Select →
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}
