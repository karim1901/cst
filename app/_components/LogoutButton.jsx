"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import { useLocale } from "@/app/_components/i18n/LocaleProvider";

const LOGOUT_ICON = (
  <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.75" className="h-4.5 w-4.5">
    <path strokeLinecap="round" strokeLinejoin="round" d="M7.5 3.5H5a1.5 1.5 0 0 0-1.5 1.5v10A1.5 1.5 0 0 0 5 16.5h2.5" />
    <path strokeLinecap="round" strokeLinejoin="round" d="M13 13.5 17 10l-4-3.5M17 10H8" />
  </svg>
);

/**
 * Sign-out — the ONE authentication/session-clearing mechanism the whole
 * app uses (POST /api/auth/logout, which clears the httpOnly session
 * cookie server-side — see that route). Rendered from
 * app/_components/SidebarNav.jsx in three places (desktop sidebar footer,
 * mobile global header, mobile drawer footer) — same component, same
 * behavior everywhere, so there is exactly one logout implementation, not
 * three. `compact` renders an icon-only button (fits the mobile header's
 * limited width) instead of the full labeled button.
 */
export default function LogoutButton({ compact = false }) {
  const router = useRouter();
  const { t } = useLocale();
  const [loading, setLoading] = useState(false);

  async function handleLogout() {
    setLoading(true);
    try {
      await fetch("/api/auth/logout", { method: "POST" });
    } catch {
      // ignore — we clear the client state regardless
    }
    router.replace("/login");
    router.refresh();
  }

  if (compact) {
    return (
      <button
        type="button"
        onClick={handleLogout}
        disabled={loading}
        aria-label={t("common.signOut")}
        title={t("common.signOut")}
        className="grid h-9 w-9 shrink-0 place-items-center rounded-lg border border-zinc-300 text-zinc-700 transition active:bg-zinc-100 disabled:cursor-not-allowed disabled:opacity-60 dark:border-zinc-700 dark:text-zinc-200 dark:active:bg-zinc-800"
      >
        {LOGOUT_ICON}
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={handleLogout}
      disabled={loading}
      className="inline-flex items-center gap-2 rounded-lg border border-zinc-300 px-3 py-2 text-sm font-medium text-zinc-700 transition hover:bg-zinc-100 disabled:cursor-not-allowed disabled:opacity-60 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-800"
    >
      {loading ? t("common.signingOut") : t("common.signOut")}
    </button>
  );
}
