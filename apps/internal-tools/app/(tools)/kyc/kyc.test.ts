import { prisma, type SessionUser } from "@fintech/models";
import { FORBIDDEN, auditRowsFor, demoUsers, isRedirectTo, resetDb, runAsUser, seedDemoUsers } from "@fintech/platform/testing";
import type { ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it } from "vitest";
import { KYC_DECISION_KIND } from "../../../../../scripts/seed/generate";
import CasePage from "./[id]/page";
import { kycWhere, slaInfo } from "./_lib/queue";
import { KYC_DECISION_POLICY, claimBlocker, decideBlocker, recommendBlocker, unclaimBlocker } from "./_lib/rules";
import { claimCase, decideCase, recommendCase, unclaimCase } from "./actions";
import QueuePage from "./page";

const { alice, aaron, rita, felix, ada, sam } = demoUsers;
const CASE = "kyc_t1";
const SSN = "900-12-3456";
const DOB = "1980-05-17";
const DOC = "P12345678";
const NOT_FOUND = { digest: "NEXT_HTTP_ERROR_FALLBACK;404" } as const;

const form = (fields: Record<string, string>) => {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  return fd;
};
const listPage = () => QueuePage({ searchParams: Promise.resolve({}) });
const detailPage = (id = CASE) => CasePage({ params: Promise.resolve({ id }) });
const renderAs = async (user: SessionUser, id = CASE) => renderToStaticMarkup((await runAsUser(user, () => detailPage(id))) as ReactElement);
const actions = async (id = CASE) => (await auditRowsFor("KycCase", id)).map((r) => r.action);
const getCase = () => prisma.kycCase.findUniqueOrThrow({ where: { id: CASE } });

const claim = (u: SessionUser, id = CASE) => runAsUser(u, () => claimCase(null, form({ id })));
const unclaim = (u: SessionUser, id = CASE) => runAsUser(u, () => unclaimCase(null, form({ id })));
const recommend = (u: SessionUser, fields: Record<string, string> = { recommendation: "APPROVE", notes: "Docs match." }) =>
  runAsUser(u, () => recommendCase(null, form({ id: CASE, ...fields })));
const decide = (u: SessionUser, fields: Record<string, string> = { decision: "APPROVE", reason: "Identity verified." }) =>
  runAsUser(u, () => decideCase(null, form({ id: CASE, ...fields })));

beforeEach(async () => {
  await resetDb();
  await seedDemoUsers();
  await prisma.customer.create({
    data: { id: "cus_t1", name: "Test Customer", email: "t1@example.com", ssn: SSN, dob: new Date(`${DOB}T00:00:00Z`), address: "1 Test St, Springfield", addressHash: "h1" },
  });
  const openedAt = new Date(Date.now() - 80 * 3_600_000);
  await prisma.kycCase.create({
    data: { id: CASE, customerId: "cus_t1", riskLevel: "MEDIUM", documentType: "passport", documentNumber: DOC, openedAt, slaDueAt: new Date(openedAt.getTime() + 72 * 3_600_000) },
  });
  await prisma.kycDocument.create({ data: { id: "kyc_t1_doc1", caseId: CASE, kind: "passport", fileName: "passport_cus_t1.png", fixture: { dob: DOB, documentNumber: DOC } } });
});

