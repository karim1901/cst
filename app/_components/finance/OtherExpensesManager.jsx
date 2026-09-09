"use client";

import { useEffect, useState } from "react";

import { FIELD, LABEL, Spinner, ErrorBanner } from "@/app/_components/orders/shared";
import { useLocale } from "@/app/_components/i18n/LocaleProvider";

function todayLocalDate() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** Business-level expenses (packaging, rent, staff, ...) — item 7. Deducted
 * ONCE from the month's total (see lib/finance/calculate.js), never
 * multiplied per order. */
export default function OtherExpensesManager({ period, onChanged }) {
  const { t } = useLocale();
  const [state, setState] = useState("loading");
  const [expenses, setExpenses] = useState([]);
  const [errorMessage, setErrorMessage] = useState("");

  const [title, setTitle] = useState("");
  const [amount, setAmount] = useState("");
  const [date, setDate] = useState(todayLocalDate);
  const [category, setCategory] = useState("");
  const [saving, setSaving] = useState(false);

  const [renderedForPeriod, setRenderedForPeriod] = useState(period);
  if (period !== renderedForPeriod) {
    setRenderedForPeriod(period);
    setState("loading");
  }

  function load() {
    fetch(`/api/finance/other-expenses?period=${period}`)
      .then(async (res) => {
        const body = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(body?.error || "Could not load expenses.");
        setExpenses(body.expenses ?? []);
        setState("ready");
      })
      .catch((error) => {
        setErrorMessage(error?.message || "Could not load expenses.");
        setState("error");
      });
  }

  useEffect(load, [period]);

  async function handleSubmit(event) {
    event.preventDefault();
    setSaving(true);
    try {
      const res = await fetch("/api/finance/other-expenses", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title, amount, date, category }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body?.error || "Could not save this expense.");
      setTitle("");
      setAmount("");
      setCategory("");
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
      const res = await fetch(`/api/finance/other-expenses/${id}`, { method: "DELETE" });
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
        className="mb-4 grid grid-cols-1 gap-3 rounded-2xl border border-zinc-200 bg-white p-4 shadow-sm sm:grid-cols-2 lg:grid-cols-5 dark:border-zinc-800 dark:bg-zinc-900"
      >
        <div className="lg:col-span-2">
          <label className={LABEL}>{t("finance.title_")}</label>
          <input required value={title} onChange={(e) => setTitle(e.target.value)} className={FIELD} />
        </div>
        <div>
          <label className={LABEL}>{t("finance.category")}</label>
          <input value={category} onChange={(e) => setCategory(e.target.value)} className={FIELD} />
        </div>
        <div>
          <label className={LABEL}>{t("finance.date")}</label>
          <input type="date" required value={date} onChange={(e) => setDate(e.target.value)} className={FIELD} />
        </div>
        <div>
          <label className={LABEL}>{t("finance.amount")} (DH)</label>
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
        <div className="flex items-end lg:col-span-5">
          <button
            type="submit"
            disabled={saving}
            className="flex items-center justify-center gap-2 rounded-lg bg-zinc-900 px-4 py-2 text-sm font-semibold text-white transition hover:bg-zinc-800 disabled:opacity-60 dark:bg-white dark:text-black dark:hover:bg-zinc-200"
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
              <div className="min-w-0">
                <p className="truncate font-medium text-zinc-900 dark:text-zinc-100">{expense.title}</p>
                <p className="text-xs text-zinc-500 dark:text-zinc-400">
                  {expense.date}
                  {expense.category ? ` · ${expense.category}` : ""}
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-3">
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
