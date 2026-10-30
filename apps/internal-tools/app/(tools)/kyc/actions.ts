"use server";

import { prisma, type Db, type KycCase, type Prisma } from "@fintech/models";
import { ConflictError, NotFoundError, ValidationError } from "@fintech/platform";
import {
  approveRequest,
  audit,
  createApprovalRequest,
  inTransaction,
  rejectRequest,
  requireRole,
  runAction,
  type ActionResult,
} from "@fintech/platform/server";
import { revalidatePath } from "next/cache";
import { KYC_DECIDER_ROLES, KYC_PREPARER_ROLES } from "@/lib/catalog";
import {
  KYC_DECISION_POLICY,
  claimBlocker,
  decideBlocker,
  enforce,
  parseOutcome,
  recommendBlocker,
  requireText,
  unclaimBlocker,
} from "./_lib/rules";

function caseId(formData: FormData): string {
  const id = formData.get("id");
  if (typeof id !== "string" || !id) throw new ValidationError("Missing case id");
  return id;
}

async function loadCase(tx: Db, id: string): Promise<KycCase> {
  const kase = await tx.kycCase.findUnique({ where: { id } });
  if (!kase) throw new NotFoundError("KYC case not found");
  return kase;
}

/** Conditional update: applies `data` only if the case is still in the state the rules were checked against. */
async function transition(tx: Db, before: KycCase, data: Prisma.KycCaseUncheckedUpdateManyInput): Promise<KycCase> {
  const { count } = await tx.kycCase.updateMany({
    where: { id: before.id, status: before.status, assigneeId: before.assigneeId },
    data,
  });
  if (count !== 1) throw new ConflictError("Case was changed by someone else; reload and try again", "stale");
  return tx.kycCase.findUniqueOrThrow({ where: { id: before.id } });
}

function revalidate(id: string): void {
  revalidatePath("/kyc");
  revalidatePath(`/kyc/${id}`);
}

export async function claimCase(_prev: ActionResult<unknown> | null, formData: FormData): Promise<ActionResult<unknown>> {
  return runAction(async () => {
    const user = await requireRole(KYC_PREPARER_ROLES);
    const id = caseId(formData);
    await inTransaction(prisma, async (tx) => {
      const before = await loadCase(tx, id);
      enforce(claimBlocker(before, user));
      const after = await transition(tx, before, { status: "IN_REVIEW", assigneeId: user.id, claimedAt: new Date() });
      await audit(user, { action: "kyc_case.claim", entityType: "KycCase", entityId: id, before, after }, tx);
    });
    revalidate(id);
  }, "Case claimed.");
}

export async function unclaimCase(_prev: ActionResult<unknown> | null, formData: FormData): Promise<ActionResult<unknown>> {
  return runAction(async () => {
    const user = await requireRole(KYC_PREPARER_ROLES);
    const id = caseId(formData);
    await inTransaction(prisma, async (tx) => {
      const before = await loadCase(tx, id);
      enforce(unclaimBlocker(before, user));
      const after = await transition(tx, before, { status: "OPEN", assigneeId: null, claimedAt: null });
      await audit(user, { action: "kyc_case.unclaim", entityType: "KycCase", entityId: id, before, after }, tx);
    });
    revalidate(id);
  }, "Case released.");
}

export async function recommendCase(_prev: ActionResult<unknown> | null, formData: FormData): Promise<ActionResult<unknown>> {
  return runAction(async () => {
    const user = await requireRole(KYC_PREPARER_ROLES);
    const id = caseId(formData);
    const recommendation = parseOutcome(formData.get("recommendation"));
    const notes = requireText(formData.get("notes"), "Notes");
    await inTransaction(prisma, async (tx) => {
      const before = await loadCase(tx, id);
      enforce(recommendBlocker(before, user));
      const after = await transition(tx, before, {
        status: "RECOMMENDED",
        recommendation,
        recommendationNotes: notes,
        recommendedById: user.id,
        recommendedAt: new Date(),
      });
      const request = await createApprovalRequest({ policy: KYC_DECISION_POLICY, entityId: id, requester: user }, tx);
      await audit(
        user,
        { action: "kyc_case.recommend", entityType: "KycCase", entityId: id, before, after, metadata: { recommendation, approvalRequestId: request.id } },
        tx,
      );
    });
    revalidate(id);
  }, "Recommendation submitted for review.");
}

export async function decideCase(_prev: ActionResult<unknown> | null, formData: FormData): Promise<ActionResult<unknown>> {
  return runAction(async () => {
    const user = await requireRole(KYC_DECIDER_ROLES);
    const id = caseId(formData);
    const decision = parseOutcome(formData.get("decision"));
    const reason = requireText(formData.get("reason"), "Reason");
    await inTransaction(prisma, async (tx) => {
      const before = await loadCase(tx, id);
      // Maker-checker, domain side: the preparer may never decide (the platform re-checks approver ≠ requester).
      enforce(decideBlocker(before, user));
      const request = await tx.approvalRequest.findFirst({
        where: { kind: KYC_DECISION_POLICY.kind, entityType: KYC_DECISION_POLICY.entityType, entityId: id, status: "PENDING" },
      });
      if (!request) throw new ConflictError("No pending decision request for this case", "no_pending_request");
      const decided = await (decision === "APPROVE" ? approveRequest : rejectRequest)({ requestId: request.id, approver: user, reason }, tx);
      const after = await transition(tx, before, {
        status: decision === "APPROVE" ? "APPROVED" : "REJECTED",
        decision,
        decisionReason: reason,
        decidedById: user.id,
        decidedAt: decided.decidedAt ?? new Date(),
      });
      await audit(
        user,
        { action: "kyc_case.decide", entityType: "KycCase", entityId: id, before, after, metadata: { decision, approvalRequestId: request.id } },
        tx,
      );
    });
    revalidate(id);
  }, "Decision recorded.");
}
