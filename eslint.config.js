import js from "@eslint/js";
import globals from "globals";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: [
      "dist/**",
      "**/dist/**",
      "node_modules/**",
      "playwright-report/**",
      "coverage/**",
      "build/**",
      "release/**",
      "examples/*/dist/**",
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      "@typescript-eslint/consistent-type-imports": [
        "error",
        { prefer: "type-imports", fixStyle: "inline-type-imports" },
      ],
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
      "no-console": ["warn", { allow: ["warn", "error"] }],
    },
  },
  {
    // The e2e suite's stand-in for /sdk.js. Plain browser JavaScript, served to the page.
    files: ["examples/*/tests/e2e/*.js"],
    languageOptions: {
      globals: globals.browser,
    },
  },
  {
    // Build and release tooling runs under Node, not in a browser, and its whole job is to
    // print what it measured — a CLI that cannot use console is not a CLI.
    files: [
      "scripts/**/*.mjs",
      "*.config.{js,ts}",
      "examples/*/*.config.ts",
      "examples/*/scripts/**/*.mjs",
      "examples/*/compliance/**/*.mjs",
      "examples/*/tests/unit/**/*.mjs",
      "eslint.config.js",
      "vitest.workspace.ts",
    ],
    languageOptions: {
      globals: globals.node,
    },
    rules: {
      "no-console": "off",
    },
  },
  {
    // Served to the browser in place of a portal's SDK script; plain browser scripts.
    files: [
      "tests/poki/mock-poki-sdk.js",
      "tests/sdk-browser/mock-yandex-sdk.js",
      "tests/gamedistribution/mock-gd-sdk.js",
    ],
    languageOptions: {
      globals: globals.browser,
    },
  },
);
