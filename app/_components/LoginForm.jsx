"use client";

import { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";

import { useLocale } from "@/app/_components/i18n/LocaleProvider";
import { useNavigationProgress } from "@/app/_components/navigation/NavigationProgressProvider";

const FIELD =
  "mt-1 block w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 shadow-sm outline-none transition focus:border-zinc-900 focus:ring-2 focus:ring-zinc-900/10 disabled:opacity-60 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-100 dark:focus:border-zinc-100 dark:focus:ring-zinc-100/10";

const LABEL =
  "block text-sm font-medium text-zinc-700 dark:text-zinc-300";

function safeNext(value) {
  // only allow same-site absolute paths — blocks open redirects
  if (value && value.startsWith("/") && !value.startsWith("//")) {
    return value;
  }
  return "/dashboard";
}

export default function LoginForm() {
  const { t } = useLocale();
  const router = useRouter();
  const { startNavigation } = useNavigationProgress();
  const searchParams = useSearchParams();
  const destination = safeNext(searchParams.get("next"));

  const [status, setStatus] = useState("idle"); // idle | loading | error
  const [error, setError] = useState("");

  async function handleSubmit(event) {
    event.preventDefault();
    setStatus("loading");
    setError("");

    const form = new FormData(event.currentTarget);
    const payload = {
      identifier: String(form.get("identifier") || ""),
      password: String(form.get("password") || ""),
    };

    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json().catch(() => ({}));

      if (!res.ok) {
        setStatus("error");
        setError(data.error || t("auth.unableToSignIn"));
        return;
      }

      startNavigation();
      router.replace(destination);
      router.refresh();
    } catch {
      setStatus("error");
      setError(t("auth.networkError"));
    }
  }

  const loading = status === "loading";

  return (
    <form onSubmit={handleSubmit} className="space-y-4" noValidate>
      <div>
        <label htmlFor="identifier" className={LABEL}>
          {t("auth.emailOrUsername")}
        </label>
        <input
          id="identifier"
          name="identifier"
          type="text"
          autoComplete="username"
          required
          disabled={loading}
          className={FIELD}
          placeholder={t("auth.emailOrUsernamePlaceholder")}
        />
      </div>

      <div>
        <label htmlFor="password" className={LABEL}>
          {t("auth.password")}
        </label>
        <input
          id="password"
          name="password"
          type="password"
          autoComplete="current-password"
          required
          disabled={loading}
          className={FIELD}
          placeholder="••••••••"
        />
      </div>

      {error ? (
        <p
          role="alert"
          className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900/50 dark:bg-red-950/40 dark:text-red-300"
        >
          {error}
        </p>
      ) : null}

      <button
        type="submit"
        disabled={loading}
        className="flex w-full items-center justify-center gap-2 rounded-lg bg-zinc-900 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-60 dark:bg-white dark:text-black dark:hover:bg-zinc-200"
      >
        {loading ? (
          <>
            <Spinner />
            {t("auth.signingIn")}
          </>
        ) : (
          t("auth.signIn")
        )}
      </button>
    </form>
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
