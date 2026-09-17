"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";

const NavigationProgressContext = createContext(null);

// Hard ceiling so the indicator can NEVER stay stuck forever (a failed
// navigation, or any future edge case this module doesn't yet anticipate) —
// see module comment's "never gets stuck" requirement.
const SAFETY_TIMEOUT_MS = 8000;

/**
 * ONE global "is an internal page navigation currently in flight" signal —
 * mounted ONCE, in the ROOT layout (app/layout.js), so it survives every
 * route change (unlike anything nested inside the page tree itself, which
 * gets unmounted/replaced by the very navigation this is tracking).
 *
 * Two independent triggers feed it:
 *   1. A single, document-level click listener (capture phase) that
 *      recognizes an internal `<Link>` navigation the INSTANT it's clicked
 *      — this is what makes the feedback truly immediate: neither
 *      `usePathname()` nor a Suspense/`loading.js` boundary can react
 *      before the click itself, since both only fire once the RSC
 *      request/render is already under way. Every `<Link>` in this app
 *      (desktop Sidebar, mobile drawer, MobileBottomNav, any in-page card)
 *      renders a real `<a>` under the hood, so this ONE delegated listener
 *      covers all of them without touching a single one of those
 *      components — no per-component loading logic to duplicate.
 *   2. `startNavigation()`, exposed via context, for the handful of
 *      PROGRAMMATIC `router.push()`/`router.replace()` call sites in this
 *      app (login/register/logout/employee-switch redirects) that aren't
 *      triggered by a literal `<a>` click, so the click listener can never
 *      see them.
 *
 * Cleared by whichever of these happens first:
 *   - `usePathname()` reporting a NEW value — the navigation this indicator
 *     was showing for has actually landed. The standard, reliable "did it
 *     finish" signal in the App Router; no external library involved.
 *   - The safety timeout above.
 * A rapid second click while the first navigation is still in flight simply
 * calls `startNavigation()` again — already-`true` stays `true`, one
 * indicator, never duplicated — and clears exactly once, when the FINAL
 * destination's pathname is reached (Next.js's own router supersedes an
 * in-flight navigation with a newer one; there is nothing for this module
 * to reconcile itself).
 */
export function NavigationProgressProvider({ children }) {
  const pathname = usePathname();
  const [navigating, setNavigating] = useState(false);
  const timeoutRef = useRef(null);
  const previousPathnameRef = useRef(pathname);

  const clear = useCallback(() => {
    if (timeoutRef.current != null) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
    setNavigating(false);
  }, []);

  const startNavigation = useCallback(() => {
    setNavigating(true);
    if (timeoutRef.current != null) clearTimeout(timeoutRef.current);
    timeoutRef.current = setTimeout(clear, SAFETY_TIMEOUT_MS);
  }, [clear]);

  // The route actually changed -> whatever navigation this indicator was
  // showing for has landed. Guarded so it only reacts to a genuine change,
  // never fires spuriously on mount for the pathname it already started at.
  useEffect(() => {
    if (previousPathnameRef.current !== pathname) {
      previousPathnameRef.current = pathname;
      clear();
    }
  }, [pathname, clear]);

  // Unmount safety — this provider is meant to live for the app's whole
  // lifetime (mounted once, in the root layout), but never leave a dangling
  // timer if that ever changes.
  useEffect(() => clear, [clear]);

  useEffect(() => {
    function onClick(event) {
      // Only a plain, unmodified left click ever navigates THIS tab —
      // anything else (new-tab keyboard/modifier shortcuts, middle-click,
      // a handler upstream that already called preventDefault) must never
      // start a loading indicator for a navigation that isn't happening
      // here at all.
      if (
        event.defaultPrevented ||
        event.button !== 0 ||
        event.metaKey ||
        event.ctrlKey ||
        event.shiftKey ||
        event.altKey
      ) {
        return;
      }

      const anchor = event.target instanceof Element ? event.target.closest("a") : null;
      if (!anchor) return;
      // A non-"_self" target (e.g. target="_blank") opens elsewhere — this
      // tab never actually navigates.
      if (anchor.target && anchor.target !== "_self") return;
      if (anchor.hasAttribute("download")) return;

      const href = anchor.getAttribute("href");
      if (!href) return;

      let url;
      try {
        url = new URL(href, window.location.href);
      } catch {
        return;
      }

      // Only http(s) — mailto:/tel:/sms:/whatsapp:/any other custom scheme
      // never navigates this app's own pages (item 9's explicit list).
      if (url.protocol !== "http:" && url.protocol !== "https:") return;
      // A different origin is an external site — never this app's own
      // internal loading feedback.
      if (url.origin !== window.location.origin) return;

      const samePath = url.pathname === window.location.pathname && url.search === window.location.search;
      // An in-page anchor jump (same path+query, only the hash differs) is
      // not a route change.
      if (samePath && url.hash) return;
      // Clicking the link for the page already showing — no real navigation
      // will ever happen, so never start an indicator nothing would clear.
      if (samePath) return;

      startNavigation();
    }

    document.addEventListener("click", onClick, true);
    return () => document.removeEventListener("click", onClick, true);
  }, [startNavigation]);

  return (
    <NavigationProgressContext.Provider value={{ navigating, startNavigation }}>
      {children}
    </NavigationProgressContext.Provider>
  );
}

/** @returns {{navigating:boolean, startNavigation:() => void}} */
export function useNavigationProgress() {
  const ctx = useContext(NavigationProgressContext);
  if (!ctx) {
    throw new Error("useNavigationProgress must be used within NavigationProgressProvider");
  }
  return ctx;
}
