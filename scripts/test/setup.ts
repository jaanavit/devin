import { vi } from "vitest";

// Server actions call revalidatePath()/revalidateTag(), which require a Next.js request context.
// In tests they are no-ops; assert on them via `vi.mocked(revalidatePath)` if needed.
vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
  revalidateTag: vi.fn(),
  unstable_cache: <T>(fn: T) => fn,
}));
