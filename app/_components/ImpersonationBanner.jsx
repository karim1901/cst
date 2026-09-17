"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import { useNavigationProgress } from "@/app/_components/navigation/NavigationProgressProvider";

/**
 * Shown only while a merchant is viewing the app as one of their employees
 * (`user.impersonatorId` set — see app/api/auth/impersonate/route.js).
 * "Return to merchant" calls stop-impersonating, which derives the
 * merchant to return to solely from the current signed session, never from
 * anything this component sends.
 */
export default function ImpersonationBanner({ employeeName }) {
  const router = useRouter();
  const { startNavigation } = useNavigationProgress();
  const [loading, setLoading] = useState(false);

  async function handleReturn() {
    setLoading(true);
    try {
      await fetch("/api/auth/stop-impersonating", { method: "POST" });
    } catch {
      // ignore — refresh below reflects whatever the server actually did
    }
    startNavigation();
    router.replace("/dashboard/employees");
    router.refresh();
  }

  return (
    <div className="flex flex-wrap items-center justify-between gap-2 bg-amber-400 px-4 py-2 text-sm font-medium text-amber-950 sm:px-8">
      <span>
        Viewing as <strong>{employeeName}</strong>
      </span>
      <button
        type="button"
        onClick={handleReturn}
        disabled={loading}
        className="rounded-md bg-amber-950/10 px-2.5 py-1 text-xs font-semibold transition hover:bg-amber-950/20 disabled:cursor-not-allowed disabled:opacity-60"
      >
        {loading ? "Returning…" : "Return to merchant"}
      </button>
    </div>
  );
}
