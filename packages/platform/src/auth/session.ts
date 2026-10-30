import { AsyncLocalStorage } from "node:async_hooks";
import { ROLES, type Role, type SessionUser } from "@fintech/models/shared";
import { getServerSession } from "next-auth/next";
import type {} from "./next-auth-augment";
import { authOptions } from "./options";

const testSession = new AsyncLocalStorage<SessionUser | null>();

function isTestEnv(): boolean {
  return process.env.NODE_ENV === "test";
}

/**
 * Test-only: run `fn` as `user` (or anonymously with `null`). Throws outside NODE_ENV=test so it
 * can never be used to impersonate a user in a running app.
 */
export function runAsUser<T>(user: SessionUser | null, fn: () => T): T {
  if (!isTestEnv()) throw new Error("runAsUser is only available in tests");
  return testSession.run(user, fn);
}

export async function getSessionUser(): Promise<SessionUser | null> {
  if (isTestEnv()) {
    const override = testSession.getStore();
    if (override !== undefined) return override;
  }
  const session = await getServerSession(authOptions);
  const user = session?.user;
  if (!user?.id) return null;
  const roles = (user.roles ?? []).filter((r): r is Role => (ROLES as readonly string[]).includes(r));
  return { id: user.id, email: user.email, name: user.name, roles };
}
