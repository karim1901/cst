import os from "node:os";

import withSerwistInit from "@serwist/next";

const withSerwist = withSerwistInit({
  // Service worker source and generated output.
  swSrc: "app/sw.js",
  swDest: "public/sw.js",
  // Don't generate / register the SW in `next dev` so it never interferes
  // with hot reloading. It is built and registered for `next build`.
  disable: process.env.NODE_ENV === "development",
  reloadOnOnline: true,
});

/**
 * This machine's own LAN IP addresses (e.g. "192.168.0.105"), read fresh
 * from the OS every time `next dev`/`next build` starts. Never hardcoded —
 * this machine can join a different Wi-Fi/LAN at any time, and the result
 * must always match whatever network it's actually on right now.
 */
function localNetworkOrigins() {
  const interfaces = os.networkInterfaces();
  const origins = [];
  for (const addresses of Object.values(interfaces)) {
    for (const address of addresses ?? []) {
      if (address.family === "IPv4" && !address.internal) {
        origins.push(address.address);
      }
    }
  }
  return origins;
}

/** @type {import('next').NextConfig} */
const nextConfig = {
  // `next dev` runs on Turbopack (Next.js 16 default); an empty config here
  // acknowledges that while `@serwist/next` adds its webpack hook for the
  // `next build --webpack` step that bundles the service worker.
  turbopack: {},

  // Next.js 16 blocks cross-origin requests to dev-only resources (the HMR
  // websocket, `/_next/*` chunks, ...) by default. Without this, opening
  // the `next dev` server from any device other than the one running it —
  // e.g. a phone on the same Wi-Fi hitting this machine's LAN IP, the
  // realistic way to test "mobile" during local development — gets its HMR
  // handshake rejected; the dev client then never finishes bootstrapping,
  // so React never hydrates and the page is dead HTML: no click handlers,
  // no auth, nothing interactive. This is dev-only (ignored by `next
  // build`/`next start`), so it changes nothing about production behavior.
  allowedDevOrigins: localNetworkOrigins(),
};

export default withSerwist(nextConfig);
