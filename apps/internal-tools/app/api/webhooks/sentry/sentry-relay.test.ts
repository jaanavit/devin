import { createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { prisma } from "@fintech/models";
import { auditRowsFor, resetDb } from "@fintech/platform/testing";
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildDevinPrompt, parseSentryWebhook, verifySentrySignature } from "@/lib/maintenance/sentry-relay";
import { scrubEvent } from "@/lib/sentry";
import { POST } from "./route";

const SECRET = "sentry-client-secret";
const fixture = (name: string) => readFileSync(path.resolve(__dirname, "../../../../lib/maintenance/__fixtures__", name), "utf8");
const EVENT_ALERT = fixture("sentry-event-alert.json");
const ISSUE_CREATED = fixture("sentry-issue-created.json");
const sign = (body: string, secret = SECRET) => createHmac("sha256", secret).update(body).digest("hex");
const PII = /123-45-6789|jane\.doe@example\.com|felix\.finance|10\.0\.0\.7|card stolen|1 Main St|Pat Private|session-token/;

function webhook(body: string, resource: string, signature = sign(body)) {
  return new NextRequest("http://localhost:3000/api/webhooks/sentry", {
    method: "POST",
    body,
    headers: { "content-type": "application/json", "sentry-hook-resource": resource, "sentry-hook-signature": signature },
  });
}

let fetchSpy: ReturnType<typeof vi.fn>;
const devinCalls = () => fetchSpy.mock.calls.filter(([u]) => String(u).startsWith("https://api.devin.ai/"));

