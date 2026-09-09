import en from "@/lib/i18n/dictionaries/en";
import ar from "@/lib/i18n/dictionaries/ar";
import { LOCALES, DEFAULT_LOCALE } from "@/lib/i18n/constants";

const DICTIONARIES = {
  [LOCALES.EN]: en,
  [LOCALES.AR]: ar,
};

function getPath(dictionary, key) {
  return key.split(".").reduce((node, segment) => (node == null ? undefined : node[segment]), dictionary);
}

/**
 * Look up `"namespace.key"` in `locale`'s dictionary, falling back to
 * English for anything not (yet) translated — see the dictionaries'
 * own module comments for why a partial Arabic dictionary is safe: it
 * degrades to English text for a missing key, never a blank/broken UI.
 * Falls back to the raw key itself only if English is ALSO missing it
 * (a genuine typo/bug, kept visible rather than silently swallowed).
 */
export function translate(locale, key) {
  const dictionary = DICTIONARIES[locale] ?? DICTIONARIES[DEFAULT_LOCALE];
  const value = getPath(dictionary, key);
  if (value != null) return value;
  const fallback = getPath(DICTIONARIES[DEFAULT_LOCALE], key);
  return fallback ?? key;
}

export function dictionaryFor(locale) {
  return DICTIONARIES[locale] ?? DICTIONARIES[DEFAULT_LOCALE];
}