describe("_lib rules", () => {
  const recommended = { status: "RECOMMENDED" as const, assigneeId: sam.id, recommendedById: sam.id };

  it("blocks the preparer from deciding, even if they hold Reviewer", () => {
    expect(decideBlocker(recommended, sam)).toMatchObject({ code: "self_approval" });
    expect(decideBlocker({ ...recommended, assigneeId: null }, sam)).toMatchObject({ code: "self_approval" });
    expect(decideBlocker(recommended, rita)).toBeNull();
  });

  it("only lets Reviewers decide, and only recommended cases", () => {
    expect(decideBlocker(recommended, alice)).toMatchObject({ code: "forbidden" });
    expect(decideBlocker({ ...recommended, status: "IN_REVIEW" }, rita)).toMatchObject({ code: "conflict" });
  });

  it("lets only Analysts claim open cases and work on their own", () => {
    const open = { status: "OPEN" as const, assigneeId: null, recommendedById: null };
    const mine = { status: "IN_REVIEW" as const, assigneeId: alice.id, recommendedById: null };
    expect(claimBlocker(open, alice)).toBeNull();
    expect(claimBlocker(open, rita)).toMatchObject({ code: "forbidden" });
    expect(claimBlocker(mine, aaron)).toMatchObject({ code: "conflict" });
    expect(unclaimBlocker(mine, alice)).toBeNull();
    expect(unclaimBlocker(mine, aaron)).toMatchObject({ code: "conflict" });
    expect(recommendBlocker(mine, alice)).toBeNull();
    expect(recommendBlocker(mine, aaron)).toMatchObject({ code: "conflict" });
  });

  it("matches the seeded approval kind", () => {
    expect(KYC_DECISION_POLICY).toMatchObject({ kind: KYC_DECISION_KIND, entityType: "KycCase", approverRoles: ["Reviewer"] });
    expect(KYC_DECISION_POLICY.autoApproveMaxCents).toBeUndefined();
  });

  it("builds list filters from known values only", () => {
    expect(kycWhere({ status: "OPEN", riskLevel: "HIGH", assignee: "me" }, alice)).toEqual({ status: "OPEN", riskLevel: "HIGH", assigneeId: alice.id });
    expect(kycWhere({ status: "bogus", riskLevel: "x", assignee: "unassigned" }, alice)).toEqual({ assigneeId: null });
    expect(kycWhere({ assignee: "u_aaron" }, alice)).toEqual({ assigneeId: "u_aaron" });
  });

  it("computes SLA age and overdue state", () => {
    const now = new Date("2026-10-29T12:00:00Z");
    const openedAt = new Date("2026-10-26T10:00:00Z");
    expect(slaInfo({ openedAt, slaDueAt: new Date("2026-10-29T10:00:00Z"), status: "OPEN" }, now)).toEqual({ age: "3d 2h", overdue: true, label: "2h overdue" });
    expect(slaInfo({ openedAt, slaDueAt: new Date("2026-10-30T12:00:00Z"), status: "IN_REVIEW" }, now)).toMatchObject({ overdue: false, label: "Due in 1d 0h" });
    expect(slaInfo({ openedAt, slaDueAt: new Date("2026-10-27T10:00:00Z"), status: "APPROVED" }, now)).toMatchObject({ overdue: false, label: "Closed" });
  });
});

describe("/kyc list page", () => {
  it("redirects anonymous users and gives Admins 403", async () => {
    const err = await runAsUser(null, listPage).catch((e: unknown) => e);
    expect(isRedirectTo(err, "/login")).toBe(true);
    await expect(runAsUser(ada, listPage)).rejects.toMatchObject(FORBIDDEN);
  });

  it("renders for Analysts and Reviewers without PII", async () => {
    for (const user of [alice, rita]) {
      const html = renderToStaticMarkup((await runAsUser(user, listPage)) as ReactElement);
      expect(html).toContain(CASE);
      expect(html).toContain("overdue");
      expect(html).not.toContain(SSN);
    }
  });
});

