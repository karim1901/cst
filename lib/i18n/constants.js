/**
 * The ONE source of truth for supported locales — imported by both server
 * code (app/layout.js, reading the cookie) and client code (LocaleProvider,
 * LanguageSwitcher), so there is exactly one place that knows what a valid
 * locale is. Client-safe (no server-only imports).
 */
export const LOCALES = Object.freeze({
  EN: "en",
  AR: "ar",
});

export const LOCALE_VALUES = Object.freeze(Object.values(LOCALES));

export const DEFAULT_LOCALE = LOCALES.EN;

export const RTL_LOCALES = new Set([LOCALES.AR]);

export function isValidLocale(value) {
  return LOCALE_VALUES.includes(value);
}

export function directionFor(locale) {
  return RTL_LOCALES.has(locale) ? "rtl" : "ltr";
}

// One clear source of truth for persistence (item 17's explicit
// requirement) — a cookie, not a mix of localStorage/URL/cookie. Readable
// server-side (app/layout.js, via next/headers) so <html lang/dir> and the
// dark-mode class are both correct on the VERY FIRST server-rendered byte —
// no locale/theme flash on load or navigation.
export const LOCALE_COOKIE = "locale";
export const THEME_COOKIE = "theme";
export const THEME_VALUES = Object.freeze(["light", "dark"]);
export const COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 365; // 1 year
