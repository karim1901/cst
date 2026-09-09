"use client";

import { useEffect, useState } from "react";

import { FIELD, LABEL, Spinner, ErrorBanner } from "@/app/_components/orders/shared";
import { useLocale } from "@/app/_components/i18n/LocaleProvider";

function todayLocalDate() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/**
 * Daily advertising-spend entries (item 2) — persisted in MongoDB, never
 * localStorage (see models/AdvertisingExpense.js). Scoped to this
 * merchant server-side; `provider` here is just the DEFAULT scope
 * suggested for a new entry (matching whichever provider tab is active on
 * the page) — the entry itself can still be saved as "All" if the spend
 * is not provider-specific (see the select below).
 */
export default function AdvertisingManager({ provider, period, onChanged }) {
  const { t } = useLocale();
  const [state, setState] = useState("loading");
  const [expenses, setExpenses] = useState([]);
  const [errorMessage, setErrorMessage] = useState("");

  const [date, setDate] = useState(todayLocalDate);
  const [amount, setAmount] = useState("");
  const [scope, setScope] = useState(provider);
  const [saving, setSaving] = useState(false);

  // Reset to "loading" when the month changes — adjusted during render
  // (React's recommended pattern), not a synchronous setState at the top
  // of the effect below — same fix already applied throughout this app.
  const [renderedForPeriod, setRenderedForPeriod] = useState(period);
  if (period !== renderedForPeriod) {
    setRenderedForPeriod(period);
    setState("loading");
  }

  function load() {
    fetch(`/api/finance/advertising?period=${period}`)
      .then(async (res) => {
        const body = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(body?.error || "Could not load advertising expenses.");
        setExpenses(body.expenses ?? []);
        setState("ready");
      })
      .catch((error) => {
        setErrorMessage(error?.message || "Could not load advertising expenses.");
        setState("error");
      });
  }

  useEffect(load, [period]);

  async function handleSubmit(event) {
    event.preventDefault();
    setSaving(true);
    try {
      const res = await fetch("/api/finance/advertising", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ date, amount, provider: scope }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body?.error || "Could not save this expense.");
      setAmount("");
      load();
      onChanged?.();
    } catch (error) {
      window.alert(error?.message || "Could not save this expense.");
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(id) {
    if (!window.confirm(t("common.confirm") + "?")) return;
    try {
      const res = await fetch(`/api/finance/advertising/${id}`, { method: "DELETE" });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body?.error || "Could not delete this expense.");
      }
      load();
      onChanged?.();
    } catch (error) {
      window.alert(error?.message || "Could not delete this expense.");
    }
  }

  return (
    <div>
      <form
        onSubmit={handleSubmit}
        className="mb-4 grid grid-cols-1 gap-3 rounded-2xl border border-zinc-200 bg-white p-4 shadow-sm sm:grid-cols-4 dark:border-zinc-800 dark:bg-zinc-900"
      >
        <div>
          <label className={LABEL}>{t("finance.date")}</label>
          <input
            type="date"
            required
            value={date}
            onChange={(e) => setDate(e.target.value)}
            className={FIELD}
          />
        </div>
        <div>
          <label className={LABEL}>{t("finance.adSpend")} (DH)</label>
          <input
            type="number"
            min="0"
            step="0.01"
            required
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            className={FIELD}
          />
        </div>
        <div>
          <label className={LABEL}>{t("finance.provider")}</label>
          <select value={scope} onChange={(e) => setScope(e.target.value)} className={FIELD}>
            <option value="all">{t("common.all")}</option>
            <option value="ozon_express">Ozon Express</option>
            <option value="quick_livraison">Quick Livraison</option>
          </select>
        </div>
        <div className="flex items-end">
          <button
            type="submit"
            disabled={saving}
            className="flex w-full items-center justify-center gap-2 rounded-lg bg-zinc-900 px-4 py-2 text-sm font-semibold text-white transition hover:bg-zinc-800 disabled:opacity-60 dark:bg-white dark:text-black dark:hover:bg-zinc-200"
          >
            {saving ? <Spinner /> : null}
            {t("finance.addExpense")}
          </button>
        </div>
      </form>

      {state === "loading" ? (
        <div className="flex items-center justify-center gap-2 py-8 text-sm text-zinc-500 dark:text-zinc-400">
          <Spinner /> {t("common.loading")}
        </div>
      ) : state === "error" ? (
        <ErrorBanner>{errorMessage}</ErrorBanner>
      ) : expenses.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-zinc-300 px-6 py-10 text-center text-sm text-zinc-500 dark:border-zinc-700 dark:text-zinc-400">
          {t("finance.noExpensesYet")}
        </p>
      ) : (
        <div className="space-y-2">
          {expenses.map((expense) => (
            <div
              key={expense.id}
              className="flex items-center justify-between gap-3 rounded-xl border border-zinc-200 bg-white p-3 text-sm dark:border-zinc-800 dark:bg-zinc-900"
            >
              <div>
                <p className="font-medium text-zinc-900 dark:text-zinc-100">{expense.date}</p>
                <p className="text-xs text-zinc-500 dark:text-zinc-400">
                  {expense.provider === "all" ? t("common.all") : expense.provider === "ozon_express" ? "Ozon Express" : "Quick Livraison"}
                </p>
              </div>
              <div className="flex items-center gap-3">
                <span className="font-semibold text-zinc-900 dark:text-zinc-50">{expense.amount.toFixed(2)} DH</span>
                <button
                  type="button"
                  onClick={() => handleDelete(expense.id)}
                  className="rounded-lg border border-red-200 px-2.5 py-1 text-xs font-medium text-red-700 transition hover:bg-red-50 dark:border-red-900/50 dark:text-red-300 dark:hover:bg-red-950/40"
                >
                  {t("common.delete")}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
