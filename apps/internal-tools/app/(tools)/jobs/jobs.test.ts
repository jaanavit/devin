import { prisma } from "@fintech/models";
import { FORBIDDEN, auditRowsFor, demoUsers, isRedirectTo, resetDb, runAsUser, seedDemoUsers } from "@fintech/platform/testing";
import type { ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { JOBS } from "@/lib/jobs";
import { collectOpsSummary, summaryText } from "@/lib/jobs/nightly-ops-summary";
import { runJobNow } from "./actions";
import JobsPage from "./page";

const SLACK = "https://hooks.slack.com/services/T/B/jobs";
const HOUR = 3_600_000;
const form = (job: string) => {
  const fd = new FormData();
  fd.set("job", job);
  return fd;
};
let fetchSpy: ReturnType<typeof vi.fn>;
const slackTexts = () => fetchSpy.mock.calls.filter(([u]) => String(u) === SLACK).map(([, init]) => (JSON.parse(String((init as RequestInit).body)) as { text: string }).text);

beforeEach(async () => {
  await resetDb();
  await seedDemoUsers();
  fetchSpy = vi.fn(async () => new Response("ok"));
  vi.stubGlobal("fetch", fetchSpy);
  vi.stubEnv("SLACK_WEBHOOK_URL", SLACK);
  vi.stubEnv("NEXTAUTH_URL", "https://tools.test");
  const now = Date.now();
  await prisma.customer.create({ data: { id: "cus_1", name: "Pat Private", email: "pat@example.com", ssn: "900-11-2222", dob: new Date("1990-01-01"), address: "9 Secret Ln", addressHash: "h" } });
  await prisma.transaction.create({ data: { id: "txn_1", customerId: "cus_1", amountCents: 90_000, merchant: "Apple", status: "SETTLED", deviceId: "d", cardFingerprint: "c", createdAt: new Date(now - 48 * HOUR) } });
  await prisma.kycCase.createMany({
    data: [
      { id: "kyc_late_high", customerId: "cus_1", riskLevel: "HIGH", documentType: "passport", documentNumber: "P1", status: "IN_REVIEW", openedAt: new Date(now - 50 * HOUR), slaDueAt: new Date(now - 26 * HOUR) },
      { id: "kyc_late_low", customerId: "cus_1", riskLevel: "LOW", documentType: "passport", documentNumber: "P2", status: "OPEN", openedAt: new Date(now - 80 * HOUR), slaDueAt: new Date(now - 8 * HOUR) },
      { id: "kyc_on_time", customerId: "cus_1", riskLevel: "LOW", documentType: "passport", documentNumber: "P3", status: "OPEN", openedAt: new Date(now - HOUR), slaDueAt: new Date(now + 71 * HOUR) },
      { id: "kyc_closed_late", customerId: "cus_1", riskLevel: "HIGH", documentType: "passport", documentNumber: "P4", status: "APPROVED", openedAt: new Date(now - 90 * HOUR), slaDueAt: new Date(now - 60 * HOUR) },
    ],
  });
  await prisma.refund.createMany({
    data: [
      { id: "ref_pending", transactionId: "txn_1", customerId: "cus_1", amountCents: 60_000, reason: "r", status: "PENDING_APPROVAL", requestedById: "u_aaron", createdAt: new Date(now - 5 * HOUR) },
      { id: "ref_done", transactionId: "txn_1", customerId: "cus_1", amountCents: 1_000, reason: "r", status: "PROCESSED", requestedById: "u_aaron", createdAt: new Date(now - 5 * HOUR) },
    ],
  });
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("/jobs page and Run now", () => {
  it("is Admin-only", async () => {
    const err = await runAsUser(null, () => JobsPage()).catch((e: unknown) => e);
    expect(isRedirectTo(err, "/login")).toBe(true);
    await expect(runAsUser(demoUsers.rita, () => JobsPage())).rejects.toMatchObject(FORBIDDEN);
    expect(await runAsUser(demoUsers.alice, () => runJobNow(null, form("nightly-ops-summary")))).toMatchObject({ ok: false, code: "forbidden" });
    expect(slackTexts()).toHaveLength(0);
  });

  it("lists every registered job for Admins", async () => {
    const html = renderToStaticMarkup((await runAsUser(demoUsers.ada, () => JobsPage())) as ReactElement);
    for (const job of JOBS) expect(html).toContain(job.name);
    expect(html).toContain("daily at 02:00 UTC");
  });

  it("manually triggering the nightly job posts the summary to Slack and audits the run", async () => {
    const res = await runAsUser(demoUsers.ada, () => runJobNow(null, form("nightly-ops-summary")));
    expect(res).toMatchObject({ ok: true });
    const [text = ""] = slackTexts();
    expect(text).toContain("*KYC cases past SLA:* 2 (high 1, low 1)");
    expect(text.indexOf("kyc_late_high")).toBeLessThan(text.indexOf("kyc_late_low"));
    expect(text).toContain("<https://tools.test/kyc/kyc_late_high|kyc_late_high> high risk, 1d 2h overdue");
    expect(text).toContain("*Refunds awaiting approval:* 1 totalling $600.00");
    expect(text).toContain("<https://tools.test/refunds/ref_pending|ref_pending> $600.00, waiting 5h");
    expect(text).not.toMatch(/kyc_on_time|kyc_closed_late|ref_done|Pat Private|900-11-2222|Secret Ln/);

    const run = await prisma.jobRun.findFirstOrThrow({ where: { job: "nightly-ops-summary" } });
    expect(run).toMatchObject({ status: "SUCCEEDED", trigger: "manual", actorId: "u_ada", result: { kycOverdue: 2, refundsPending: 1, notify: "sent" } });
    expect((await auditRowsFor("JobRun", run.id)).map((r) => [r.action, r.actorId])).toEqual([["job.run", "u_ada"]]);
  });

  it("manually triggering approval reminders reminds about the overdue refund approval", async () => {
    await prisma.approvalRequest.create({ data: { id: "apr_1", kind: "refund", entityType: "Refund", entityId: "ref_pending", amountCents: 60_000, approverRoles: ["Reviewer"], requesterId: "u_aaron", createdAt: new Date(Date.now() - 2 * HOUR) } });
    expect(await runAsUser(demoUsers.ada, () => runJobNow(null, form("approval-reminders")))).toMatchObject({ ok: true });
    expect(slackTexts()[0]).toContain("<https://tools.test/refunds/ref_pending|open>");
  });

  it("rejects unknown jobs", async () => {
    expect(await runAsUser(demoUsers.ada, () => runJobNow(null, form("nope")))).toMatchObject({ ok: false, code: "not_found" });
  });
});

describe("summary text", () => {
  it("handles an empty day", async () => {
    await prisma.$executeRawUnsafe(`UPDATE "KycCase" SET status = 'APPROVED'`);
    await prisma.$executeRawUnsafe(`UPDATE "Refund" SET status = 'PROCESSED'`);
    const text = summaryText(await collectOpsSummary(new Date()), new Date());
    expect(text).toContain("*KYC cases past SLA:* 0");
    expect(text).toContain("*Refunds awaiting approval:* 0 totalling $0.00");
  });
});
