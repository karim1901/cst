"use client";

import { createContext, useCallback, useContext, useMemo, useState } from "react";

import { translate } from "@/lib/i18n";
import { LOCALE_COOKIE, COOKIE_MAX_AGE_SECONDS, directionFor, isValidLocale } from "@/lib/i18n/constants";

const LocaleContext = createContext(null);

/**
 * Client-side locale state, seeded from the SERVER-read cookie (see
 * app/layout.js, which also sets <html lang/dir> from the same cookie
 * BEFORE this ever mounts — so there is no locale flash/hydration
 * mismatch: server and client agree on the initial locale from the first
 * byte). Changing locale here also:
 *  - writes the `locale` cookie (the ONE source of truth for persistence —
 *    see lib/i18n/constants.js's own comment; no separate localStorage/URL
 *    scheme) so a refresh/new tab/PWA relaunch sees the same choice via
 *    app/layout.js next time, and
 *  - updates <html lang/dir> immediately, client-side, so RTL/LTR and
 *    text direction react instantly without a full page reload.
 */
export function LocaleProvider({ initialLocale, children }) {
  const [locale, setLocaleState] = useState(initialLocale);

  const setLocale = useCallback((next) => {
    if (!isValidLocale(next)) return;
    setLocaleState(next);
    if (typeof document !== "undefined") {
      document.cookie = `${LOCALE_COOKIE}=${next}; path=/; max-age=${COOKIE_MAX_AGE_SECONDS}; samesite=lax`;
      document.documentElement.lang = next;
      document.documentElement.dir = directionFor(next);
    }
  }, []);

  const value = useMemo(
    () => ({
      locale,
      dir: directionFor(locale),
      setLocale,
      t: (key) => translate(locale, key),
    }),
    [locale, setLocale]
  );

  return <LocaleContext.Provider value={value}>{children}</LocaleContext.Provider>;
}

/** @returns {{locale:string, dir:"ltr"|"rtl", setLocale:(l:string)=>void, t:(key:string)=>string}} */
export function useLocale() {
  const ctx = useContext(LocaleContext);
  if (!ctx) {
    throw new Error("useLocale must be used within LocaleProvider");
  }
  return ctx;
}
