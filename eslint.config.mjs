import js from "@eslint/js";
import nextPlugin from "@next/eslint-plugin-next";
import globals from "globals";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: ["**/node_modules/**", "**/.next/**", "**/dist/**", "**/coverage/**", "**/next-env.d.ts"],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: {
      globals: { ...globals.node },
    },
    rules: {
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
      "@typescript-eslint/consistent-type-imports": "error",
      "no-console": ["error", { allow: ["warn", "error", "info"] }],
    },
  },
  {
    files: ["apps/internal-tools/**/*.{ts,tsx}"],
    plugins: { "@next/next": nextPlugin },
    languageOptions: { globals: { ...globals.browser } },
    settings: { next: { rootDir: "apps/internal-tools" } },
    rules: {
      ...nextPlugin.configs.recommended.rules,
      ...nextPlugin.configs["core-web-vitals"].rules,
    },
  },
  {
    files: ["scripts/**/*.ts", "services/payments-mock/src/main.ts"],
    rules: { "no-console": "off" },
  },
);
