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
 *
 * Renders its own back-link + heading (via t()) so the whole screen
 * follows the active locale — the page shell is an async server component.
 * The employee's name / @username in the heading are real data, shown
 * verbatim; only the "Edit" label around the name is translated.
 */
export default function EditEmployeeForm({ employee }) {
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

    const password = get("password");
    const confirmPassword = get("confirmPassword");
    const threshold = toNonNegativeInt(get("threshold"));
    const commissionBelowThreshold = toNonNegativeInt(get("commissionBelowThreshold"));
    const commissionAtOrAboveThreshold = toNonNegativeInt(get("commissionAtOrAboveThreshold"));
    const counterRaw = get("ozonTrackingCounter");

    const errors = {};
    if (password && password !== confirmPassword) {
      errors.confirmPassword = [t("employeeForm.passwordsNoMatch")];
    }
    if (password && password.length < 8) {
      errors.password = [t("employeeForm.passwordTooShort")];
    }
    if (!threshold.ok) errors["commission.threshold"] = [t("employeeForm.wholeNumberError")];
    if (!commissionBelowThreshold.ok) {
      errors["commission.commissionBelowThreshold"] = [t("employeeForm.wholeNumberError")];
    }
    if (!commissionAtOrAboveThreshold.ok) {
      errors["commission.commissionAtOrAboveThreshold"] = [t("employeeForm.wholeNumberError")];
    }
    if (counterRaw && (!Number.isInteger(Number(counterRaw)) || Number(counterRaw) < 1000)) {
      errors.ozonTrackingCounter = [t("employeeForm.counterError")];
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
        setError(data.error || t("employeeForm.saveFailed"));
        setFieldErrors(data.fieldErrors || {});
        return;
      }

      startNavigation();
      router.push("/dashboard/employees?updated=1");
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
        {/* label translated, employee name verbatim */}
        {t("common.edit")} {employee.name}
      </h1>
      <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">@{employee.username}</p>

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
                defaultValue={employee.name}
                className={FIELD}
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
                  defaultValue={employee.username ?? ""}
                  className={FIELD}
                />
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
                  defaultValue={employee.phone ?? ""}
                  className={FIELD}
                />
                <FieldError errors={fieldErrors.phone} />
              </div>
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div>
                <label htmlFor="password" className={LABEL}>
                  {t("employeeForm.newPassword")}
                </label>
                <input
                  id="password"
                  name="password"
                  type="password"
                  minLength={8}
                  autoComplete="new-password"
                  placeholder={t("employeeForm.keepPasswordPlaceholder")}
                  className={FIELD}
                />
                <FieldError errors={fieldErrors.password} />
              </div>

              <div>
                <label htmlFor="confirmPassword" className={LABEL}>
                  {t("employeeForm.confirmNewPassword")}
                </label>
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

          <fieldset
            disabled={loading}
            className="space-y-4 border-t border-zinc-200 pt-6 dark:border-zinc-800"
          >
            <div>
              <legend className={SECTION_TITLE}>{t("employeeForm.commission")}</legend>
              <p className={SECTION_HINT}>{t("employeeForm.commissionHintEdit")}</p>
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
                defaultValue={employee.commission?.threshold ?? 0}
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
                  defaultValue={employee.commission?.commissionBelowThreshold ?? 0}
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
                  defaultValue={employee.commission?.commissionAtOrAboveThreshold ?? 0}
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
              <p className={SECTION_HINT}>
                {employee.hasQuickLivraisonApiKey
                  ? t("employeeForm.quickHintEditHasKey")
                  : t("employeeForm.quickHintEditNoKey")}
              </p>
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
                placeholder={
                  employee.hasQuickLivraisonApiKey
                    ? t("employeeForm.keepApiKeyPlaceholder")
                    : t("employeeForm.apiKeyPlaceholder")
                }
                className={FIELD}
              />
              <FieldError errors={fieldErrors.quickLivraisonApiKey} />
            </div>
          </fieldset>

          <fieldset
            disabled={loading}
            className="space-y-4 border-t border-zinc-200 pt-6 dark:border-zinc-800"
          >
            <div>
              <legend className={SECTION_TITLE}>{t("employeeForm.counterTitle")}</legend>
              <p className={SECTION_HINT}>{t("employeeForm.counterHint")}</p>
            </div>

            <div>
              <label htmlFor="ozonTrackingCounter" className={LABEL}>
                {t("employeeForm.counterLabel")}
              </label>
              <input
                id="ozonTrackingCounter"
                name="ozonTrackingCounter"
                type="number"
                min="1000"
                step="1"
                placeholder={t("employeeForm.counterPlaceholder")}
                defaultValue={employee.ozonTrackingCounter ?? ""}
                className={FIELD}
              />
              <p className="mt-1 text-xs text-zinc-400">
                {t("employeeForm.counterCurrentValue")}{" "}
                <span className="font-mono">
                  {employee.ozonTrackingCounter ?? t("employeeForm.counterNotSet")}
                </span>
              </p>
              <FieldError errors={fieldErrors.ozonTrackingCounter} />
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
                {t("common.saving")}
              </>
            ) : (
              t("employeeForm.saveChanges")
            )}
          </button>
        </form>
      </div>
    </div>
  );
}
