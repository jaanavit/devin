import { execFileSync } from "node:child_process";
import path from "node:path";

/** Applies all migrations to the test database once per `pnpm test` run. */
export default function setup(): void {
  const url = process.env.DATABASE_URL_TEST;
  if (!url || !/_test\b|_test\?/.test(url)) throw new Error("DATABASE_URL_TEST must point at a database whose name ends in _test");
  execFileSync("pnpm", ["exec", "prisma", "migrate", "deploy"], {
    cwd: path.resolve(__dirname, "../../packages/models"),
    env: { ...process.env, DATABASE_URL: url },
    stdio: "pipe",
  });
}
