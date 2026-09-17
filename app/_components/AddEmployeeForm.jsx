"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";

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
import { useLocale } from "@/app/_components/i18n/LocaleProvider";
import { useNavigationProgress } from "@/app/_components/navigation/NavigationProgressProvider";

function toNonNegativeInt(value) {
  if (value === "" || value === null || value === undefined) {
    return { ok: false };
  }
  const n = Number(value);
  return Number.isInteger(n) && n >= 0 ? { ok: true, value: n } : { ok: false };
}

/**
 * Renders its own back-link + heading + subtitle (all via t()) so the whole
 * Add-Employee screen follows the active locale — the page shell
 * (app/dashboard/employees/new/page.jsx) is an async server component and
 * can't. The "Quick Livraison" section title is a company name, shown
 * verbatim.
 */
export default function AddEmployeeForm() {
  const router = useRouter();
  const { startNavigation } = useNavigationProgress();
  const { t } = useLocale();

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
      errors.confirmPassword = [t("employeeForm.passwordsNoMatch")];
    }
    if (!threshold.ok) errors["commission.threshold"] = [t("employeeForm.wholeNumberError")];
    if (!commissionBelowThreshold.ok) {
      errors["commission.commissionBelowThreshold"] = [t("employeeForm.wholeNumberError")];
    }
    if (!commissionAtOrAboveThreshold.ok) {
      errors["commission.commissionAtOrAboveThreshold"] = [t("employeeForm.wholeNumberError")];
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
        setError(data.error || t("employeeForm.createFailed"));
        setFieldErrors(data.fieldErrors || {});
        return;
      }

      startNavigation();
      router.push("/dashboard/employees?created=1");
      router.refresh();
    } catch {
      setStatus("error");
      setError(t("employeeForm.networkError"));
    }
  }

  const loading = status === "loading";

  return (
    <div>
      <Link
        href="/dashboard/employees"
        className="text-sm font-medium text-zinc-500 underline underline-offset-2 dark:text-zinc-400"
      >
        {t("employeeForm.backToEmployees")}
      </Link>

      <h1 className="mt-3 text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
        {t("employeeForm.newTitle")}
      </h1>
      <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">{t("employeeForm.newSubtitle")}</p>

      <div className="mt-8 rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm sm:p-8 dark:border-zinc-800 dark:bg-zinc-900">
        <form onSubmit={handleSubmit} className="space-y-8" noValidate>
          <fieldset disabled={loading} className="space-y-4">
            <legend className={SECTION_TITLE}>{t("employeeForm.information")}</legend>

            <div>
              <label htmlFor="name" className={LABEL}>
                {t("employeeForm.name")}
              </label>
              <input
                id="name"
                name="name"
                type="text"
                required
                className={FIELD}
                placeholder={t("employeeForm.fullNamePlaceholder")}
              />
              <FieldError errors={fieldErrors.name} />
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div>
                <label htmlFor="username" className={LABEL}>
                  {t("employeeForm.username")}
                </label>
                <input
                  id="username"
                  name="username"
                  type="text"
                  required
                  autoComplete="off"
                  className={FIELD}
                  placeholder={t("employeeForm.usernamePlaceholder")}
                />
                <p className="mt-1 text-xs text-zinc-400">{t("employeeForm.usernameHint")}</p>
                <FieldError errors={fieldErrors.username} />
              </div>

              <div>
                <label htmlFor="phone" className={LABEL}>
                  {t("employeeForm.phone")}
                </label>
                <input
                  id="phone"
                  name="phone"
                  type="tel"
                  required
                  className={FIELD}
                  placeholder={t("employeeForm.phonePlaceholder")}
                />
                <FieldError errors={fieldErrors.phone} />
              </div>
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div>
                <label htmlFor="password" className={LABEL}>
                  {t("employeeForm.password")}
                </label>
                <input
                  id="password"
                  name="password"
                  type="password"
                  required
                  minLength={8}
                  autoComplete="new-password"
                  className={FIELD}
                  placeholder={t("employeeForm.passwordPlaceholder")}
                />
                <FieldError errors={fieldErrors.password} />
              </div>

              <div>
                <label htmlFor="confirmPassword" className={LABEL}>
                  {t("employeeForm.confirmPassword")}
                </label>
                <input
                  id="confirmPassword"
                  name="confirmPassword"
                  type="password"
                  required
                  autoComplete="new-password"
                  className={FIELD}
                  placeholder={t("employeeForm.reenterPasswordPlaceholder")}
                />
                <FieldError errors={fieldErrors.confirmPassword} />
              </div>
            </div>
          </fieldset>

          <fieldset
            disabled={loading}
            className="space-y-4 border-t border-zinc-200 pt-6 dark:border-zinc-800"
          >
            <div>
              <legend className={SECTION_TITLE}>{t("employeeForm.commission")}</legend>
              <p className={SECTION_HINT}>{t("employeeForm.commissionHintNew")}</p>
            </div>

            <div>
              <label htmlFor="threshold" className={LABEL}>
                {t("employeeForm.threshold")}
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
                  {t("employeeForm.commissionBelow")}
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
                  {t("employeeForm.commissionAtOrAbove")}
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

          <fieldset
            disabled={loading}
            className="space-y-4 border-t border-zinc-200 pt-6 dark:border-zinc-800"
          >
            <div>
              {/* company name — verbatim */}
              <legend className={SECTION_TITLE}>Quick Livraison</legend>
              <p className={SECTION_HINT}>{t("employeeForm.quickHintNew")}</p>
            </div>

            <div>
              <label htmlFor="quickLivraisonApiKey" className={LABEL}>
                {t("employeeForm.apiKey")}
              </label>
              <input
                id="quickLivraisonApiKey"
                name="quickLivraisonApiKey"
                type="text"
                autoComplete="off"
                className={FIELD}
                placeholder={t("employeeForm.apiKeyPlaceholder")}
              />
              <FieldError errors={fieldErrors.quickLivraisonApiKey} />
            </div>
          </fieldset>

          {error ? (
            <p role="alert" className={ALERT_ERROR}>
              {error}
            </p>
          ) : null}

          <button type="submit" disabled={loading} className={`w-full ${BUTTON_PRIMARY}`}>
            {loading ? (
              <>
                <Spinner />
                {t("employeeForm.creatingEmployee")}
              </>
            ) : (
              t("employeeForm.createEmployee")
            )}
          </button>
        </form>
      </div>
    </div>
  );
}
