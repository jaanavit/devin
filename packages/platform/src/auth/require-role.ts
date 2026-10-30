import type { Role, SessionUser } from "@fintech/models/shared";
import { forbidden, redirect } from "next/navigation";
import { AccessDeniedError, UnauthenticatedError } from "../errors";
import { hasAnyRole } from "../rbac";
import { getSessionUser } from "./session";

/**
 * Deny-by-default guard for server actions and route handlers. Resolves the current user and
 * throws `UnauthenticatedError` (401) or `AccessDeniedError` (403) unless they hold one of `allowed`.
 */
export async function requireRole(allowed: readonly Role[]): Promise<SessionUser> {
  if (allowed.length === 0) throw new Error("requireRole() needs at least one role; there is no public access");
  const user = await getSessionUser();
  if (!user) throw new UnauthenticatedError();
  if (!hasAnyRole(user, allowed)) throw new AccessDeniedError(`Requires one of: ${allowed.join(", ")}`);
  return user;
}

/**
 * `requireRole` for pages and layouts: redirects anonymous users to /login and renders the
 * 403 page (`app/forbidden.tsx`, HTTP 403) for users without the role.
 */
export async function requirePageRole(allowed: readonly Role[]): Promise<SessionUser> {
  try {
    return await requireRole(allowed);
  } catch (err) {
    if (err instanceof UnauthenticatedError) redirect("/login");
    if (err instanceof AccessDeniedError) forbidden();
    throw err;
  }
}
