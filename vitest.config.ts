import path from "node:path";
import { config as loadEnv } from "dotenv";
import { defineConfig } from "vitest/config";

loadEnv({ path: path.resolve(__dirname, ".env") });

const testDatabaseUrl = process.env.DATABASE_URL_TEST;
if (!testDatabaseUrl) throw new Error("DATABASE_URL_TEST must be set to a disposable database for `pnpm test` (see .env.example)");

export default defineConfig({
  resolve: {
    alias: { "@": path.resolve(__dirname, "apps/internal-tools") },
  },
  esbuild: { jsx: "automatic" },
  test: {
    include: ["packages/**/*.test.{ts,tsx}", "services/**/*.test.ts", "apps/**/*.test.{ts,tsx}", "scripts/**/*.test.ts"],
    exclude: ["**/node_modules/**", "**/.next/**", "**/dist/**"],
    environment: "node",
    globalSetup: ["./scripts/test/global-setup.ts"],
    // DB integration tests share one database; run files sequentially to keep resets isolated.
    fileParallelism: false,
    env: {
      DATABASE_URL: testDatabaseUrl,
      MOCK_IDP_ENABLED: "true",
      NEXTAUTH_SECRET: "test-secret",
      PAYMENTS_MOCK_URL: "http://payments.test",
      PAYMENTS_MOCK_TOKEN: "test-token",
      SLACK_WEBHOOK_URL: "",
      __NEXT_EXPERIMENTAL_AUTH_INTERRUPTS: "true",
    },
  },
});
