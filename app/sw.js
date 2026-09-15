import { defaultCache } from "@serwist/next/worker";
import { Serwist } from "serwist";

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
// `self.__SW_MANIFEST` is injected by @serwist/next at build time with the
// list of build assets to precache.
const serwist = new Serwist({
  precacheEntries: self.__SW_MANIFEST,
  skipWaiting: true,
  clientsClaim: true,
  navigationPreload: true,
  runtimeCaching: defaultCache,
});

serwist.addEventListeners();
