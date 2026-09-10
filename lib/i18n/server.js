import { cookies } from "next/headers";

import { translate } from "@/lib/i18n";
import { LOCALE_COOKIE, DEFAULT_LOCALE, isValidLocale } from "@/lib/i18n/constants";

/**
 * The active locale for the current request, read from the same `locale`
 * cookie app/layout.js uses for `<html lang/dir>` and LocaleProvider is
 * seeded from. For server components that render user-facing text directly
 * (the pre-auth login/register screens) instead of delegating to a client
 * component — everywhere else, use the `t` from useLocale().
 */
export async function getRequestLocale() {
  const cookieStore = await cookies();
  const raw = cookieStore.get(LOCALE_COOKIE)?.value;
  return isValidLocale(raw) ? raw : DEFAULT_LOCALE;
}

/** `translate` bound to the current request's locale. */
export async function getServerT() {
  const locale = await getRequestLocale();
  return (key) => translate(locale, key);
}
