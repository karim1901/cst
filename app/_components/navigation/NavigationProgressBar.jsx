"use client";

import { useEffect, useState } from "react";

import { useLocale } from "@/app/_components/i18n/LocaleProvider";
import { useNavigationProgress } from "@/app/_components/navigation/NavigationProgressProvider";

// How long the bar sits fully at 100% width before it starts fading —
// long enough to read as "done", short enough to never feel like an extra
// delay was added on top of the real navigation.
const COMPLETE_HOLD_MS = 150;
// Must match the opacity transition's own `duration-300` class below.
const FADE_MS = 300;

/**
 * The actual visible feedback for NavigationProgressProvider's `navigating`
 * signal — a thin, animated bar pinned to the very top of the viewport
 * (the same pattern GitHub/YouTube use): professional, instantly
 * recognizable, and — critically — never covers a single pixel of page
 * content, so it can never read as "a giant blocking screen" (explicitly
 * unwanted) and can never visually fight with the mobile drawer/backdrop,
 * which sit at their own, much higher z-index regardless.
 *
 * Pure CSS transitions driven by a small local PRESENTATION state machine
 * (`phase`) — zero animation libraries, matching this app's existing
 * "plain Tailwind utilities, no new dependency" convention:
 *   idle     -> hidden, width reset to 0%, ready for the next navigation.
 *   loading  -> visible, width eases toward 85% over several seconds (never
 *               reaches 100% on its own — that would falsely claim
 *               "finished" while still waiting).
 *   complete -> `navigating` just turned false — width snaps to 100%.
 *   hiding   -> holds at 100% width while ONLY opacity fades out (started
 *               the INSTANT this phase begins, timed to finish exactly when
 *               it ends — see `visible` below), so the bar visually
 *               disappears as a solid line, never as a shrinking one,
 *               before `idle` resets its width back to 0% (safe to do
 *               instantly — it's already invisible by then).
 */
export default function NavigationProgressBar() {
  const { navigating } = useNavigationProgress();
  const { t } = useLocale();
  const [phase, setPhase] = useState("idle");
  // "Derived state that resets when a prop changes" — adjusted DURING
  // render (React's own recommended pattern, same convention already used
  // elsewhere in this app, e.g. ReturnsList.jsx's `renderedForFilterKey`),
  // not via a synchronous setState inside a useEffect body (which the
  // react-hooks linter flags as a cascading-render risk).
  const [renderedForNavigating, setRenderedForNavigating] = useState(navigating);
  if (navigating !== renderedForNavigating) {
    setRenderedForNavigating(navigating);
    // Ignore a `navigating -> false` that doesn't correspond to anything
    // currently on screen (e.g. the very first render).
    setPhase(navigating ? "loading" : phase === "idle" ? "idle" : "complete");
  }

  useEffect(() => {
    if (phase === "complete") {
      const holdTimer = setTimeout(() => setPhase("hiding"), COMPLETE_HOLD_MS);
      return () => clearTimeout(holdTimer);
    }
    if (phase === "hiding") {
      const fadeTimer = setTimeout(() => setPhase("idle"), FADE_MS);
      return () => clearTimeout(fadeTimer);
    }
  }, [phase]);

  // Opacity fades starting the INSTANT "hiding" begins (not after it) — the
  // CSS `transition-opacity duration-300` below then animates that fade
  // exactly across the `FADE_MS` window before the timer above moves on to
  // "idle". Width (below) deliberately stays at 100% through both
  // "complete" and "hiding" — only opacity changes during the fade, so the
  // bar never visibly shrinks while disappearing.
  const visible = phase === "loading" || phase === "complete";
  const widthClass =
    phase === "loading"
      ? "w-[85%] duration-[6000ms]"
      : phase === "complete" || phase === "hiding"
        ? "w-full duration-150"
        : "w-0 duration-0";

  return (
    <>
      {/* Decorative only — the sr-only live region below is what actually
          announces loading state to assistive tech (item 14). */}
      <div
        aria-hidden="true"
        className={`pointer-events-none fixed inset-x-0 top-0 z-[100] h-[3px] overflow-hidden transition-opacity duration-300 ${
          visible ? "opacity-100" : "opacity-0"
        }`}
      >
        <div className={`h-full bg-zinc-900 ease-out transition-[width] dark:bg-white ${widthClass}`} />
      </div>
      <div role="status" aria-live="polite" aria-busy={navigating} className="sr-only">
        {navigating ? t("common.loading") : ""}
      </div>
    </>
  );
}
