"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

const FIELD =
  "mt-1 block w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 shadow-sm outline-none transition focus:border-zinc-900 focus:ring-2 focus:ring-zinc-900/10 disabled:opacity-60 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-100 dark:focus:border-zinc-100 dark:focus:ring-zinc-100/10";

const LABEL = "block text-sm font-medium text-zinc-700 dark:text-zinc-300";

const SECTION_TITLE =
  "text-sm font-semibold text-zinc-900 dark:text-zinc-100";
const SECTION_HINT = "mt-0.5 text-xs text-zinc-500 dark:text-zinc-400";

function toNonNegativeInt(value) {
  if (value === "" || value === null || value === undefined) {
    return { ok: false };
  }
  const n = Number(value);
  return Number.isInteger(n) && n >= 0 ? { ok: true, value: n } : { ok: false };
}

export default function AddEmployeeForm() {
  const router = useRouter();

  const [status, setStatus] = useState("idle"); // idle | loading | error
  const [error, setError] = useState("");
  const [fieldErrors, setFieldErrors] = useState({});

  async function handleSubmit(event) {
    event.preventDefault();
    setError("");
    setFieldErrors({});

    const form = new FormData(event.currentTarget);
    const get = (key) => String(form.get(key) || "").trim();

    const name = get("name");
    const username = get("username");
    const phone = get("phone");
    const password = get("password");
    const confirmPassword = get("confirmPassword");
    const quickLivraisonApiKey = get("quickLivraisonApiKey");

    const threshold = toNonNegativeInt(get("threshold"));
    const commissionBelowThreshold = toNonNegativeInt(get("commissionBelowThreshold"));
    const commissionAtOrAboveThreshold = toNonNegativeInt(get("commissionAtOrAboveThreshold"));

    // Client-side validation — the server re-validates everything regardless.
    const errors = {};
    if (password !== confirmPassword) {
      errors.confirmPassword = ["Passwords do not match."];
    }
    if (!threshold.ok) errors["commission.threshold"] = ["Enter a whole number, 0 or more."];
    if (!commissionBelowThreshold.ok) {
      errors["commission.commissionBelowThreshold"] = ["Enter a whole number, 0 or more."];
    }
    if (!commissionAtOrAboveThreshold.ok) {
      errors["commission.commissionAtOrAboveThreshold"] = ["Enter a whole number, 0 or more."];
    }
    if (Object.keys(errors).length > 0) {
      setStatus("error");
      setFieldErrors(errors);
      return;
    }

    setStatus("loading");

    try {
      const res = await fetch("/api/employees", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          username,
          phone,
          password,
          commission: {
            threshold: threshold.value,
            commissionBelowThreshold: commissionBelowThreshold.value,
            commissionAtOrAboveThreshold: commissionAtOrAboveThreshold.value,
          },
          quickLivraisonApiKey: quickLivraisonApiKey || undefined,
        }),
      });
      const data = await res.json().catch(() => ({}));

      if (!res.ok) {
        setStatus("error");
        setError(data.error || "Unable to create the employee. Please try again.");
        setFieldErrors(data.fieldErrors || {});
        return;
      }

      router.push("/dashboard/employees?created=1");
      router.refresh();
    } catch {
      setStatus("error");
      setError("Network error. Please check your connection and try again.");
    }
  }

  const loading = status === "loading";

  return (
    <form onSubmit={handleSubmit} className="space-y-8" noValidate>
      <fieldset disabled={loading} className="space-y-4">
        <legend className={SECTION_TITLE}>Employee information</legend>

        <div>
          <label htmlFor="name" className={LABEL}>
            Name
          </label>
          <input id="name" name="name" type="text" required className={FIELD} placeholder="Full name" />
          <FieldError errors={fieldErrors.name} />
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <label htmlFor="username" className={LABEL}>
              Username
            </label>
            <input
              id="username"
              name="username"
              type="text"
              required
              autoComplete="off"
              className={FIELD}
              placeholder="jane.doe"
            />
            <p className="mt-1 text-xs text-zinc-400">
              Lowercase letters, digits, dot or underscore.
            </p>
            <FieldError errors={fieldErrors.username} />
          </div>

          <div>
            <label htmlFor="phone" className={LABEL}>
              Phone number
            </label>
            <input
              id="phone"
              name="phone"
              type="tel"
              required
              className={FIELD}
              placeholder="+212 6 00 00 00 00"
            />
            <FieldError errors={fieldErrors.phone} />
          </div>
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <label htmlFor="password" className={LABEL}>
              Password
            </label>
            <input
              id="password"
              name="password"
              type="password"
              required
              minLength={8}
              autoComplete="new-password"
              className={FIELD}
              placeholder="At least 8 characters"
            />
            <FieldError errors={fieldErrors.password} />
          </div>

          <div>
            <label htmlFor="confirmPassword" className={LABEL}>
              Confirm password
            </label>
            <input
              id="confirmPassword"
              name="confirmPassword"
              type="password"
              required
              autoComplete="new-password"
              className={FIELD}
              placeholder="Re-enter password"
            />
            <FieldError errors={fieldErrors.confirmPassword} />
          </div>
        </div>
      </fieldset>

      <fieldset disabled={loading} className="space-y-4 border-t border-zinc-200 pt-6 dark:border-zinc-800">
        <div>
          <legend className={SECTION_TITLE}>Commission</legend>
          <p className={SECTION_HINT}>
            Example: below the threshold pays one amount, at or above it pays another. Set your own values.
          </p>
        </div>

        <div>
          <label htmlFor="threshold" className={LABEL}>
            Threshold (orders)
          </label>
          <input
            id="threshold"
            name="threshold"
            type="number"
            min="0"
            step="1"
            required
            defaultValue={0}
            className={FIELD}
          />
          <FieldError errors={fieldErrors["commission.threshold"]} />
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <label htmlFor="commissionBelowThreshold" className={LABEL}>
              Commission below threshold (DH)
            </label>
            <input
              id="commissionBelowThreshold"
              name="commissionBelowThreshold"
              type="number"
              min="0"
              step="1"
              required
              defaultValue={0}
              className={FIELD}
            />
            <FieldError errors={fieldErrors["commission.commissionBelowThreshold"]} />
          </div>

          <div>
            <label htmlFor="commissionAtOrAboveThreshold" className={LABEL}>
              Commission at/above threshold (DH)
            </label>
            <input
              id="commissionAtOrAboveThreshold"
              name="commissionAtOrAboveThreshold"
              type="number"
              min="0"
              step="1"
              required
              defaultValue={0}
              className={FIELD}
            />
            <FieldError errors={fieldErrors["commission.commissionAtOrAboveThreshold"]} />
          </div>
        </div>
      </fieldset>

      <fieldset disabled={loading} className="space-y-4 border-t border-zinc-200 pt-6 dark:border-zinc-800">
        <div>
          <legend className={SECTION_TITLE}>Quick Livraison</legend>
          <p className={SECTION_HINT}>Optional — used to sync this employee&rsquo;s orders.</p>
        </div>

        <div>
          <label htmlFor="quickLivraisonApiKey" className={LABEL}>
            API key
          </label>
          <input
            id="quickLivraisonApiKey"
            name="quickLivraisonApiKey"
            type="text"
            autoComplete="off"
            className={FIELD}
            placeholder="Enter API key"
          />
          <FieldError errors={fieldErrors.quickLivraisonApiKey} />
        </div>
      </fieldset>

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
            Creating employee…
          </>
        ) : (
          "Create employee"
        )}
      </button>
    </form>
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
