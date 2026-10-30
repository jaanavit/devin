import { prisma, type ApprovalRequest, type Role, type SessionUser } from "@fintech/models";
import { audit } from "./audit";
import { inTransaction, type DbClient } from "./db";
import { ApprovalError, ConflictError, NotFoundError, ValidationError } from "./errors";
import { hasAnyRole } from "./rbac";

/**
 * Describes a maker-checker rule. Tools declare policies; the platform enforces them.
 * `autoApproveMaxCents`: requests at or below this amount are auto-approved (no checker needed).
 */
export interface ApprovalPolicy {
  kind: string;
  entityType: string;
  approverRoles: readonly Role[];
  autoApproveMaxCents?: number;
}

export function needsSecondApprover(policy: ApprovalPolicy, amountCents?: number): boolean {
  if (policy.autoApproveMaxCents === undefined) return true;
  if (amountCents === undefined) return true;
  return amountCents > policy.autoApproveMaxCents;
}

export interface CreateApprovalInput {
  policy: ApprovalPolicy;
  entityId: string;
  amountCents?: number;
  requester: SessionUser;
}

export async function createApprovalRequest(input: CreateApprovalInput, db: DbClient = prisma): Promise<ApprovalRequest> {
  const { policy, entityId, amountCents, requester } = input;
  if (amountCents !== undefined && (!Number.isInteger(amountCents) || amountCents <= 0)) {
    throw new ValidationError("Amount must be a positive integer number of cents", "invalid_amount");
  }
  const auto = !needsSecondApprover(policy, amountCents);
  return inTransaction(db, async (tx) => {
    const request = await tx.approvalRequest.create({
      data: {
        kind: policy.kind,
        entityType: policy.entityType,
        entityId,
        amountCents: amountCents ?? null,
        approverRoles: [...policy.approverRoles],
        requesterId: requester.id,
        status: auto ? "AUTO_APPROVED" : "PENDING",
        decidedAt: auto ? new Date() : null,
        decisionReason: auto ? `Auto-approved: amount at or below ${policy.autoApproveMaxCents} cents` : null,
      },
    });
    await audit(
      requester,
      {
        action: auto ? "approval.auto_approve" : "approval.request",
        entityType: "ApprovalRequest",
        entityId: request.id,
        after: request,
        metadata: { kind: policy.kind, subject: `${policy.entityType}:${entityId}` },
      },
      tx,
    );
    return request;
  });
}

type Decision = "approve" | "reject";

/** Pure maker-checker rules. Throws `ApprovalError` when `approver` may not make `decision`. */
export function assertCanDecide(
  request: Pick<ApprovalRequest, "status" | "requesterId" | "approverRoles">,
  approver: SessionUser,
  decision: Decision,
  reason?: string,
): void {
  if (request.status !== "PENDING") throw new ApprovalError("NOT_PENDING", `Request is already ${request.status}`);
  if (request.requesterId === approver.id) throw new ApprovalError("SELF_APPROVAL", "The approver cannot be the requester");
  if (!hasAnyRole(approver, request.approverRoles)) {
    throw new ApprovalError("MISSING_ROLE", `Approver needs one of: ${request.approverRoles.join(", ")}`);
  }
  if (decision === "reject" && !reason?.trim()) throw new ApprovalError("REASON_REQUIRED", "A reason is required to reject");
}

export interface DecideInput {
  requestId: string;
  approver: SessionUser;
  reason?: string;
}

async function decide(decision: Decision, input: DecideInput, db: DbClient): Promise<ApprovalRequest> {
  return inTransaction(db, async (tx) => {
    const before = await tx.approvalRequest.findUnique({ where: { id: input.requestId } });
    if (!before) throw new NotFoundError("Approval request not found");
    assertCanDecide(before, input.approver, decision, input.reason);
    const status = decision === "approve" ? "APPROVED" : "REJECTED";
    // Conditional update guards against two approvers deciding concurrently.
    const { count } = await tx.approvalRequest.updateMany({
      where: { id: before.id, status: "PENDING" },
      data: { status, decidedById: input.approver.id, decidedAt: new Date(), decisionReason: input.reason?.trim() || null },
    });
    if (count !== 1) throw new ConflictError("Request was decided by someone else", "not_pending");
    const after = await tx.approvalRequest.findUniqueOrThrow({ where: { id: before.id } });
    await audit(
      input.approver,
      {
        action: `approval.${decision}`,
        entityType: "ApprovalRequest",
        entityId: before.id,
        before,
        after,
        metadata: { kind: before.kind, subject: `${before.entityType}:${before.entityId}` },
      },
      tx,
    );
    return after;
  });
}

export function approveRequest(input: DecideInput, db: DbClient = prisma): Promise<ApprovalRequest> {
  return decide("approve", input, db);
}

export function rejectRequest(input: DecideInput & { reason: string }, db: DbClient = prisma): Promise<ApprovalRequest> {
  return decide("reject", input, db);
}

export function isApproved(request: Pick<ApprovalRequest, "status">): boolean {
  return request.status === "APPROVED" || request.status === "AUTO_APPROVED";
}
