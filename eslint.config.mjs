import tsParser from "@typescript-eslint/parser";
import tailwindcss from "eslint-plugin-tailwindcss";

// Tailwind hygiene auto-fixer, run as `npm run lint` (or `npx eslint src --fix`).
// `cssConfigPath` points at the v4 CSS-first config — without it the plugin
// probes the vite default `src/style.css` and crashes.
// Deliberately NOT enabled:
// - `classnames-order`: reorders around custom @utility classes unreliably.
// - `no-unnecessary-arbitrary-value`: rewrites float arbitrary values into
//   INVALID spelling (opacity-[0.9] → opacity-0.9 emits no CSS). The compiler
//   only accepts the integral form (opacity-90). Canonical rule is safe — it
//   already rewrites what is validly reducible.
export default [
  {
    files: ["src/**/*.{ts,tsx}"],
    settings: { tailwindcss: { cssConfigPath: "src/index.css" } },
    languageOptions: {
      parser: tsParser,
      parserOptions: { ecmaFeatures: { jsx: true }, ecmaVersion: "latest", sourceType: "module" },
    },
    plugins: { tailwindcss },
    rules: {
      "tailwindcss/enforces-canonical-classname": "warn",
      "tailwindcss/enforces-shorthand": "warn",
      "tailwindcss/enforces-negative-arbitrary-values": "warn",
    },
  },
  {
    // shared/ is the bottom layer: it never reaches up into a feature.
    files: ["src/shared/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-imports": [
        "error",
        { patterns: [{ group: ["**/features/**"], message: "shared/ must not import from features/." }] },
      ],
    },
  },
  {
    // Pure feature logic: no React, no Tauri, no components — keeps it testable with node alone.
    files: ["src/features/*/lib/**/*.ts"],
    ignores: ["**/*.test.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["react", "react-dom", "react/*", "@tauri-apps/*", "**/*.tsx"],
              message: "features/*/lib holds pure logic: no React, Tauri or components.",
            },
          ],
        },
      ],
    },
  },
];
