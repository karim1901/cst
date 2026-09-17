import { Geist, Geist_Mono } from "next/font/google";
import { cookies } from "next/headers";

import "./globals.css";
import { ThemeProvider } from "@/app/_components/theme/ThemeProvider";
import { LocaleProvider } from "@/app/_components/i18n/LocaleProvider";
import ServiceWorkerUpdateReload from "@/app/_components/pwa/ServiceWorkerUpdateReload";
import { NavigationProgressProvider } from "@/app/_components/navigation/NavigationProgressProvider";
import NavigationProgressBar from "@/app/_components/navigation/NavigationProgressBar";
import {
  LOCALE_COOKIE,
  THEME_COOKIE,
  DEFAULT_LOCALE,
  isValidLocale,
  directionFor,
} from "@/lib/i18n/constants";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

const APP_NAME = "CST";
// User-facing only — this is shown to real users (browser tab/search
// snippets, and the "Add to Home Screen" prompt via app/manifest.js), so it
// must never mention implementation details (framework, database, ...).
const APP_DESCRIPTION =
  "Manage shipping orders, delivery tracking, and team commissions in one place.";

export const metadata = {
  applicationName: APP_NAME,
  title: {
    default: APP_NAME,
    template: `%s | ${APP_NAME}`,
  },
  description: APP_DESCRIPTION,
  manifest: "/manifest.webmanifest",
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: APP_NAME,
  },
  formatDetection: {
    telephone: false,
  },
  icons: {
    icon: "/icons/icon-192x192.png",
    shortcut: "/favicon.ico",
    apple: "/icons/apple-touch-icon.png",
  },
};

export const viewport = {
  themeColor: "#0a0a0a",
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default async function RootLayout({ children }) {
  // Read theme/locale from cookies server-side — the ONE source of truth
  // for both (see lib/i18n/constants.js's own comment) — so <html
  // lang/dir/class="dark"> is already correct on the very first
  // server-rendered byte. This is what prevents a flash of the wrong
  // theme/direction on load or client-side navigation: ThemeProvider/
  // LocaleProvider below are seeded from these exact same values, not
  // re-derived client-side after mount.
  const cookieStore = await cookies();
  const localeCookie = cookieStore.get(LOCALE_COOKIE)?.value;
  const locale = isValidLocale(localeCookie) ? localeCookie : DEFAULT_LOCALE;
  const dir = directionFor(locale);
  const themeCookie = cookieStore.get(THEME_COOKIE)?.value;
  const theme = themeCookie === "dark" ? "dark" : themeCookie === "light" ? "light" : null;

  return (
    <html
      lang={locale}
      dir={dir}
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased ${theme === "dark" ? "dark" : ""}`}
    >
      <body className="min-h-full flex flex-col">
        <ServiceWorkerUpdateReload />
        {/* Mounted ONCE, above ThemeProvider/LocaleProvider, so it survives
            every route change untouched (never unmounted/remounted by the
            navigation it is itself tracking) — see
            NavigationProgressProvider.jsx's own comment. */}
        <NavigationProgressProvider>
          <ThemeProvider initialTheme={theme ?? "light"}>
            <LocaleProvider initialLocale={locale}>
              <NavigationProgressBar />
              {children}
            </LocaleProvider>
          </ThemeProvider>
        </NavigationProgressProvider>
      </body>
    </html>
  );
}
