import { createRequire } from "node:module";
import path from "node:path";
import { vi } from "vitest";

// Server actions call revalidatePath()/revalidateTag(), which require a Next.js request context.
// In tests they are no-ops; assert on them via `vi.mocked(revalidatePath)` if needed.
// `next` is not installed at the repo root, so a bare `vi.mock("next/cache")` here would target an
// unresolvable id and never apply; mock the exact file the app resolves instead.
const nextCache = createRequire(path.resolve(__dirname, "../../apps/internal-tools/package.json")).resolve("next/cache");
vi.doMock(nextCache, () => ({
  revalidatePath: vi.fn(),
  revalidateTag: vi.fn(),
  unstable_cache: <T>(fn: T) => fn,
}));