describe("/kyc/[id] detail page", () => {
  it("gives Admins 403 and 404s unknown cases", async () => {
    await expect(runAsUser(ada, () => detailPage())).rejects.toMatchObject(FORBIDDEN);
    await expect(runAsUser(alice, () => detailPage("kyc_nope"))).rejects.toMatchObject(NOT_FOUND);
  });

  it("masks SSN, DOB, address and document number for Analysts and audits the view", async () => {
    const html = await renderAs(alice);
    expect(html).toContain("•••-••-3456");
    expect(html).toContain("••••-••-••");
    for (const raw of [SSN, DOB, DOC, "1 Test St"]) expect(html).not.toContain(raw);
    const rows = await auditRowsFor("KycCase", CASE);
    expect(rows.map((r) => [r.action, r.actorId])).toEqual([["kyc_case.view", alice.id]]);
  });

  it("shows full values to Reviewers and audits both the view and the PII reveal", async () => {
    const html = await renderAs(rita);
    for (const raw of [SSN, DOB, DOC, "1 Test St"]) expect(html).toContain(raw);
    const rows = await auditRowsFor("KycCase", CASE);
    expect(rows.map((r) => r.action)).toEqual(["kyc_case.view", "pii.view"]);
    expect(rows[1]).toMatchObject({ actorId: rita.id, metadata: { fields: ["ssn", "dob", "address", "documentNumber"] } });
    expect(JSON.stringify(rows)).not.toContain(SSN);
  });

  it("lists documents without exposing the document fixture", async () => {
    const html = await renderAs(rita);
    expect(html).toContain("passport_cus_t1.png");
  });

  it("hides the decision form from the preparer and shows it to another Reviewer", async () => {
    expect(await claim(sam)).toMatchObject({ ok: true });
    expect(await recommend(sam)).toMatchObject({ ok: true });
    const asSam = await renderAs(sam);
    expect(asSam).not.toContain("Record final decision");
    expect(asSam).toContain("You prepared this case");
    const asRita = await renderAs(rita);
    expect(asRita).toContain("Record final decision");
    const asAlice = await renderAs(alice);
    expect(asAlice).not.toContain("Record final decision");
  });

  it("shows claim to Analysts only, and the recommendation form to the assignee only", async () => {
    expect(await renderAs(alice)).toContain(">Claim<");
    expect(await renderAs(rita)).not.toContain(">Claim<");
    await claim(alice);
    expect(await renderAs(alice)).toContain("Submit recommendation");
    expect(await renderAs(aaron)).not.toContain("Submit recommendation");
  });
});

describe("claimCase / unclaimCase", () => {
  it("are denied for Reviewers, Admins and anonymous users", async () => {
    for (const user of [rita, ada]) {
      expect(await claim(user)).toMatchObject({ ok: false, code: "forbidden" });
      expect(await unclaim(user)).toMatchObject({ ok: false, code: "forbidden" });
    }
    expect(await claim(null as unknown as SessionUser)).toMatchObject({ ok: false, code: "unauthenticated" });
    expect((await getCase()).assigneeId).toBeNull();
  });

  it("claims, audits, and prevents a second Analyst from taking the case", async () => {
    expect(await claim(alice)).toMatchObject({ ok: true });
    expect(await getCase()).toMatchObject({ status: "IN_REVIEW", assigneeId: alice.id });
    expect(await claim(aaron)).toMatchObject({ ok: false, code: "invalid_state" });
    expect(await unclaim(aaron)).toMatchObject({ ok: false, code: "invalid_state" });
    expect(await actions()).toEqual(["kyc_case.claim"]);
    const [row] = await auditRowsFor("KycCase", CASE);
    expect(row).toMatchObject({ actorId: alice.id, before: { status: "OPEN", documentNumber: "[REDACTED]" }, after: { status: "IN_REVIEW" } });
  });

  it("unclaims and audits", async () => {
    await claim(alice);
    expect(await unclaim(alice)).toMatchObject({ ok: true });
    expect(await getCase()).toMatchObject({ status: "OPEN", assigneeId: null });
    expect(await actions()).toEqual(["kyc_case.claim", "kyc_case.unclaim"]);
  });
});

describe("recommendCase", () => {
  it("is denied for Reviewers and requires the case to be claimed by the caller", async () => {
    expect(await recommend(rita)).toMatchObject({ ok: false, code: "forbidden" });
    expect(await recommend(alice)).toMatchObject({ ok: false, code: "invalid_state" });
    await claim(alice);
    expect(await recommend(aaron)).toMatchObject({ ok: false, code: "invalid_state" });
  });

  it("validates outcome and notes", async () => {
    await claim(alice);
    expect(await recommend(alice, { recommendation: "MAYBE", notes: "x" })).toMatchObject({ ok: false, code: "invalid_outcome" });
    expect(await recommend(alice, { recommendation: "APPROVE", notes: "  " })).toMatchObject({ ok: false, code: "required" });
    expect((await getCase()).status).toBe("IN_REVIEW");
  });

  it("records the recommendation, opens a maker-checker request, and audits both", async () => {
    await claim(alice);
    expect(await recommend(alice)).toMatchObject({ ok: true });
    expect(await getCase()).toMatchObject({ status: "RECOMMENDED", recommendation: "APPROVE", recommendationNotes: "Docs match.", recommendedById: alice.id });
    const request = await prisma.approvalRequest.findFirstOrThrow({ where: { entityType: "KycCase", entityId: CASE } });
    expect(request).toMatchObject({ kind: "kyc_decision", status: "PENDING", requesterId: alice.id, approverRoles: ["Reviewer"] });
    expect(await actions()).toEqual(["kyc_case.claim", "kyc_case.recommend"]);
    expect((await auditRowsFor("ApprovalRequest", request.id)).map((r) => r.action)).toEqual(["approval.request"]);
  });
});

