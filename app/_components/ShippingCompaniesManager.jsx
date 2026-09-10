"use client";

import { useState } from "react";

import { useLocale } from "@/app/_components/i18n/LocaleProvider";

const FIELD =
  "mt-1 block w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 shadow-sm outline-none transition focus:border-zinc-900 focus:ring-2 focus:ring-zinc-900/10 disabled:opacity-60 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-100 dark:focus:border-zinc-100 dark:focus:ring-zinc-100/10";

const LABEL = "block text-sm font-medium text-zinc-700 dark:text-zinc-300";

// Provider ids + labels are company names — shown verbatim, never
// translated. `descKey` picks the translated one-line description.
const PROVIDERS = [
  {
    id: "ozon_express",
    label: "Ozon Express",
    descKey: "shippingCompanies.requiresIdAndKey",
    hasOzonId: true,
  },
  {
    id: "quick_livraison",
    label: "Quick Livraison",
    descKey: "shippingCompanies.requiresKey",
    hasOzonId: false,
  },
];

export default function ShippingCompaniesManager({ initialCompanies }) {
  const { t } = useLocale();
  const initialByProvider = Object.fromEntries(
    initialCompanies.map((company) => [company.provider, company])
  );
  const [companies, setCompanies] = useState(initialByProvider);
  const [openProvider, setOpenProvider] = useState(null);

  return (
    <div className="space-y-4">
      <header className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
          {t("shippingCompanies.title")}
        </h1>
        <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
          {t("shippingCompanies.subtitle")}
        </p>
      </header>

      {PROVIDERS.map((provider) => (
        <ProviderCard
          key={provider.id}
          provider={provider}
          summary={companies[provider.id] ?? null}
          open={openProvider === provider.id}
          onToggle={() =>
            setOpenProvider((current) => (current === provider.id ? null : provider.id))
          }
          onSaved={(summary) => {
            setCompanies((current) => ({ ...current, [provider.id]: summary }));
            setOpenProvider(null);
          }}
        />
      ))}
    </div>
  );
}

function ProviderCard({ provider, summary, open, onToggle, onSaved }) {
  const { t } = useLocale();
  const configured = Boolean(summary);

  return (
    <div className="overflow-hidden rounded-2xl border border-zinc-200 bg-white shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
      <div className="flex flex-wrap items-center justify-between gap-3 p-5">
        <div>
          <div className="flex items-center gap-2">
            {/* company name — verbatim */}
            <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
              {provider.label}
            </h2>
            <StatusBadge configured={configured} />
          </div>
          <p className="mt-0.5 text-xs text-zinc-500 dark:text-zinc-400">{t(provider.descKey)}</p>
          {configured ? (
            <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
              {t("shippingCompanies.currentKey")}{" "}
              <span className="font-mono">{summary.apiKeyMasked ?? "••••••••"}</span>
              {provider.hasOzonId && summary.ozonId
                ? ` · ${t("shippingCompanies.idInline")} ${summary.ozonId}`
                : ""}
            </p>
          ) : null}
        </div>
        <button
          type="button"
          onClick={onToggle}
          className="shrink-0 rounded-lg border border-zinc-300 px-3 py-1.5 text-sm font-medium text-zinc-700 transition hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-800"
        >
          {open
            ? t("common.cancel")
            : configured
              ? t("common.edit")
              : t("shippingCompanies.configure")}
        </button>
      </div>

      {open ? (
        <div className="border-t border-zinc-200 p-5 dark:border-zinc-800">
          <ProviderForm provider={provider} summary={summary} onSaved={onSaved} />
        </div>
      ) : null}
    </div>
  );
}

function ProviderForm({ provider, summary, onSaved }) {
  const { t } = useLocale();
  const [status, setStatus] = useState("idle"); // idle | loading | error | success
  const [error, setError] = useState("");
  const [fieldErrors, setFieldErrors] = useState({});

  async function handleSubmit(event) {
    event.preventDefault();
    setStatus("loading");
    setError("");
    setFieldErrors({});

    const form = new FormData(event.currentTarget);
    const apiKey = String(form.get("apiKey") || "").trim();
    const payload = { provider: provider.id };
    if (provider.hasOzonId) {
      payload.ozonId = String(form.get("ozonId") || "").trim();
    }
    if (apiKey) {
      payload.apiKey = apiKey;
    }

    try {
      const res = await fetch("/api/shipping-companies", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json().catch(() => ({}));

      if (!res.ok) {
        setStatus("error");
        setError(data.error || t("shippingCompanies.saveFailed"));
        setFieldErrors(data.fieldErrors || {});
        return;
      }

      setStatus("success");
      onSaved(data.shippingCompany);
    } catch {
      setStatus("error");
      setError(t("shippingCompanies.networkError"));
    }
  }

  const loading = status === "loading";

  return (
    <form onSubmit={handleSubmit} className="space-y-4" noValidate>
      {provider.hasOzonId ? (
        <div>
          <label htmlFor={`${provider.id}-ozonId`} className={LABEL}>
            {t("shippingCompanies.idLabel")}
          </label>
          <input
            id={`${provider.id}-ozonId`}
            name="ozonId"
            type="text"
            required
            defaultValue={summary?.ozonId ?? ""}
            disabled={loading}
            className={FIELD}
            placeholder={t("shippingCompanies.ozonIdPlaceholder")}
          />
          <FieldError errors={fieldErrors.ozonId} />
        </div>
      ) : null}

      <div>
        <label htmlFor={`${provider.id}-apiKey`} className={LABEL}>
          {t("shippingCompanies.apiKeyLabel")}
        </label>
        <input
          id={`${provider.id}-apiKey`}
          name="apiKey"
          type="text"
          autoComplete="off"
          required={!summary}
          disabled={loading}
          className={FIELD}
          placeholder={
            summary
              ? t("shippingCompanies.keepKeyPlaceholder")
              : t("shippingCompanies.enterKeyPlaceholder")
          }
        />
        <FieldError errors={fieldErrors.apiKey} />
      </div>

      {error ? (
        <p
          role="alert"
          className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900/50 dark:bg-red-950/40 dark:text-red-300"
        >
          {error}
        </p>
      ) : null}

      {status === "success" ? (
        <p
          role="status"
          className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700 dark:border-emerald-900/50 dark:bg-emerald-950/40 dark:text-emerald-300"
        >
          {t("shippingCompanies.configSaved")}
        </p>
      ) : null}

      <button
        type="submit"
        disabled={loading}
        className="flex w-full items-center justify-center gap-2 rounded-lg bg-zinc-900 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-60 sm:w-auto dark:bg-white dark:text-black dark:hover:bg-zinc-200"
      >
        {loading ? (
          <>
            <Spinner />
            {t("common.saving")}
          </>
        ) : (
          t("shippingCompanies.saveConfig")
        )}
      </button>
    </form>
  );
}

function StatusBadge({ configured }) {
  const { t } = useLocale();
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium ${
        configured
          ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300"
          : "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400"
      }`}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${configured ? "bg-emerald-500" : "bg-zinc-400"}`} />
      {configured ? t("shippingCompanies.configured") : t("shippingCompanies.notConfigured")}
    </span>
  );
}

function FieldError({ errors }) {
  if (!errors || errors.length === 0) {
    return null;
  }
  return <p className="mt-1 text-xs text-red-600 dark:text-red-400">{errors[0]}</p>;
}

function Spinner() {
  return (
    <span
      aria-hidden="true"
      className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent"
    />
  );
}
