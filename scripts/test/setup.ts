import { createRequire } from "node:module";
import path from "node:path";
import { vi } from "vitest";

// Server actions call revalidatePath()/revalidateTag(), which require a Next.js request context.
// In tests they are no-ops; assert on them via `vi.mocked(revalidatePath)` if needed.
// `next` is not resolvable from the repo root, so mock the exact file the app resolves to.
const nextCache = createRequire(path.resolve(__dirname, "../../apps/internal-tools/package.json")).resolve("next/cache");
vi.doMock(nextCache, () => ({
  revalidatePath: vi.fn(),
  revalidateTag: vi.fn(),
  unstable_cache: <T>(fn: T) => fn,
}));