describe("decideCase", () => {
  beforeEach(async () => {
    await claim(sam);
    await recommend(sam);
  });

  it("is denied for Analysts and Admins", async () => {
    for (const user of [alice, ada]) expect(await decide(user)).toMatchObject({ ok: false, code: "forbidden" });
    expect((await getCase()).status).toBe("RECOMMENDED");
  });

  it("blocks the analyst who prepared the case from making the final decision", async () => {
    const res = await decide(sam);
    expect(res).toMatchObject({ ok: false, code: "self_approval" });
    expect(await getCase()).toMatchObject({ status: "RECOMMENDED", decision: null, decidedById: null });
    expect(await prisma.approvalRequest.findFirstOrThrow({ where: { entityId: CASE } })).toMatchObject({ status: "PENDING", decidedById: null });
    expect(await actions()).not.toContain("kyc_case.decide");
  });

  it("requires a reason and a valid decision", async () => {
    expect(await decide(rita, { decision: "APPROVE", reason: "" })).toMatchObject({ ok: false, code: "required" });
    expect(await decide(rita, { decision: "YES", reason: "ok" })).toMatchObject({ ok: false, code: "invalid_outcome" });
    expect((await getCase()).status).toBe("RECOMMENDED");
  });

  it("approves, closes the approval request, and audits in one go", async () => {
    expect(await decide(rita)).toMatchObject({ ok: true });
    expect(await getCase()).toMatchObject({ status: "APPROVED", decision: "APPROVE", decisionReason: "Identity verified.", decidedById: rita.id });
    const request = await prisma.approvalRequest.findFirstOrThrow({ where: { entityId: CASE } });
    expect(request).toMatchObject({ status: "APPROVED", decidedById: rita.id, decisionReason: "Identity verified." });
    expect(await actions()).toEqual(["kyc_case.claim", "kyc_case.recommend", "kyc_case.decide"]);
    expect((await auditRowsFor("ApprovalRequest", request.id)).map((r) => r.action)).toEqual(["approval.request", "approval.approve"]);
    expect(await decide(felix)).toMatchObject({ ok: false, code: "invalid_state" });
  });

  it("can reject against the recommendation", async () => {
    expect(await decide(felix, { decision: "REJECT", reason: "Document expired." })).toMatchObject({ ok: true });
    expect(await getCase()).toMatchObject({ status: "REJECTED", decision: "REJECT", recommendation: "APPROVE", decidedById: felix.id });
    expect(await prisma.approvalRequest.findFirstOrThrow({ where: { entityId: CASE } })).toMatchObject({ status: "REJECTED" });
  });
});

describe("end to end", () => {
  it("claim → recommend → decide by a different person", async () => {
    expect(await claim(alice)).toMatchObject({ ok: true });
    expect(await recommend(alice, { recommendation: "REJECT", notes: "Address mismatch." })).toMatchObject({ ok: true });
    expect(await decide(rita, { decision: "REJECT", reason: "Confirmed address mismatch." })).toMatchObject({ ok: true });
    expect(await getCase()).toMatchObject({ status: "REJECTED", assigneeId: alice.id, recommendedById: alice.id, decidedById: rita.id });
    expect(await actions()).toEqual(["kyc_case.claim", "kyc_case.recommend", "kyc_case.decide"]);
  });
});
