import { AccessDeniedError, ApprovalError, ConflictError, ValidationError, hasAnyRole } from "@fintech/platform";
import type { ApprovalPolicy } from "@fintech/platform/server";
import type { KycCase, KycOutcome, SessionUser } from "@fintech/models";
import { KYC_DECIDER_ROLES, KYC_PREPARER_ROLES } from "@/lib/catalog";

/**
 * Maker-checker for the KYC final decision: the Analyst's recommendation opens a request that only
 * a Reviewer other than the preparer may decide. There is no amount, so it never auto-approves.
 */
export const KYC_DECISION_POLICY: ApprovalPolicy = { kind: "kyc_decision", entityType: "KycCase", approverRoles: KYC_DECIDER_ROLES };

export const KYC_STATUSES = ["OPEN", "IN_REVIEW", "RECOMMENDED", "APPROVED", "REJECTED"] as const;
export const RISK_LEVELS = ["LOW", "MEDIUM", "HIGH"] as const;
export const KYC_OUTCOMES = ["APPROVE", "REJECT"] as const;
export const MAX_TEXT_LENGTH = 2_000;

type CaseState = Pick<KycCase, "status" | "assigneeId" | "recommendedById">;
type User = Pick<SessionUser, "id" | "roles">;

/** Why `user` may not perform an action on a case, or `null` when they may. */
export type Blocker = { code: "forbidden" | "conflict" | "self_approval"; message: string } | null;

export function claimBlocker(c: CaseState, user: User): Blocker {
  if (!hasAnyRole(user, KYC_PREPARER_ROLES)) return { code: "forbidden", message: "Only Analysts can claim cases" };
  if (c.status !== "OPEN" || c.assigneeId) return { code: "conflict", message: "Case is not open for claiming" };
  return null;
}

export function unclaimBlocker(c: CaseState, user: User): Blocker {
  if (!hasAnyRole(user, KYC_PREPARER_ROLES)) return { code: "forbidden", message: "Only Analysts can unclaim cases" };
  if (c.status !== "IN_REVIEW" || c.assigneeId !== user.id) return { code: "conflict", message: "You can only unclaim a case you are working on" };
  return null;
}

export function recommendBlocker(c: CaseState, user: User): Blocker {
  if (!hasAnyRole(user, KYC_PREPARER_ROLES)) return { code: "forbidden", message: "Only Analysts can prepare a recommendation" };
  if (c.status !== "IN_REVIEW" || c.assigneeId !== user.id) return { code: "conflict", message: "Claim the case before recommending" };
  return null;
}

/** True if `user` prepared (claimed or recommended) the case. Preparers can never decide it. */
export function isPreparer(c: CaseState, user: Pick<User, "id">): boolean {
  return c.recommendedById === user.id || c.assigneeId === user.id;
}

export function decideBlocker(c: CaseState, user: User): Blocker {
  if (!hasAnyRole(user, KYC_DECIDER_ROLES)) return { code: "forbidden", message: "Only Reviewers can make the final decision" };
  if (c.status !== "RECOMMENDED") return { code: "conflict", message: "Case is not awaiting a final decision" };
  if (isPreparer(c, user)) return { code: "self_approval", message: "You prepared this case, so another Reviewer must make the final decision" };
  return null;
}

/** Throws the platform error matching `blocker` (403 / 409); no-op when allowed. */
export function enforce(blocker: Blocker): void {
  if (!blocker) return;
  if (blocker.code === "forbidden") throw new AccessDeniedError(blocker.message);
  if (blocker.code === "self_approval") throw new ApprovalError("SELF_APPROVAL", blocker.message);
  throw new ConflictError(blocker.message, "invalid_state");
}

export function parseOutcome(value: FormDataEntryValue | null): KycOutcome {
  const v = typeof value === "string" ? value : "";
  if (!(KYC_OUTCOMES as readonly string[]).includes(v)) throw new ValidationError("Choose approve or reject", "invalid_outcome");
  return v as KycOutcome;
}

export function requireText(value: FormDataEntryValue | null, label: string): string {
  const text = typeof value === "string" ? value.trim() : "";
  if (!text) throw new ValidationError(`${label} is required`, "required");
  if (text.length > MAX_TEXT_LENGTH) throw new ValidationError(`${label} must be at most ${MAX_TEXT_LENGTH} characters`, "too_long");
  return text;
}
