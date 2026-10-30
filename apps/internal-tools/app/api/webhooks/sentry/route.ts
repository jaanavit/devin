// Sentry → Devin relay endpoint. Machine-to-machine: authenticated by Sentry's HMAC signature
// (SENTRY_WEBHOOK_SECRET) instead of a user session, so it is a documented exception to
// POLICY-2 (scripts/policy/exceptions.ts). Every relayed issue is audited; the audit log also
// serves as the dedupe ledger so retries never start a second session for the same issue.
import { prisma } from "@fintech/models";
import { audit, createDevinSession, route } from "@fintech/platform/server";
import type { NextRequest } from "next/server";
import { buildDevinPrompt, parseSentryWebhook, verifySentrySignature } from "@/lib/maintenance/sentry-relay";

export const dynamic = "force-dynamic";

const RELAY_ACTOR = { id: "system:sentry-relay", email: "sentry-relay@system" } as const;
const MAX_BODY_BYTES = 512 * 1024;

export const POST = route(async (req: NextRequest) => {
  const raw = await req.text();
  if (raw.length > MAX_BODY_BYTES) return Response.json({ error: "payload_too_large" }, { status: 413 });
  if (!verifySentrySignature(raw, req.headers.get("sentry-hook-signature"), process.env.SENTRY_WEBHOOK_SECRET)) {
    return Response.json({ error: "invalid_signature" }, { status: 401 });
  }
  let payload: unknown;
  try {
    payload = JSON.parse(raw);
  } catch {
    return Response.json({ error: "invalid_json" }, { status: 400 });
  }
  const issue = parseSentryWebhook(req.headers.get("sentry-hook-resource"), payload);
  if (!issue) return Response.json({ status: "ignored" }, { status: 202 });

  const already = await prisma.auditLog.findFirst({ where: { action: "sentry_relay.session_created", entityType: "SentryIssue", entityId: issue.issueId } });
  if (already) return Response.json({ status: "duplicate", issueId: issue.issueId }, { status: 200 });

  const repo = process.env.DEVIN_TARGET_REPO ?? "jaanavit/devin";
  const result = await createDevinSession({
    prompt: buildDevinPrompt(issue, repo),
    title: `Fix Sentry issue ${issue.shortId ?? issue.issueId}: ${issue.title}`.slice(0, 120),
    tags: ["sentry-relay", `sentry-issue:${issue.issueId}`],
    repos: [repo],
  });
  if (result.stubbed) console.info(`devin stub: would start a session for Sentry issue ${issue.issueId} (${result.reason})`);
  await audit(RELAY_ACTOR, {
    action: result.stubbed ? "sentry_relay.session_stubbed" : "sentry_relay.session_created",
    entityType: "SentryIssue",
    entityId: issue.issueId,
    metadata: { link: issue.link, frames: issue.frames.length, ...(result.stubbed ? { reason: result.reason } : { sessionId: result.sessionId, sessionUrl: result.url }) },
  });
  return Response.json(result.stubbed ? { status: "stubbed", issueId: issue.issueId } : { status: "created", issueId: issue.issueId, sessionUrl: result.url }, { status: 201 });
});
