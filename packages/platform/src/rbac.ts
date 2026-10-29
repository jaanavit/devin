import type { Role, SessionUser } from "@fintech/models/shared";

type WithRoles = Pick<SessionUser, "roles"> | null | undefined;

export function hasAnyRole(user: WithRoles, allowed: readonly Role[]): boolean {
  if (!user || allowed.length === 0) return false;
  return allowed.some((role) => user.roles.includes(role));
}

/** Only Reviewers may see unmasked PII. Admin does not imply Reviewer (least privilege). */
export function canViewPii(user: WithRoles): boolean {
  return hasAnyRole(user, ["Reviewer"]);
}
