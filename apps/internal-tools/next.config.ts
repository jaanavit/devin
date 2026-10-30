import path from "node:path";
import { config as loadEnv } from "dotenv";
import type { NextConfig } from "next";

const repoRoot = path.resolve(process.cwd(), "../..");
loadEnv({ path: path.join(repoRoot, ".env") });

const nextConfig: NextConfig = {
  outputFileTracingRoot: repoRoot,
  // Lint runs once at the repo root (`pnpm lint`) with the shared flat config.
  eslint: { ignoreDuringBuilds: true },
  transpilePackages: ["@fintech/platform", "@fintech/models"],
  serverExternalPackages: ["@prisma/client"],
  poweredByHeader: false,
};

export default nextConfig;
