"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import { useNavigationProgress } from "@/app/_components/navigation/NavigationProgressProvider";

/**
 * "Switch to employee" — calls POST /api/auth/impersonate, which validates
 * ownership server-side and swaps the session cookie for a real employee
 * session (see that route's own comment). This component never sends
 * anything but the target employee's id; it has no way to grant itself
 * more than what the server already decides to allow.
 */
export default function SwitchToEmployeeButton({ employeeId }) {
  const router = useRouter();
  const { startNavigation } = useNavigationProgress();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function handleClick() {
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/auth/impersonate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ employeeId }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.error || "Could not switch to this employee.");
        setLoading(false);
        return;
      }
      startNavigation();
      router.push("/dashboard");
      router.refresh();
    } catch {
      setError("Network error. Please try again.");
      setLoading(false);
    }
  }

  return (
    <div>
      <button
        type="button"
        onClick={handleClick}
        disabled={loading}
        className="rounded-lg border border-zinc-300 px-2.5 py-1.5 text-xs font-medium text-zinc-700 transition hover:bg-zinc-100 disabled:cursor-not-allowed disabled:opacity-60 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-800"
      >
        {loading ? "Switching…" : "Switch to employee"}
      </button>
      {error ? <p className="mt-1 text-xs text-red-600 dark:text-red-400">{error}</p> : null}
    </div>
  );
}
