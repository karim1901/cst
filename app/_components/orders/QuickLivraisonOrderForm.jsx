"use client";

import { useState } from "react";

import OrderBaseFields from "@/app/_components/orders/OrderBaseFields";
import QuickDistrictSelect from "@/app/_components/orders/QuickDistrictSelect";
import { ErrorBanner, FIELD, LABEL, Spinner, SuccessBanner } from "@/app/_components/orders/shared";
import { useLocale } from "@/app/_components/i18n/LocaleProvider";

const REQUIRED_FIELDS = ["customerName", "phone", "city", "address", "price", "productName", "quantity"];

/**
 * Quick Livraison's order form. Submits to our own backend
 * (`POST /api/orders/quick`) — the browser never calls
 * clients.quicklivraison.ma directly, and never sees the Quick API key. The
 * backend reserves a Quick-specific tracking number, calls Quick, and only
 * reports success once Quick's response is confirmed (best-effort parsed —
 * see lib/quick/parse.js). See app/api/orders/quick/route.js.
 */
export default function QuickLivraisonOrderForm() {
  const { t } = useLocale();
  const [status, setStatus] = useState("idle"); // idle | loading | error | success
  const [error, setError] = useState("");
  const [trackingNumber, setTrackingNumber] = useState("");

  async function handleSubmit(event) {
    event.preventDefault();
    setError("");

    const formEl = event.currentTarget;
    const form = new FormData(formEl);
    const missing = REQUIRED_FIELDS.filter((key) => !String(form.get(key) || "").trim());
    if (missing.length > 0) {
      setStatus("error");
      setError(t("orderForm.fillRequired"));
      return;
    }

    setStatus("loading");
    try {
      const res = await fetch("/api/orders/quick", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          receiver: form.get("customerName"),
          phone: form.get("phone"),
          districtId: form.get("city"),
          address: form.get("address"),
          amount: form.get("price"),
          productName: form.get("productName"),
          quantity: form.get("quantity"),
          note: form.get("notes") || undefined,
          // No `open` field: "allow opening before paying" is always forced
          // to true server-side (see app/api/orders/quick/route.js) — it is
          // not a user choice, so it is never sent from here.
        }),
      });

      const data = await res.json().catch(() => ({}));

      if (!res.ok) {
        setStatus("error");
        setError(data?.error || t("orderForm.quickCreateFailed"));
        return;
      }

      setTrackingNumber(data?.trackingNumber || "");
      setStatus("success");
      formEl.reset();
    } catch {
      setStatus("error");
      setError(t("orderForm.networkError"));
    }
  }

  function handleCreateAnother() {
    setStatus("idle");
    setError("");
    setTrackingNumber("");
  }

  const loading = status === "loading";
  const succeeded = status === "success";

  return (
    <form onSubmit={handleSubmit} className="space-y-6" noValidate>
      <fieldset disabled={loading || succeeded} className="space-y-4">
        <OrderBaseFields
          disabled={loading || succeeded}
          citySlot={<QuickDistrictSelect required disabled={loading || succeeded} />}
        />

        <div>
          <label htmlFor="quickQuantity" className={LABEL}>
            {t("orderForm.quantity")}
          </label>
          <input
            id="quickQuantity"
            name="quantity"
            type="number"
            min="1"
            step="1"
            required
            disabled={loading || succeeded}
            className={FIELD}
            placeholder="1"
          />
        </div>

        <div>
          <label htmlFor="quickNotes" className={LABEL}>
            {t("orderForm.notesLabel")}{" "}
            <span className="font-normal text-zinc-400">{t("orderForm.optional")}</span>
          </label>
          <input
            id="quickNotes"
            name="notes"
            type="text"
            disabled={loading || succeeded}
            className={FIELD}
            placeholder={t("orderForm.notesPlaceholder")}
          />
        </div>
      </fieldset>

      {error ? <ErrorBanner>{error}</ErrorBanner> : null}
      {succeeded ? (
        <SuccessBanner>
          {t("orderForm.orderCreated")}{" "}
          <span className="font-mono font-semibold">{trackingNumber}</span>.
        </SuccessBanner>
      ) : null}

      {succeeded ? (
        <button
          type="button"
          onClick={handleCreateAnother}
          className="flex w-full items-center justify-center gap-2 rounded-lg bg-zinc-900 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-zinc-800 dark:bg-white dark:text-black dark:hover:bg-zinc-200"
        >
          {t("orderForm.createAnother")}
        </button>
      ) : (
        <button
          type="submit"
          disabled={loading}
          className="flex w-full items-center justify-center gap-2 rounded-lg bg-zinc-900 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-60 dark:bg-white dark:text-black dark:hover:bg-zinc-200"
        >
          {loading ? (
            <>
              <Spinner />
              {t("orderForm.sending")}
            </>
          ) : (
            t("orderForm.sendOrder")
          )}
        </button>
      )}
    </form>
  );
}
