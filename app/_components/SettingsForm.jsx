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
import { roleLabel } from "@/lib/auth/roles";

/**
 * One settings implementation for every role — which fields render is
 * driven entirely by what's present on `user` (has `email` vs. `username`),
 * the same optional-field pattern app/dashboard/page.jsx already uses for
 * its account rows. See app/api/settings/profile and .../password for the
 * server side.
 */
export default function SettingsForm({ user }) {
  return (
    <div className="space-y-8">
      <ProfileSection user={user} />
      <PasswordSection />
    </div>
  );
}

function ProfileSection({ user }) {
  const router = useRouter();
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
        setError(data.error || "Unable to save changes. Please try again.");
        setFieldErrors(data.fieldErrors || {});
        return;
      }

      setStatus("success");
      router.refresh();
    } catch {
      setStatus("error");
      setError("Network error. Please check your connection and try again.");
    }
  }

  const loading = status === "loading";

  return (
    <section className="rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm sm:p-8 dark:border-zinc-800 dark:bg-zinc-900">
      <h2 className={SECTION_TITLE}>Profile</h2>
      <p className={SECTION_HINT}>Signed in as {roleLabel(user.role)}.</p>

      <form onSubmit={handleSubmit} className="mt-5 space-y-4" noValidate>
        <fieldset disabled={loading} className="space-y-4">
          <div>
            <label htmlFor="name" className={LABEL}>Name</label>
            <input id="name" name="name" type="text" required defaultValue={user.name} className={FIELD} />
            <FieldError errors={fieldErrors.name} />
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            {isEmployee ? (
              <div>
                <label htmlFor="username" className={LABEL}>Username</label>
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
                <label htmlFor="email" className={LABEL}>Email</label>
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
              <label htmlFor="phone" className={LABEL}>Phone number</label>
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

        {status === "error" && error ? <p role="alert" className={ALERT_ERROR}>{error}</p> : null}
        {status === "success" ? (
          <p role="status" className={ALERT_SUCCESS}>Profile updated.</p>
        ) : null}

        <button type="submit" disabled={loading} className={BUTTON_PRIMARY}>
          {loading ? (
            <>
              <Spinner />
              Saving…
            </>
          ) : (
            "Save profile"
          )}
        </button>
      </form>
    </section>
  );
}

function PasswordSection() {
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
        setError(data.error || "Unable to change your password. Please try again.");
        setFieldErrors(data.fieldErrors || {});
        return;
      }

      setStatus("success");
      event.currentTarget.reset();
    } catch {
      setStatus("error");
      setError("Network error. Please check your connection and try again.");
    }
  }

  const loading = status === "loading";

  return (
    <section className="rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm sm:p-8 dark:border-zinc-800 dark:bg-zinc-900">
      <h2 className={SECTION_TITLE}>Security</h2>
      <p className={SECTION_HINT}>Change your password.</p>

      <form onSubmit={handleSubmit} className="mt-5 space-y-4" noValidate>
        <fieldset disabled={loading} className="space-y-4">
          <div>
            <label htmlFor="currentPassword" className={LABEL}>Current password</label>
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
              <label htmlFor="newPassword" className={LABEL}>New password</label>
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
              <label htmlFor="confirmNewPassword" className={LABEL}>Confirm new password</label>
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

        {status === "error" && error ? <p role="alert" className={ALERT_ERROR}>{error}</p> : null}
        {status === "success" ? (
          <p role="status" className={ALERT_SUCCESS}>Password changed.</p>
        ) : null}

        <button type="submit" disabled={loading} className={BUTTON_PRIMARY}>
          {loading ? (
            <>
              <Spinner />
              Changing…
            </>
          ) : (
            "Change password"
          )}
        </button>
      </form>
    </section>
  );
}