beforeEach(async () => {
  await resetDb();
  vi.stubEnv("SENTRY_WEBHOOK_SECRET", SECRET);
  vi.stubEnv("DEVIN_API_KEY", "apk_test");
  vi.stubEnv("DEVIN_ORG_ID", "org-test123");
  vi.stubEnv("DEVIN_TARGET_REPO", "jaanavit/devin");
  fetchSpy = vi.fn(async () => Response.json({ session_id: "devin-abc", url: "https://app.devin.ai/sessions/abc", status: "running" }));
  vi.stubGlobal("fetch", fetchSpy);
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("signature verification", () => {
  it("accepts only the HMAC-SHA256 of the raw body with the client secret", () => {
    expect(verifySentrySignature(EVENT_ALERT, sign(EVENT_ALERT), SECRET)).toBe(true);
    expect(verifySentrySignature(EVENT_ALERT, sign(EVENT_ALERT, "wrong"), SECRET)).toBe(false);
    expect(verifySentrySignature(`${EVENT_ALERT} `, sign(EVENT_ALERT), SECRET)).toBe(false);
    expect(verifySentrySignature(EVENT_ALERT, null, SECRET)).toBe(false);
    expect(verifySentrySignature(EVENT_ALERT, sign(EVENT_ALERT), undefined)).toBe(false);
    expect(verifySentrySignature(EVENT_ALERT, "not-hex", SECRET)).toBe(false);
  });
});

describe("payload parsing and prompt", () => {
  it("extracts the error, stack trace (crashing frame first) and issue link from an event alert", () => {
    const issue = parseSentryWebhook("event_alert", JSON.parse(EVENT_ALERT))!;
    expect(issue).toMatchObject({ issueId: "4504123456", errorType: "TypeError", link: "https://sentry.io/issues/4504123456/", level: "error" });
    expect(issue.frames.map((f) => f.function)).toEqual(["processRefund", "approveRefund", "processTicksAndRejections"]);
    expect(issue.frames[0]).toEqual({ filename: "app/(tools)/refunds/_lib/process.ts", function: "processRefund", lineno: 22, colno: 61, inApp: true });
  });

  it("parses issue.created and ignores other resources/actions", () => {
    expect(parseSentryWebhook("issue", JSON.parse(ISSUE_CREATED))).toMatchObject({ issueId: "4504999999", shortId: "INTERNAL-TOOLS-1F", link: "https://fintech.sentry.io/issues/4504999999/", frames: [] });
    expect(parseSentryWebhook("issue", { ...JSON.parse(ISSUE_CREATED), action: "resolved" })).toBeUndefined();
    expect(parseSentryWebhook("metric_alert", JSON.parse(EVENT_ALERT))).toBeUndefined();
    expect(parseSentryWebhook("event_alert", { action: "triggered", data: {} })).toBeUndefined();
  });

  it("builds instructions to reproduce, fix, add a regression test and open a PR, with no PII", () => {
    const prompt = buildDevinPrompt(parseSentryWebhook("event_alert", JSON.parse(EVENT_ALERT))!, "jaanavit/devin");
    expect(prompt).toContain("Sentry issue: https://sentry.io/issues/4504123456/");
    expect(prompt).toContain("Error: TypeError: Cannot read properties of undefined (reading 'amountCents')");
    expect(prompt).toContain("at processRefund (app/(tools)/refunds/_lib/process.ts:22:61)");
    expect(prompt).toMatch(/Reproduce the error/);
    expect(prompt).toMatch(/Add a regression test/);
    expect(prompt).toMatch(/Open a PR/);
    expect(prompt).not.toMatch(PII);
    expect(prompt).toContain("[REDACTED-EMAIL]");
  });
});

describe("POST /api/webhooks/sentry", () => {
  it("rejects missing or bad signatures without calling Devin", async () => {
    expect((await POST(webhook(EVENT_ALERT, "event_alert", "0".repeat(64)))).status).toBe(401);
    vi.stubEnv("SENTRY_WEBHOOK_SECRET", "");
    expect((await POST(webhook(EVENT_ALERT, "event_alert"))).status).toBe(401);
    expect(devinCalls()).toHaveLength(0);
  });

  it("starts a Devin session via the v3 API for a new issue and audits it", async () => {
    const res = await POST(webhook(EVENT_ALERT, "event_alert"));
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ status: "created", issueId: "4504123456", sessionUrl: "https://app.devin.ai/sessions/abc" });
    const [[url, init]] = devinCalls() as [[string, RequestInit]];
    expect(url).toBe("https://api.devin.ai/v3/organizations/org-test123/sessions");
    expect((init.headers as Record<string, string>).authorization).toBe("Bearer apk_test");
    const body = JSON.parse(String(init.body)) as { prompt: string; title: string; tags: string[]; repos: string[] };
    expect(body.repos).toEqual(["jaanavit/devin"]);
    expect(body.tags).toContain("sentry-issue:4504123456");
    expect(body.prompt).toContain("processRefund");
    expect(String(init.body)).not.toMatch(PII);
    const [row] = await auditRowsFor("SentryIssue", "4504123456");
    expect(row).toMatchObject({ action: "sentry_relay.session_created", actorId: "system:sentry-relay", metadata: { sessionId: "devin-abc", frames: 3 } });
  });

  it("is idempotent: a retried webhook for the same issue does not start a second session", async () => {
    await POST(webhook(EVENT_ALERT, "event_alert"));
    const again = await POST(webhook(EVENT_ALERT, "event_alert"));
    expect(again.status).toBe(200);
    expect((await again.json()).status).toBe("duplicate");
    expect(devinCalls()).toHaveLength(1);
  });

  it("stubs (and audits) when the Devin API is not configured", async () => {
    vi.stubEnv("DEVIN_API_KEY", "");
    vi.spyOn(console, "info").mockImplementation(() => {});
    const res = await POST(webhook(ISSUE_CREATED, "issue"));
    expect(res.status).toBe(201);
    expect((await res.json()).status).toBe("stubbed");
    expect(devinCalls()).toHaveLength(0);
    expect((await auditRowsFor("SentryIssue", "4504999999"))[0]?.action).toBe("sentry_relay.session_stubbed");
  });

  it("ignores unsupported resources and rejects invalid JSON", async () => {
    expect((await POST(webhook(`{"action":"resolved"}`, "issue"))).status).toBe(202);
    expect((await POST(webhook("{nope", "issue"))).status).toBe(400);
    expect(await prisma.auditLog.count()).toBe(0);
  });

  it("surfaces Devin API failures as 502 without auditing a session", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    fetchSpy.mockResolvedValueOnce(new Response("boom", { status: 500 }));
    expect((await POST(webhook(EVENT_ALERT, "event_alert"))).status).toBe(502);
    expect(await auditRowsFor("SentryIssue", "4504123456")).toHaveLength(0);
  });
});

describe("Sentry beforeSend scrubber", () => {
  it("drops request bodies, cookies and user details and redacts PII in messages and context", () => {
    const event = JSON.parse(EVENT_ALERT).data.event;
    const scrubbed = scrubEvent({ ...event, breadcrumbs: event.breadcrumbs.values });
    expect(scrubbed.user).toEqual({ id: "u_felix" });
    expect(scrubbed.request).toEqual({ url: "https://tools.example.com/refunds/ref_1" });
    expect(scrubbed.exception.values[0].value).not.toMatch(PII);
    // PII under a non-standard key name is still caught by the value pattern.
    expect(scrubbed.extra).toEqual({ customerSsn: "[REDACTED-SSN]" });
    expect(JSON.stringify(scrubbed)).not.toMatch(PII);
  });
});
