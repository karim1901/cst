"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import { useLocale } from "@/app/_components/i18n/LocaleProvider";

const FIELD =
  "mt-1 block w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 shadow-sm outline-none transition focus:border-zinc-900 focus:ring-2 focus:ring-zinc-900/10 disabled:opacity-60 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-100 dark:focus:border-zinc-100 dark:focus:ring-zinc-100/10";

const LABEL = "block text-sm font-medium text-zinc-700 dark:text-zinc-300";

export default function RegisterForm() {
  const { t } = useLocale();
  const router = useRouter();

  const [status, setStatus] = useState("idle"); // idle | loading | error | success
  const [error, setError] = useState("");
  const [fieldErrors, setFieldErrors] = useState({});

  async function handleSubmit(event) {
    event.preventDefault();
    setError("");
    setFieldErrors({});

    const form = new FormData(event.currentTarget);
    const name = String(form.get("name") || "").trim();
    const email = String(form.get("email") || "").trim();
    const password = String(form.get("password") || "");
    const confirmPassword = String(form.get("confirmPassword") || "");

    if (password !== confirmPassword) {
      setStatus("error");
      setFieldErrors({ confirmPassword: [t("auth.passwordsNoMatch")] });
      return;
    }

    setStatus("loading");

    try {
      const res = await fetch("/api/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, email, password }),
      });
      const data = await res.json().catch(() => ({}));

      if (!res.ok) {
        setStatus("error");
        setError(data.error || t("auth.unableToRegister"));
        setFieldErrors(data.fieldErrors || {});
        return;
      }

      setStatus("success");
      router.replace("/dashboard");
      router.refresh();
    } catch {
      setStatus("error");
      setError(t("auth.networkError"));
    }
  }

  const loading = status === "loading";
  const succeeded = status === "success";

  return (
    <form onSubmit={handleSubmit} className="space-y-4" noValidate>
      <div>
        <label htmlFor="name" className={LABEL}>
          {t("auth.businessOwnerName")}
        </label>
        <input
          id="name"
          name="name"
          type="text"
          autoComplete="name"
          required
          disabled={loading || succeeded}
          className={FIELD}
          placeholder={t("auth.businessNamePlaceholder")}
        />
        <FieldError errors={fieldErrors.name} />
      </div>

      <div>
        <label htmlFor="email" className={LABEL}>
          {t("auth.email")}
        </label>
        <input
          id="email"
          name="email"
          type="email"
          autoComplete="email"
          required
          disabled={loading || succeeded}
          className={FIELD}
          placeholder={t("auth.emailPlaceholder")}
        />
        <FieldError errors={fieldErrors.email} />
      </div>

      <div>
        <label htmlFor="password" className={LABEL}>
          {t("auth.password")}
        </label>
        <input
          id="password"
          name="password"
          type="password"
          autoComplete="new-password"
          required
          minLength={8}
          disabled={loading || succeeded}
          className={FIELD}
          placeholder={t("auth.passwordPlaceholder")}
        />
        <FieldError errors={fieldErrors.password} />
      </div>

      <div>
        <label htmlFor="confirmPassword" className={LABEL}>
          {t("auth.confirmPassword")}
        </label>
        <input
          id="confirmPassword"
          name="confirmPassword"
          type="password"
          autoComplete="new-password"
          required
          disabled={loading || succeeded}
          className={FIELD}
          placeholder={t("auth.confirmPasswordPlaceholder")}
        />
        <FieldError errors={fieldErrors.confirmPassword} />
      </div>

      {error ? (
        <p
          role="alert"
          className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900/50 dark:bg-red-950/40 dark:text-red-300"
        >
          {error}
        </p>
      ) : null}

      {succeeded ? (
        <p
          role="status"
          className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700 dark:border-emerald-900/50 dark:bg-emerald-950/40 dark:text-emerald-300"
        >
          {t("auth.accountCreated")}
        </p>
      ) : null}

      <button
        type="submit"
        disabled={loading || succeeded}
        className="flex w-full items-center justify-center gap-2 rounded-lg bg-zinc-900 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-60 dark:bg-white dark:text-black dark:hover:bg-zinc-200"
      >
        {loading ? (
          <>
            <Spinner />
            {t("auth.creatingAccount")}
          </>
        ) : (
          t("auth.createMerchantAccount")
        )}
      </button>
    </form>
  );
}

function FieldError({ errors }) {
  if (!errors || errors.length === 0) {
    return null;
  }
  return (
    <p className="mt-1 text-xs text-red-600 dark:text-red-400">{errors[0]}</p>
  );
}

function Spinner() {
  return (
    <span
      aria-hidden="true"
      className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent"
    />
  );
}
