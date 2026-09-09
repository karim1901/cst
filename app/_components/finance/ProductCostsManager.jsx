"use client";

import { useEffect, useState } from "react";

import { FIELD, Spinner, ErrorBanner } from "@/app/_components/orders/shared";
import { useLocale } from "@/app/_components/i18n/LocaleProvider";

/**
 * Products auto-discovered from this merchant's real orders
 * (`Order.productNature`, distinct — see app/api/finance/product-costs/
 * route.js), each with an inline cost-per-unit field. Product NAMES are
 * real business data — displayed verbatim, never translated (item B/E).
 */
export default function ProductCostsManager({ onChanged }) {
  const { t } = useLocale();
  const [state, setState] = useState("loading");
  const [products, setProducts] = useState([]);
  const [errorMessage, setErrorMessage] = useState("");
  const [drafts, setDrafts] = useState({});
  const [savingName, setSavingName] = useState(null);

  function load() {
    fetch("/api/finance/product-costs")
      .then(async (res) => {
        const body = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(body?.error || "Could not load products.");
        setProducts(body.products ?? []);
        setState("ready");
      })
      .catch((error) => {
        setErrorMessage(error?.message || "Could not load products.");
        setState("error");
      });
  }

  useEffect(load, []);

  async function handleSave(productName) {
    const value = drafts[productName];
    if (value === undefined || value === "") return;
    setSavingName(productName);
    try {
      const res = await fetch("/api/finance/product-costs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ productName, costPerUnit: value }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body?.error || "Could not save this cost.");
      load();
      onChanged?.();
    } catch (error) {
      window.alert(error?.message || "Could not save this cost.");
    } finally {
      setSavingName(null);
    }
  }

  if (state === "loading") {
    return (
      <div className="flex items-center justify-center gap-2 py-8 text-sm text-zinc-500 dark:text-zinc-400">
        <Spinner /> {t("common.loading")}
      </div>
    );
  }
  if (state === "error") return <ErrorBanner>{errorMessage}</ErrorBanner>;
  if (products.length === 0) {
    return (
      <p className="rounded-2xl border border-dashed border-zinc-300 px-6 py-10 text-center text-sm text-zinc-500 dark:border-zinc-700 dark:text-zinc-400">
        {t("finance.noProductsYet")}
      </p>
    );
  }

  return (
    <div className="space-y-2">
      {products.map((product) => (
        <div
          key={product.productName}
          className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-zinc-200 bg-white p-3 text-sm dark:border-zinc-800 dark:bg-zinc-900"
        >
          {/* Real product name — never translated. */}
          <span className="min-w-0 truncate font-medium text-zinc-900 dark:text-zinc-100">
            {product.productName}
          </span>
          <div className="flex shrink-0 items-center gap-2">
            {product.configured ? (
              <span className="text-xs text-zinc-500 dark:text-zinc-400">
                {product.costPerUnit.toFixed(2)} DH / {t("finance.costPerUnit")}
              </span>
            ) : (
              <span className="text-xs font-medium text-amber-700 dark:text-amber-400">
                {t("finance.costNotConfigured")}
              </span>
            )}
            <input
              type="number"
              min="0"
              step="0.01"
              placeholder={t("finance.costPerUnit")}
              value={drafts[product.productName] ?? ""}
              onChange={(e) => setDrafts((d) => ({ ...d, [product.productName]: e.target.value }))}
              className={`${FIELD} !mt-0 w-28`}
            />
            <button
              type="button"
              onClick={() => handleSave(product.productName)}
              disabled={savingName === product.productName}
              className="rounded-lg bg-zinc-900 px-3 py-2 text-xs font-semibold text-white transition hover:bg-zinc-800 disabled:opacity-60 dark:bg-white dark:text-black dark:hover:bg-zinc-200"
            >
              {savingName === product.productName ? <Spinner /> : t("common.save")}
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}
