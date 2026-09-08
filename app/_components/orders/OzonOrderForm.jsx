"use client";

import { useState } from "react";

import OrderBaseFields from "@/app/_components/orders/OrderBaseFields";
import OzonCitySelect from "@/app/_components/orders/OzonCitySelect";
import { ErrorBanner, Spinner, SuccessBanner } from "@/app/_components/orders/shared";

const REQUIRED_FIELDS = ["customerName", "phone", "city", "address", "price", "productName"];

/**
 * Ozon Express's order form. Submits to our own backend
 * (`POST /api/orders/ozon`) — the browser never calls api.ozonexpress.ma
 * directly, and never sees the Ozon credentials. The backend reserves the
 * tracking number, calls Ozon, and only reports success once Ozon itself
 * confirms `ADD-PARCEL.RESULT !== "ERROR"`. See app/api/orders/ozon/route.js.
 */
export default function OzonOrderForm() {
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
      setError("Please fill in all required fields.");
      return;
    }

    setStatus("loading");
    try {
      const res = await fetch("/api/orders/ozon", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          receiver: form.get("customerName"),
          phone: form.get("phone"),
          city: form.get("city"),
          address: form.get("address"),
          price: form.get("price"),
          productNature: form.get("productName"),
        }),
      });

      const data = await res.json().catch(() => ({}));

      if (!res.ok) {
        setStatus("error");
        setError(data?.error || "Ozon Express could not create this order.");
        return;
      }

      setTrackingNumber(data?.trackingNumber || "");
      setStatus("success");
      formEl.reset();
    } catch {
      setStatus("error");
      setError("Network error. Please check your connection and try again.");
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
          citySlot={<OzonCitySelect required disabled={loading || succeeded} />}
        />
      </fieldset>

      {error ? <ErrorBanner>{error}</ErrorBanner> : null}
      {succeeded ? (
        <SuccessBanner>
          Order created — tracking number{" "}
          <span className="font-mono font-semibold">{trackingNumber}</span>.
        </SuccessBanner>
      ) : null}

      {succeeded ? (
        <button
          type="button"
          onClick={handleCreateAnother}
          className="flex w-full items-center justify-center gap-2 rounded-lg bg-zinc-900 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-zinc-800 dark:bg-white dark:text-black dark:hover:bg-zinc-200"
        >
          Create another order
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
              Sending…
            </>
          ) : (
            "Send Order"
          )}
        </button>
      )}
    </form>
  );
}
