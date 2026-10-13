import { defaultCache } from "@serwist/next/worker";
import { NetworkOnly, Serwist } from "serwist";

// DEPLOYMENT-FRESHNESS NOTE (production stale-version investigation): a new
// deployment can build and go live correctly while an already-open tab, or
// an installed PWA that was never closed, keeps running the OLD JS bundle —
// not because Vercel served old code, but because the BROWSER never fetched
// this file again, or fetched it but the already-loaded page never reloaded
// once a new worker took control. `skipWaiting`/`clientsClaim` below solve
// the SECOND half (a new worker takes control immediately, no "waiting for
// all tabs to close"); `vercel.json`'s explicit `Cache-Control: no-cache` on
// `/sw.js` solves the FIRST half (the browser always re-checks this exact
// file instead of trusting a cached copy — the Service Worker spec already
// caps this at 24h regardless of headers, `no-cache` tightens that to
// "always revalidate"); `app/_components/pwa/ServiceWorkerUpdateReload.jsx`
// solves the THIRD half (the already-open tab actually reloads once the new
// worker takes control, instead of silently continuing to run the old
// in-memory bundle forever). All three are required together — any one
// alone leaves a real gap.
//
// Finance-staleness fix (item 14 — "fix the specific stale-data path,
// do not disable all application caching indiscriminately"): @serwist/next's
// own `defaultCache` matches every GET `/api/*` request with `NetworkFirst`
// (10s network timeout, falling back to a cache entry up to 24h old — see
// node_modules/@serwist/next/dist/index.worker.mjs). That fallback is a
// reasonable offline/flaky-connection safety net for most endpoints, but it
// is the wrong default for the business-data reads whose whole point is to
// reflect whatever lib/sync/period-sync.js and the rest of the sync engine
// just wrote to MongoDB (Finance, Dashboard, Commission, Orders, Returns,
// Employees, Shipping Companies) — a slow/flaky request there must surface
// as a real error, never silently serve a pre-sync snapshot. Workbox/Serwist
// matches `runtimeCaching` entries IN ORDER and stops at the first match, so
// this entry is placed BEFORE `defaultCache`'s own generic `/api/*` rule to
// win for these specific prefixes — mirrors the exact same pattern
// `defaultCache` already uses for `/api/auth/*` (also `NetworkOnly`, also
// ahead of the generic rule) rather than inventing a new one. Every other
// route (fonts, static assets, the app shell's own navigation/RSC caching,
// and any other `/api/*` endpoint not listed here) keeps `defaultCache`'s
// existing behavior completely unchanged.
const FRESH_DATA_API_PREFIXES = [
  "/api/finance",
  "/api/dashboard",
  "/api/commission",
  "/api/orders",
  "/api/returns",
  "/api/employees",
  "/api/shipping-companies",
];
const runtimeCaching = [
  {
    matcher: ({ sameOrigin, url: { pathname } }) =>
      sameOrigin && FRESH_DATA_API_PREFIXES.some((prefix) => pathname.startsWith(prefix)),
    method: "GET",
    handler: new NetworkOnly(),
  },
  ...defaultCache,
];

// `self.__SW_MANIFEST` is injected by @serwist/next at build time with the
// list of build assets to precache.
const serwist = new Serwist({
  precacheEntries: self.__SW_MANIFEST,
  skipWaiting: true,
  clientsClaim: true,
  navigationPreload: true,
  runtimeCaching,
});

serwist.addEventListeners();
