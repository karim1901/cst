"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import {
  FIELD,
  LABEL,
  SECTION_TITLE,
  SECTION_HINT,
  BUTTON_PRIMARY,
  ALERT_ERROR,
  FieldError,
  Spinner,
} from "@/app/_components/ui/form";

function toNonNegativeInt(value) {
  if (value === "" || value === null || value === undefined) return { ok: false };
  const n = Number(value);
  return Number.isInteger(n) && n >= 0 ? { ok: true, value: n } : { ok: false };
}

/**
 * Edit an existing employee — same fields/validation conventions as
 * AddEmployeeForm, but every field is optional (blank password = keep the
 * current one) and it also exposes the real, live `ozonTrackingCounter`
 * value for a merchant to administratively correct. See
 * app/api/employees/[id]/route.js's PATCH handler for the server side.
 */
export default function EditEmployeeForm({ employee }) {
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

    const password = get("password");
    const confirmPassword = get("confirmPassword");
    const threshold = toNonNegativeInt(get("threshold"));
    const commissionBelowThreshold = toNonNegativeInt(get("commissionBelowThreshold"));
    const commissionAtOrAboveThreshold = toNonNegativeInt(get("commissionAtOrAboveThreshold"));
    const counterRaw = get("ozonTrackingCounter");

    const errors = {};
    if (password && password !== confirmPassword) {
      errors.confirmPassword = ["Passwords do not match."];
    }
    if (password && password.length < 8) {
      errors.password = ["Password must be at least 8 characters."];
    }
    if (!threshold.ok) errors["commission.threshold"] = ["Enter a whole number, 0 or more."];
    if (!commissionBelowThreshold.ok) {
      errors["commission.commissionBelowThreshold"] = ["Enter a whole number, 0 or more."];
    }
    if (!commissionAtOrAboveThreshold.ok) {
      errors["commission.commissionAtOrAboveThreshold"] = ["Enter a whole number, 0 or more."];
    }
    if (counterRaw && (!Number.isInteger(Number(counterRaw)) || Number(counterRaw) < 1000)) {
      errors.ozonTrackingCounter = ["Must be a whole number, 1000 or greater."];
    }
    if (Object.keys(errors).length > 0) {
      setStatus("error");
      setFieldErrors(errors);
      return;
    }

    setStatus("loading");

    const payload = {
      name: get("name"),
      username: get("username"),
      phone: get("phone"),
      commission: {
        threshold: threshold.value,
        commissionBelowThreshold: commissionBelowThreshold.value,
        commissionAtOrAboveThreshold: commissionAtOrAboveThreshold.value,
      },
    };
    if (password) payload.password = password;
    const quickKey = get("quickLivraisonApiKey");
    if (quickKey) payload.quickLivraisonApiKey = quickKey;
    if (counterRaw) payload.ozonTrackingCounter = Number(counterRaw);

    try {
      const res = await fetch(`/api/employees/${employee.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json().catch(() => ({}));

      if (!res.ok) {
        setStatus("error");
        setError(data.error || "Unable to save changes. Please try again.");
        setFieldErrors(data.fieldErrors || {});
        return;
      }

      router.push("/dashboard/employees?updated=1");
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
          <label htmlFor="name" className={LABEL}>Name</label>
          <input
            id="name"
            name="name"
            type="text"
            required
            defaultValue={employee.name}
            className={FIELD}
          />
          <FieldError errors={fieldErrors.name} />
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <label htmlFor="username" className={LABEL}>Username</label>
            <input
              id="username"
              name="username"
              type="text"
              required
              autoComplete="off"
              defaultValue={employee.username ?? ""}
              className={FIELD}
            />
            <FieldError errors={fieldErrors.username} />
          </div>

          <div>
            <label htmlFor="phone" className={LABEL}>Phone number</label>
            <input
              id="phone"
              name="phone"
              type="tel"
              required
              defaultValue={employee.phone ?? ""}
              className={FIELD}
            />
            <FieldError errors={fieldErrors.phone} />
          </div>
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <label htmlFor="password" className={LABEL}>New password</label>
            <input
              id="password"
              name="password"
              type="password"
              minLength={8}
              autoComplete="new-password"
              placeholder="Leave blank to keep the current password"
              className={FIELD}
            />
            <FieldError errors={fieldErrors.password} />
          </div>

          <div>
            <label htmlFor="confirmPassword" className={LABEL}>Confirm new password</label>
            <input
              id="confirmPassword"
              name="confirmPassword"
              type="password"
              autoComplete="new-password"
              className={FIELD}
            />
            <FieldError errors={fieldErrors.confirmPassword} />
          </div>
        </div>
      </fieldset>

      <fieldset disabled={loading} className="space-y-4 border-t border-zinc-200 pt-6 dark:border-zinc-800">
        <div>
          <legend className={SECTION_TITLE}>Commission</legend>
          <p className={SECTION_HINT}>
            Below the threshold pays one amount, at or above it pays another.
          </p>
        </div>

        <div>
          <label htmlFor="threshold" className={LABEL}>Threshold (orders)</label>
          <input
            id="threshold"
            name="threshold"
            type="number"
            min="0"
            step="1"
            required
            defaultValue={employee.commission?.threshold ?? 0}
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
              defaultValue={employee.commission?.commissionBelowThreshold ?? 0}
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
              defaultValue={employee.commission?.commissionAtOrAboveThreshold ?? 0}
              className={FIELD}
            />
            <FieldError errors={fieldErrors["commission.commissionAtOrAboveThreshold"]} />
          </div>
        </div>
      </fieldset>

      <fieldset disabled={loading} className="space-y-4 border-t border-zinc-200 pt-6 dark:border-zinc-800">
        <div>
          <legend className={SECTION_TITLE}>Quick Livraison</legend>
          <p className={SECTION_HINT}>
            {employee.hasQuickLivraisonApiKey
              ? "A key is already configured. Enter a new one to replace it, or leave blank to keep it."
              : "Optional — used to sync this employee's orders."}
          </p>
        </div>

        <div>
          <label htmlFor="quickLivraisonApiKey" className={LABEL}>API key</label>
          <input
            id="quickLivraisonApiKey"
            name="quickLivraisonApiKey"
            type="text"
            autoComplete="off"
            placeholder={employee.hasQuickLivraisonApiKey ? "Leave blank to keep the current key" : "Enter API key"}
            className={FIELD}
          />
          <FieldError errors={fieldErrors.quickLivraisonApiKey} />
        </div>
      </fieldset>

      <fieldset disabled={loading} className="space-y-4 border-t border-zinc-200 pt-6 dark:border-zinc-800">
        <div>
          <legend className={SECTION_TITLE}>Ozon tracking counter</legend>
          <p className={SECTION_HINT}>
            The live counter this employee&rsquo;s next Ozon Express tracking number will use.
            Only change this to administratively correct it — it is not reset automatically and
            this is the same counter order creation uses, not a separate one.
          </p>
        </div>

        <div>
          <label htmlFor="ozonTrackingCounter" className={LABEL}>
            Ozon Tracking Counter
          </label>
          <input
            id="ozonTrackingCounter"
            name="ozonTrackingCounter"
            type="number"
            min="1000"
            step="1"
            placeholder="Never used yet"
            defaultValue={employee.ozonTrackingCounter ?? ""}
            className={FIELD}
          />
          <p className="mt-1 text-xs text-zinc-400">
            Current database value:{" "}
            <span className="font-mono">{employee.ozonTrackingCounter ?? "not set yet"}</span>
          </p>
          <FieldError errors={fieldErrors.ozonTrackingCounter} />
        </div>
      </fieldset>

      {error ? <p role="alert" className={ALERT_ERROR}>{error}</p> : null}

      <button type="submit" disabled={loading} className={`w-full ${BUTTON_PRIMARY}`}>
        {loading ? (
          <>
            <Spinner />
            Saving…
          </>
        ) : (
          "Save changes"
        )}
      </button>
    </form>
  );
}
