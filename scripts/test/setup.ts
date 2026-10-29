import { vi } from "vitest";

// Server actions call revalidatePath()/revalidateTag(), which require a Next.js request context.
// In tests they are no-ops; assert on them via `vi.mocked(revalidatePath)` if needed.
// `next` is only installed in apps/internal-tools, so a bare "next/cache" would not resolve from this
// file (and the mock would silently not apply). Target the app's copy so the module IDs match.
vi.mock("../../apps/internal-tools/node_modules/next/cache.js", () => ({
  revalidatePath: vi.fn(),
  revalidateTag: vi.fn(),
  unstable_cache: <T>(fn: T) => fn,
}));
