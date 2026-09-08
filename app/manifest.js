/**
 * Web App Manifest, served by Next.js at /manifest.webmanifest.
 * https://nextjs.org/docs/app/api-reference/file-conventions/metadata/manifest
 */
export default function manifest() {
  return {
    name: "CST",
    short_name: "CST",
    // User-facing (shown in the "Add to Home Screen" install prompt) — see
    // app/layout.js's APP_DESCRIPTION, which this intentionally mirrors.
    description: "Manage shipping orders, delivery tracking, and team commissions in one place.",
    start_url: "/",
    scope: "/",
    display: "standalone",
    orientation: "portrait-primary",
    background_color: "#ffffff",
    theme_color: "#0a0a0a",
    icons: [
      {
        src: "/icons/icon-192x192.png",
        sizes: "192x192",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/icons/icon-512x512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/icons/icon-maskable-512x512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  };
}
