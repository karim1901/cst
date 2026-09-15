"use client";

import { useEffect } from "react";

/**
 * ROOT CAUSE this closes (item 12/24 of the deployment-investigation task):
 * `app/sw.js` already sets `skipWaiting: true` + `clientsClaim: true`, so a
 * new service worker installs and takes control automatically on the next
 * deployment — no "waiting" state, no user prompt needed. But taking
 * CONTROL of a page is not the same as that page's ALREADY-LOADED JavaScript
 * changing: an open tab (or a backgrounded installed PWA) keeps running the
 * OLD bundle already in memory until something actually reloads it. Before
 * this fix, nothing in the app did that — `@serwist/next`'s injected
 * registration script (app/sw.js via next.config.mjs) only REGISTERS the
 * service worker; reloading on update is deliberately left to the app (see
 * node_modules/@serwist/window's own Serwist class — it fires a
 * `controlling` event, nothing more).
 *
 * This listens for that exact event and reloads ONCE, the standard/
 * documented Workbox-window pattern — never a polling loop, never asks the
 * user to clear data or reinstall. `refreshing` guards against a reload
 * loop (`controllerchange` can fire more than once per page lifetime).
 *
 * No-ops safely outside a browser with service worker support, and in
 * `next dev` (`app/sw.js` is never built/registered there — see
 * next.config.mjs's `disable: process.env.NODE_ENV === "development"`), so
 * this never interferes with local development.
 */
export default function ServiceWorkerUpdateReload() {
  useEffect(() => {
    if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return;

    let refreshing = false;
    const onControllerChange = () => {
      if (refreshing) return;
      refreshing = true;
      window.location.reload();
    };

    navigator.serviceWorker.addEventListener("controllerchange", onControllerChange);
    return () => navigator.serviceWorker.removeEventListener("controllerchange", onControllerChange);
  }, []);

  return null;
}
