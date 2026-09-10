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
  ALERT_SUCCESS,
  FieldError,
  Spinner,
} from "@/app/_components/ui/form";
import { useLocale } from "@/app/_components/i18n/LocaleProvider";
import { roleLabel } from "@/lib/auth/roles";

/**
 * One settings implementation for every role — which fields render is
 * driven entirely by what's present on `user` (has `email` vs. `username`),
 * the same optional-field pattern app/dashboard/page.jsx already uses for
 * its account rows. See app/api/settings/profile and .../password for the
 * server side.
 *
 * Renders its own heading (via t()) so the whole screen follows the active
 * locale — the page shell is an async server component. The signed-in role
 * name comes from roleLabel(); it is a fixed app term, shown as-is.
 */
export default function SettingsForm({ user }) {
  const { t } = useLocale();

  return (
    <div className="space-y-8">
      <header className="mb-6 sm:mb-8">
        <h1 className="text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
          {t("settings.title")}
        </h1>
        <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">{t("settings.subtitle")}</p>
      </header>

      <ProfileSection user={user} />
      <PasswordSection />
    </div>
  );
}

function ProfileSection({ user }) {
  const router = useRouter();
  const { t } = useLocale();
  const isEmployee = user.username != null;

  const [status, setStatus] = useState("idle"); // idle | loading | success | error
  const [error, setError] = useState("");
  const [fieldErrors, setFieldErrors] = useState({});

  async function handleSubmit(event) {
    event.preventDefault();
    setError("");
    setFieldErrors({});
    setStatus("loading");

    const form = new FormData(event.currentTarget);
    const payload = {
      name: String(form.get("name") || "").trim(),
      phone: String(form.get("phone") || "").trim(),
    };
    if (isEmployee) {
      payload.username = String(form.get("username") || "").trim();
    } else {
      payload.email = String(form.get("email") || "").trim();
    }

    try {
      const res = await fetch("/api/settings/profile", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json().catch(() => ({}));

      if (!res.ok) {
        setStatus("error");
        setError(data.error || t("settings.saveFailed"));
        setFieldErrors(data.fieldErrors || {});
        return;
      }

      setStatus("success");
      router.refresh();
    } catch {
      setStatus("error");
      setError(t("settings.networkError"));
    }
  }

  const loading = status === "loading";

  return (
    <section className="rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm sm:p-8 dark:border-zinc-800 dark:bg-zinc-900">
      <h2 className={SECTION_TITLE}>{t("settings.profile")}</h2>
      <p className={SECTION_HINT}>
        {t("settings.signedInAs")} {roleLabel(user.role)}.
      </p>

      <form onSubmit={handleSubmit} className="mt-5 space-y-4" noValidate>
        <fieldset disabled={loading} className="space-y-4">
          <div>
            <label htmlFor="name" className={LABEL}>
              {t("settings.name")}
            </label>
            <input
              id="name"
              name="name"
              type="text"
              required
              defaultValue={user.name}
              className={FIELD}
            />
            <FieldError errors={fieldErrors.name} />
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            {isEmployee ? (
              <div>
                <label htmlFor="username" className={LABEL}>
                  {t("settings.username")}
                </label>
                <input
                  id="username"
                  name="username"
                  type="text"
                  required
                  autoComplete="off"
                  defaultValue={user.username ?? ""}
                  className={FIELD}
                />
                <FieldError errors={fieldErrors.username} />
              </div>
            ) : (
              <div>
                <label htmlFor="email" className={LABEL}>
                  {t("settings.email")}
                </label>
                <input
                  id="email"
                  name="email"
                  type="email"
                  required
                  defaultValue={user.email ?? ""}
                  className={FIELD}
                />
                <FieldError errors={fieldErrors.email} />
              </div>
            )}

            <div>
              <label htmlFor="phone" className={LABEL}>
                {t("settings.phone")}
              </label>
              <input
                id="phone"
                name="phone"
                type="tel"
                defaultValue={user.phone ?? ""}
                className={FIELD}
              />
              <FieldError errors={fieldErrors.phone} />
            </div>
          </div>
        </fieldset>

        {status === "error" && error ? (
          <p role="alert" className={ALERT_ERROR}>
            {error}
          </p>
        ) : null}
        {status === "success" ? (
          <p role="status" className={ALERT_SUCCESS}>
            {t("settings.profileUpdated")}
          </p>
        ) : null}

        <button type="submit" disabled={loading} className={BUTTON_PRIMARY}>
          {loading ? (
            <>
              <Spinner />
              {t("common.saving")}
            </>
          ) : (
            t("settings.saveProfile")
          )}
        </button>
      </form>
    </section>
  );
}

function PasswordSection() {
  const { t } = useLocale();
  const [status, setStatus] = useState("idle"); // idle | loading | success | error
  const [error, setError] = useState("");
  const [fieldErrors, setFieldErrors] = useState({});

  async function handleSubmit(event) {
    event.preventDefault();
    setError("");
    setFieldErrors({});
    setStatus("loading");

    const form = new FormData(event.currentTarget);
    const payload = {
      currentPassword: String(form.get("currentPassword") || ""),
      newPassword: String(form.get("newPassword") || ""),
      confirmNewPassword: String(form.get("confirmNewPassword") || ""),
    };

    try {
      const res = await fetch("/api/settings/password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json().catch(() => ({}));

      if (!res.ok) {
        setStatus("error");
        setError(data.error || t("settings.passwordChangeFailed"));
        setFieldErrors(data.fieldErrors || {});
        return;
      }

      setStatus("success");
      event.currentTarget.reset();
    } catch {
      setStatus("error");
      setError(t("settings.networkError"));
    }
  }

  const loading = status === "loading";

  return (
    <section className="rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm sm:p-8 dark:border-zinc-800 dark:bg-zinc-900">
      <h2 className={SECTION_TITLE}>{t("settings.security")}</h2>
      <p className={SECTION_HINT}>{t("settings.changePasswordHint")}</p>

      <form onSubmit={handleSubmit} className="mt-5 space-y-4" noValidate>
        <fieldset disabled={loading} className="space-y-4">
          <div>
            <label htmlFor="currentPassword" className={LABEL}>
              {t("settings.currentPassword")}
            </label>
            <input
              id="currentPassword"
              name="currentPassword"
              type="password"
              required
              autoComplete="current-password"
              className={FIELD}
            />
            <FieldError errors={fieldErrors.currentPassword} />
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label htmlFor="newPassword" className={LABEL}>
                {t("settings.newPassword")}
              </label>
              <input
                id="newPassword"
                name="newPassword"
                type="password"
                required
                minLength={8}
                autoComplete="new-password"
                className={FIELD}
              />
              <FieldError errors={fieldErrors.newPassword} />
            </div>
            <div>
              <label htmlFor="confirmNewPassword" className={LABEL}>
                {t("settings.confirmNewPassword")}
              </label>
              <input
                id="confirmNewPassword"
                name="confirmNewPassword"
                type="password"
                required
                autoComplete="new-password"
                className={FIELD}
              />
              <FieldError errors={fieldErrors.confirmNewPassword} />
            </div>
          </div>
        </fieldset>

        {status === "error" && error ? (
          <p role="alert" className={ALERT_ERROR}>
            {error}
          </p>
        ) : null}
        {status === "success" ? (
          <p role="status" className={ALERT_SUCCESS}>
            {t("settings.passwordChanged")}
          </p>
        ) : null}

        <button type="submit" disabled={loading} className={BUTTON_PRIMARY}>
          {loading ? (
            <>
              <Spinner />
              {t("settings.changingPassword")}
            </>
          ) : (
            t("settings.changePassword")
          )}
        </button>
      </form>
    </section>
  );
}
