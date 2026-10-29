import { audit } from "@fintech/platform/server";
import { FORBIDDEN, auditRowsFor, demoUsers, isRedirectTo, resetDb, runAsUser, seedDemoUsers } from "@fintech/platform/testing";
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it } from "vitest";
import { GET as exportCsv } from "./export/route";
import AuditPage from "./page";

const exportReq = (qs = "") => new NextRequest(new URL(`/audit/export${qs}`, "http://localhost:3000"));
const noParams = { searchParams: Promise.resolve({}) };

beforeEach(async () => {
  await resetDb();
  await seedDemoUsers();
  await audit(demoUsers.alice, { action: "kyc_case.claim", entityType: "KycCase", entityId: "kyc_1" });
  await audit(demoUsers.rita, { action: "approval.approve", entityType: "ApprovalRequest", entityId: "apr_1" });
});

describe("audit viewer page", () => {
  it("redirects anonymous users to /login", async () => {
    const err = await runAsUser(null, () => AuditPage(noParams)).catch((e: unknown) => e);
    expect(isRedirectTo(err, "/login")).toBe(true);
  });

  it("renders 403 for non-Admins", async () => {
    await expect(runAsUser(demoUsers.rita, () => AuditPage(noParams))).rejects.toMatchObject(FORBIDDEN);
    await expect(runAsUser(demoUsers.alice, () => AuditPage(noParams))).rejects.toMatchObject(FORBIDDEN);
  });

  it("renders for Admins", async () => {
    await expect(runAsUser(demoUsers.ada, () => AuditPage(noParams))).resolves.toBeTruthy();
  });
});

describe("GET /audit/export", () => {
  it("returns 401 for anonymous and 403 for non-Admin callers", async () => {
    expect((await runAsUser(null, () => exportCsv(exportReq()))).status).toBe(401);
    expect((await runAsUser(demoUsers.sam, () => exportCsv(exportReq()))).status).toBe(403);
  });

  it("exports filtered CSV and audits the export itself", async () => {
    const res = await runAsUser(demoUsers.ada, () => exportCsv(exportReq("?actor=alice")));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/csv");
    const lines = (await res.text()).trim().split("\r\n");
    expect(lines[0]).toBe("timestamp,actor_id,actor_email,action,entity_type,entity_id,before,after,metadata");
    expect(lines).toHaveLength(2);
    expect(lines[1]).toContain("kyc_case.claim");

    const [exportRow] = await auditRowsFor("AuditLog", "export");
    expect(exportRow).toMatchObject({ action: "audit_log.export", actorId: "u_ada", metadata: { rowCount: 1, filters: { actor: "alice" } } });
  });
});
