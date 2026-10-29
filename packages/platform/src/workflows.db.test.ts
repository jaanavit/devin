import { prisma } from "@fintech/models";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { REMIND_AFTER_MS, approvalRemindersJob } from "./approval-reminders";
import { JobAlreadyRunningError, SYSTEM_SCHEDULER, isDue, nextRunAt, runDueJobs, runJob, type JobDefinition } from "./jobs";
import { notify } from "./notify";
import { auditRowsFor, demoUsers, resetDb, seedDemoUsers } from "./testing";

const SLACK = "https://hooks.slack.com/services/T/B/X";
const HOUR = 3_600_000;
const NOW = new Date("2026-10-29T12:00:00Z");

let fetchSpy: ReturnType<typeof vi.fn>;
const slackTexts = () => fetchSpy.mock.calls.filter(([u]) => String(u) === SLACK).map(([, init]) => (JSON.parse(String((init as RequestInit).body)) as { text: string }).text);

beforeEach(async () => {
  await resetDb();
  await seedDemoUsers();
  fetchSpy = vi.fn(async () => new Response("ok"));
  vi.stubGlobal("fetch", fetchSpy);
  vi.stubEnv("SLACK_WEBHOOK_URL", SLACK);
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("notify()", () => {
  it("posts the text to the Slack webhook through the outbound allowlist", async () => {
    expect(await notify({ event: "x.y", text: "hello" })).toBe("sent");
    expect(slackTexts()).toEqual(["hello"]);
  });

  it("logs a stub with event + entity only (never the text) when unconfigured", async () => {
    vi.stubEnv("SLACK_WEBHOOK_URL", "");
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    expect(await notify({ event: "refund.large_alert", entity: { type: "refund", id: "ref_1" }, text: "secret details" })).toBe("stubbed");
    expect(info).toHaveBeenCalledWith("slack stub: refund.large_alert refund ref_1 (SLACK_WEBHOOK_URL not set)");
    expect(info.mock.calls.flat().join(" ")).not.toContain("secret details");
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("never throws: HTTP errors, network errors and blocked hosts all return 'failed'", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    fetchSpy.mockResolvedValueOnce(new Response("nope", { status: 500 }));
    expect(await notify({ event: "e", text: "t" })).toBe("failed");
    fetchSpy.mockRejectedValueOnce(new TypeError("network down"));
    expect(await notify({ event: "e", text: "t" })).toBe("failed");
    vi.stubEnv("SLACK_WEBHOOK_URL", "https://evil.example.com/hook");
    expect(await notify({ event: "e", text: "t" })).toBe("failed");
    expect(fetchSpy).toHaveBeenCalledTimes(2);
    expect(warn.mock.calls.flat().join(" ")).not.toContain(" t ");
  });
});

describe("scheduling (pure)", () => {
  it("every-N-minutes jobs are due after N minutes", () => {
    const s = { everyMinutes: 15 };
    expect(isDue(s, null, NOW)).toBe(true);
    expect(isDue(s, new Date(NOW.getTime() - 14 * 60_000), NOW)).toBe(false);
    expect(isDue(s, new Date(NOW.getTime() - 15 * 60_000), NOW)).toBe(true);
  });

  it("daily jobs run once after their UTC slot", () => {
    const s = { dailyAtUtc: "02:00" };
    expect(isDue(s, null, new Date("2026-10-29T01:59:00Z"))).toBe(false);
    expect(isDue(s, null, new Date("2026-10-29T02:00:00Z"))).toBe(true);
    expect(isDue(s, new Date("2026-10-29T02:00:05Z"), new Date("2026-10-29T23:00:00Z"))).toBe(false);
    expect(isDue(s, new Date("2026-10-28T02:00:05Z"), new Date("2026-10-29T03:00:00Z"))).toBe(true);
    expect(nextRunAt(s, new Date("2026-10-29T02:00:05Z"), new Date("2026-10-29T10:00:00Z")).toISOString()).toBe("2026-10-30T02:00:00.000Z");
  });
});

describe("runJob()", () => {
  const job = (run: JobDefinition["run"]): JobDefinition => ({ name: "test-job", description: "", schedule: { everyMinutes: 5 }, run });

  it("records a successful run, redacts PII in the result, and audits it", async () => {
    const run = await runJob(job(async () => ({ count: 3, ssn: "123-45-6789" })), { trigger: "manual", actor: demoUsers.ada });
    expect(run).toMatchObject({ job: "test-job", status: "SUCCEEDED", trigger: "manual", actorId: "u_ada", result: { count: 3, ssn: "[REDACTED]" } });
    const [row] = await auditRowsFor("JobRun", run.id);
    expect(row).toMatchObject({ action: "job.run", actorId: "u_ada", metadata: { job: "test-job", trigger: "manual", status: "SUCCEEDED" } });
  });

  it("records failures with the error class only", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const run = await runJob(job(async () => { throw new RangeError("row 123-45-6789 broke"); }), { trigger: "schedule", actor: SYSTEM_SCHEDULER });
    expect(run).toMatchObject({ status: "FAILED", error: "RangeError" });
    expect(JSON.stringify(await auditRowsFor("JobRun", run.id))).not.toContain("123-45-6789");
  });

  it("refuses to run the same job concurrently", async () => {
    let release!: () => void;
    const slow = job(() => new Promise((resolve) => { release = () => resolve({}); }));
    const first = runJob(slow, { trigger: "schedule", actor: SYSTEM_SCHEDULER });
    await vi.waitFor(async () => expect(await prisma.jobRun.count({ where: { status: "RUNNING" } })).toBe(1));
    await expect(runJob(slow, { trigger: "manual", actor: demoUsers.ada })).rejects.toBeInstanceOf(JobAlreadyRunningError);
    release();
    expect((await first).status).toBe("SUCCEEDED");
  });

  it("clears a stale RUNNING row left by a crashed run", async () => {
    await prisma.jobRun.create({ data: { job: "test-job", trigger: "schedule", actorId: "system:scheduler", startedAt: new Date(NOW.getTime() - 2 * HOUR) } });
    const run = await runJob(job(async () => ({})), { trigger: "manual", actor: demoUsers.ada, now: NOW });
    expect(run.status).toBe("SUCCEEDED");
    expect(await prisma.jobRun.count({ where: { status: "FAILED", error: { startsWith: "Stale" } } })).toBe(1);
  });

  it("runDueJobs runs only what is due", async () => {
    const ran = vi.fn(async () => ({}));
    const a: JobDefinition = { name: "a", description: "", schedule: { everyMinutes: 60 }, run: ran };
    expect(await runDueJobs([a], NOW)).toEqual(["a"]);
    expect(await runDueJobs([a], new Date(NOW.getTime() + 30 * 60_000))).toEqual([]);
    expect(await runDueJobs([a], new Date(NOW.getTime() + 60 * 60_000))).toEqual(["a"]);
    expect(ran).toHaveBeenCalledTimes(2);
  });
});

describe("approval reminders job", () => {
  const job = approvalRemindersJob({ linkFor: (kind, id) => (kind === "refund" ? `https://tools.test/refunds/${id}` : undefined) });
  const request = (id: string, ageMs: number, extra: Partial<{ status: "PENDING" | "APPROVED"; lastReminderAt: Date; kind: string }> = {}) =>
    prisma.approvalRequest.create({
      data: { id, kind: extra.kind ?? "refund", entityType: "Refund", entityId: `ref_${id}`, amountCents: 60_000, approverRoles: ["Reviewer"], requesterId: "u_aaron", createdAt: new Date(NOW.getTime() - ageMs), status: extra.status ?? "PENDING", lastReminderAt: extra.lastReminderAt ?? null },
    });
  const run = (now = NOW) => runJob(job, { trigger: "schedule", actor: SYSTEM_SCHEDULER, now });

  it("reminds once about requests pending more than an hour, in one digest without PII", async () => {
    await request("old", 3 * HOUR);
    await request("new", REMIND_AFTER_MS - 60_000);
    await request("done", 5 * HOUR, { status: "APPROVED" });
    const result = await run();
    expect(result.result).toMatchObject({ reminded: 1, approvalRequestIds: ["old"], notify: "sent" });
    const [text] = slackTexts();
    expect(text).toContain("1 approval request(s) waiting more than 1 hour");
    expect(text).toContain("refund Refund ref_old $600.00: waiting 3h for Reviewer <https://tools.test/refunds/ref_old|open>");
    expect((await auditRowsFor("ApprovalRequest", "old")).map((r) => r.action)).toEqual(["approval.remind"]);
    expect(await auditRowsFor("ApprovalRequest", "new")).toHaveLength(0);

    // An hour later only "new" has crossed the 1h mark; "old" is not reminded again until 24h later.
    expect((await run(new Date(NOW.getTime() + HOUR))).result).toMatchObject({ reminded: 1, approvalRequestIds: ["new"] });
    expect((await run(new Date(NOW.getTime() + 2 * HOUR))).result).toEqual({ reminded: 0 });
    expect((await run(new Date(NOW.getTime() + 25 * HOUR))).result).toMatchObject({ reminded: 2, approvalRequestIds: ["old", "new"] });
  });

  it("does nothing (and posts nothing) when no request is overdue", async () => {
    await request("fresh", 10 * 60_000);
    expect((await run()).result).toEqual({ reminded: 0 });
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
