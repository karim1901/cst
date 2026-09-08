import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";

const eslintConfig = defineConfig([
  ...nextVitals,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Generated service worker bundle.
    "public/sw.js",
  ]),
  {
    // The service worker runs in a Web Worker scope, not the browser window.
    files: ["app/sw.js"],
    languageOptions: {
      globals: {
        self: "readonly",
      },
    },
  },
]);

export default eslintConfig;
