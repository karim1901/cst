import { cookies } from "next/headers";

import { translate } from "@/lib/i18n";
import { LOCALE_COOKIE, DEFAULT_LOCALE, isValidLocale } from "@/lib/i18n/constants";

/**
 * Build a Next.js `generateMetadata()` that localises the browser-tab
 * title (`<title>`) to the active locale — reading the very same
 * `locale` cookie that app/layout.js reads for `<html lang/dir>`, so the
 * tab title, the sidebar and the page body can never disagree on
 * language. `key` is an i18n dot-path (e.g. "nav.orders"); the
 * `%s | CST` template in app/layout.js appends the app name.
 *
 * Static `export const metadata = { title: "Orders" }` can't do this —
 * it's evaluated once at build time with no request context — so every
 * dashboard page uses this instead.
 */
export function localizedTitle(key) {
  return async function generateMetadata() {
    const cookieStore = await cookies();
    const raw = cookieStore.get(LOCALE_COOKIE)?.value;
    const locale = isValidLocale(raw) ? raw : DEFAULT_LOCALE;
    return { title: translate(locale, key) };
  };
}
