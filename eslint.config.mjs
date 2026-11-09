import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";
import security from "eslint-plugin-security";

const eslintConfig = defineConfig([
  security.configs.recommended,
  ...nextVitals,
  ...nextTs,
  // detect-object-injection has a very high false-positive rate for normal array
  // indexing (e.g. arr[i], MONTH_NAMES[month]). Keep all other security rules.
  {
    rules: {
      'security/detect-object-injection': 'off',
    },
  },
  {
    rules: {
      // React state initialization and modal resets may run in effects.
      'react-hooks/set-state-in-effect': 'off',
    },
  },
  globalIgnores([
    ".next/**",
    "out/**",
    "build/**",
    "coverage/**",
    // Vendored OCR engine assets (tesseract.js worker bundle, wasm cores, language
    // model) copied out of node_modules by scripts/copy-ocr-assets.mjs — not project
    // source, so they shouldn't be linted.
    "public/tesseract/**",
    // Supabase CLI scratch space for the local stack (edge-runtime entrypoints and
    // secrets shims). Written by `supabase start`, already gitignored, and it only
    // exists on machines that have run the local database — linting it makes
    // ci:full pass or fail depending on whether test:rls:local ran first.
    "supabase/.temp/**",
    "next-env.d.ts",
    "jest.config.js",
    "jest.rls.config.cjs",
    "jest.restore.config.cjs",
  ]),
]);

export default eslintConfig;
