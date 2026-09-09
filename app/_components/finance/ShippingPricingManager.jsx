"use client";

import { useEffect, useState } from "react";

import { FIELD, LABEL, Spinner, ErrorBanner, SuccessBanner } from "@/app/_components/orders/shared";
import { useLocale } from "@/app/_components/i18n/LocaleProvider";
import { SHIPPING_PROVIDERS } from "@/lib/shipping/providers";

/**
 * Shipping-price data behind Finance's shipping-cost calculation (item 8/9).
 * Ozon Express has a real per-city pricing API — "Sync now" pulls it in
 * (see lib/finance/sync-city-pricing.js). Quick Livraison has NO such API
 * (verified live against the real endpoint) — a merchant-entered FLAT rate
 * is used instead, entered once here.
 */
export default function ShippingPricingManager({ provider, onChanged }) {
  const { t } = useLocale();
  const [state, setState] = useState("loading");
  const [pricing, setPricing] = useState([]);
  const [errorMessage, setErrorMessage] = useState("");
  const [syncing, setSyncing] = useState(false);
  const [successMessage, setSuccessMessage] = useState("");

  const [flatDelivered, setFlatDelivered] = useState("");
  const [flatReturned, setFlatReturned] = useState("");
  const [flatRefused, setFlatRefused] = useState("");
  const [savingFlat, setSavingFlat] = useState(false);

  const [renderedForProvider, setRenderedForProvider] = useState(provider);
  if (provider !== renderedForProvider) {
    setRenderedForProvider(provider);
    setState("loading");
  }

  function load() {
    fetch(`/api/finance/city-pricing?provider=${provider}`)
      .then(async (res) => {
        const body = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(body?.error || "Could not load shipping prices.");
        setPricing(body.pricing ?? []);
        if (provider === SHIPPING_PROVIDERS.QUICK_LIVRAISON) {
          const flat = (body.pricing ?? []).find((p) => p.cityId === "_flat");
          setFlatDelivered(flat?.deliveredPrice ?? "");
          setFlatReturned(flat?.returnedPrice ?? "");
          setFlatRefused(flat?.refusedPrice ?? "");
        }
        setState("ready");
      })
      .catch((error) => {
        setErrorMessage(error?.message || "Could not load shipping prices.");
        setState("error");
      });
  }

  useEffect(load, [provider]);

  async function handleSync() {
    setSyncing(true);
    setSuccessMessage("");
    try {
      const res = await fetch("/api/finance/city-pricing", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body?.error || "Could not sync prices.");
      setSuccessMessage(`Synced ${body.synced} cities.`);
      load();
      onChanged?.();
    } catch (error) {
      window.alert(error?.message || "Could not sync prices.");
    } finally {
      setSyncing(false);
    }
  }

  async function handleSaveFlat(event) {
    event.preventDefault();
    setSavingFlat(true);
    try {
      const res = await fetch("/api/finance/city-pricing", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          provider,
          deliveredPrice: flatDelivered,
          returnedPrice: flatReturned,
          refusedPrice: flatRefused,
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body?.error || "Could not save this rate.");
      load();
      onChanged?.();
    } catch (error) {
      window.alert(error?.message || "Could not save this rate.");
    } finally {
      setSavingFlat(false);
    }
  }

  if (provider === SHIPPING_PROVIDERS.QUICK_LIVRAISON) {
    return (
      <div>
        <p className="mb-4 text-sm text-zinc-500 dark:text-zinc-400">
          Quick Livraison does not provide per-city shipping prices through its API. Enter one flat rate per
          status below — it applies to every Quick order regardless of city.
        </p>
        <form
          onSubmit={handleSaveFlat}
          className="grid grid-cols-1 gap-3 rounded-2xl border border-zinc-200 bg-white p-4 shadow-sm sm:grid-cols-3 dark:border-zinc-800 dark:bg-zinc-900"
        >
          <div>
            <label className={LABEL}>Livré (DH)</label>
            <input
              type="number"
              min="0"
              step="0.01"
              value={flatDelivered}
              onChange={(e) => setFlatDelivered(e.target.value)}
              className={FIELD}
            />
          </div>
          <div>
            <label className={LABEL}>Retour (DH)</label>
            <input
              type="number"
              min="0"
              step="0.01"
              value={flatReturned}
              onChange={(e) => setFlatReturned(e.target.value)}
              className={FIELD}
            />
          </div>
          <div>
            <label className={LABEL}>Refusé (DH)</label>
            <input
              type="number"
              min="0"
              step="0.01"
              value={flatRefused}
              onChange={(e) => setFlatRefused(e.target.value)}
              className={FIELD}
            />
          </div>
          <div className="sm:col-span-3">
            <button
              type="submit"
              disabled={savingFlat}
              className="flex items-center justify-center gap-2 rounded-lg bg-zinc-900 px-4 py-2 text-sm font-semibold text-white transition hover:bg-zinc-800 disabled:opacity-60 dark:bg-white dark:text-black dark:hover:bg-zinc-200"
            >
              {savingFlat ? <Spinner /> : null}
              {t("common.save")}
            </button>
          </div>
        </form>
      </div>
    );
  }

  return (
    <div>
      <div className="mb-4 flex items-center justify-between gap-3">
        <p className="text-sm text-zinc-500 dark:text-zinc-400">
          Real per-city prices from Ozon Express&rsquo;s own API.
        </p>
        <button
          type="button"
          onClick={handleSync}
          disabled={syncing}
          className="inline-flex shrink-0 items-center gap-2 rounded-lg border border-zinc-300 px-3 py-1.5 text-sm font-medium text-zinc-700 transition hover:bg-zinc-100 disabled:opacity-60 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-800"
        >
          {syncing ? <Spinner /> : null}
          {t("finance.shippingCosts")} — Sync now
        </button>
      </div>

      {successMessage ? <div className="mb-3"><SuccessBanner>{successMessage}</SuccessBanner></div> : null}

      {state === "loading" ? (
        <div className="flex items-center justify-center gap-2 py-8 text-sm text-zinc-500 dark:text-zinc-400">
          <Spinner /> {t("common.loading")}
        </div>
      ) : state === "error" ? (
        <ErrorBanner>{errorMessage}</ErrorBanner>
      ) : pricing.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-zinc-300 px-6 py-10 text-center text-sm text-zinc-500 dark:border-zinc-700 dark:text-zinc-400">
          No prices synced yet — click &ldquo;Sync now&rdquo; above.
        </p>
      ) : (
        <div className="max-h-96 space-y-1.5 overflow-y-auto">
          {pricing.map((row) => (
            <div
              key={row.id}
              className="flex items-center justify-between gap-3 rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm dark:border-zinc-800 dark:bg-zinc-900"
            >
              <span className="min-w-0 truncate font-medium text-zinc-900 dark:text-zinc-100">
                {row.cityName}
              </span>
              <span className="shrink-0 text-xs text-zinc-500 dark:text-zinc-400">
                Livré {row.deliveredPrice ?? "—"} · Retour {row.returnedPrice ?? "—"} · Refusé{" "}
                {row.refusedPrice ?? "—"}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
