import { prisma } from "@fintech/models";
import { beforeEach, describe, expect, it } from "vitest";
import { approveRequest, createApprovalRequest, rejectRequest, type ApprovalPolicy } from "./approval";
import { audit } from "./audit";
import { requireRole } from "./auth/require-role";
import { AccessDeniedError, ApprovalError, UnauthenticatedError } from "./errors";
import { maskForViewer } from "./pii";
import { auditRowsFor, demoUsers, resetDb, runAsUser, seedDemoUsers } from "./testing";

const refundPolicy: ApprovalPolicy = { kind: "refund", entityType: "Refund", approverRoles: ["Reviewer"], autoApproveMaxCents: 50_000 };

beforeEach(async () => {
  await resetDb();
  await seedDemoUsers();
});

describe("requireRole()", () => {
  it("denies anonymous callers with 401", async () => {
    await expect(runAsUser(null, () => requireRole(["Analyst"]))).rejects.toBeInstanceOf(UnauthenticatedError);
  });

  it("denies users without the role with 403", async () => {
    await expect(runAsUser(demoUsers.alice, () => requireRole(["Admin"]))).rejects.toBeInstanceOf(AccessDeniedError);
  });

  it("allows users holding any listed role", async () => {
    await expect(runAsUser(demoUsers.rita, () => requireRole(["Analyst", "Reviewer"]))).resolves.toMatchObject({ id: "u_rita" });
  });

  it("refuses an empty role list (no public access)", async () => {
    await expect(runAsUser(demoUsers.ada, () => requireRole([]))).rejects.toThrow(/at least one role/);
  });
});

describe("audit()", () => {
  it("writes actor, action, entity, before/after with PII redacted", async () => {
    await audit(demoUsers.alice, {
      action: "customer.update",
      entityType: "Customer",
      entityId: "cus_1",
      before: { name: "A", ssn: "123-45-6789" },
      after: { name: "B", ssn: "123-45-6789" },
    });
    const [row] = await auditRowsFor("Customer", "cus_1");
    expect(row).toMatchObject({ actorId: "u_alice", actorEmail: demoUsers.alice.email, action: "customer.update" });
    expect(row?.before).toEqual({ name: "A", ssn: "[REDACTED]" });
    expect(row?.createdAt).toBeInstanceOf(Date);
  });

  it("is append-only: UPDATE, DELETE and TRUNCATE are rejected by the database", async () => {
    const row = await audit(demoUsers.alice, { action: "x.y", entityType: "X", entityId: "1" });
    await expect(prisma.auditLog.update({ where: { id: row.id }, data: { action: "tampered" } })).rejects.toThrow(/append-only/);
    await expect(prisma.auditLog.delete({ where: { id: row.id } })).rejects.toThrow(/append-only/);
    await expect(prisma.$executeRawUnsafe(`TRUNCATE "AuditLog"`)).rejects.toThrow(/append-only/);
    expect(await prisma.auditLog.count()).toBe(1);
  });
});

describe("approval primitive", () => {
  it("auto-approves at or below the threshold and audits it", async () => {
    const req = await createApprovalRequest({ policy: refundPolicy, entityId: "r1", amountCents: 49_900, requester: demoUsers.aaron });
    expect(req.status).toBe("AUTO_APPROVED");
    expect((await auditRowsFor("ApprovalRequest", req.id)).map((r) => r.action)).toEqual(["approval.auto_approve"]);
  });

  it("requires a second approver above the threshold", async () => {
    const req = await createApprovalRequest({ policy: refundPolicy, entityId: "r2", amountCents: 50_100, requester: demoUsers.aaron });
    expect(req.status).toBe("PENDING");
    const approved = await approveRequest({ requestId: req.id, approver: demoUsers.felix });
    expect(approved).toMatchObject({ status: "APPROVED", decidedById: "u_felix" });
    expect((await auditRowsFor("ApprovalRequest", req.id)).map((r) => r.action)).toEqual(["approval.request", "approval.approve"]);
  });

  it("rejects self-approval and leaves the request pending", async () => {
    const req = await createApprovalRequest({ policy: refundPolicy, entityId: "r3", amountCents: 90_000, requester: demoUsers.sam });
    await expect(approveRequest({ requestId: req.id, approver: demoUsers.sam })).rejects.toMatchObject({ reason: "SELF_APPROVAL" });
    expect((await prisma.approvalRequest.findUniqueOrThrow({ where: { id: req.id } })).status).toBe("PENDING");
  });

  it("rejects approvers without the approver role", async () => {
    const req = await createApprovalRequest({ policy: refundPolicy, entityId: "r4", amountCents: 90_000, requester: demoUsers.aaron });
    await expect(approveRequest({ requestId: req.id, approver: demoUsers.alice })).rejects.toBeInstanceOf(ApprovalError);
  });

  it("rejects with a required reason and cannot be decided twice", async () => {
    const req = await createApprovalRequest({ policy: refundPolicy, entityId: "r5", amountCents: 90_000, requester: demoUsers.aaron });
    await expect(rejectRequest({ requestId: req.id, approver: demoUsers.rita, reason: "" })).rejects.toMatchObject({ reason: "REASON_REQUIRED" });
    const rejected = await rejectRequest({ requestId: req.id, approver: demoUsers.rita, reason: "Duplicate" });
    expect(rejected).toMatchObject({ status: "REJECTED", decisionReason: "Duplicate" });
    await expect(approveRequest({ requestId: req.id, approver: demoUsers.felix })).rejects.toMatchObject({ reason: "NOT_PENDING" });
  });
});

describe("maskForViewer()", () => {
  const record = { id: "cus_9", ssn: "123-45-6789", dob: new Date("1990-01-01") };

  it("masks for Analysts without writing a PII-view audit row", async () => {
    const out = await maskForViewer(demoUsers.alice, record, { entityType: "Customer", entityId: "cus_9" });
    expect(out.ssn).toBe("•••-••-6789");
    expect(await auditRowsFor("Customer", "cus_9")).toHaveLength(0);
  });

  it("reveals for Reviewers and audits the view with field names only", async () => {
    const out = await maskForViewer(demoUsers.rita, record, { entityType: "Customer", entityId: "cus_9" });
    expect(out.ssn).toBe("123-45-6789");
    const rows = await auditRowsFor("Customer", "cus_9");
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ action: "pii.view", actorId: "u_rita", metadata: { fields: ["ssn", "dob"] } });
    expect(JSON.stringify(rows[0])).not.toContain("6789");
  });
});
