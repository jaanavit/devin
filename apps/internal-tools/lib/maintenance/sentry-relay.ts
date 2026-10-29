// Sentry → Devin relay: turns a Sentry "new issue" webhook into a Devin session that reproduces
// the bug, fixes it, adds a regression test and opens a PR. Pure helpers here; the HTTP handler is
// app/api/webhooks/sentry/route.ts.
import { createHmac, timingSafeEqual } from "node:crypto";
import { scrubText } from "../sentry";

export const MAX_FRAMES = 15;

/** Verifies `Sentry-Hook-Signature`: hex HMAC-SHA256 of the raw body with the integration's client secret. */
export function verifySentrySignature(rawBody: string, signature: string | null, secret: string | undefined): boolean {
  if (!secret || !signature || !/^[a-f0-9]{64}$/i.test(signature)) return false;
  const expected = createHmac("sha256", secret).update(rawBody, "utf8").digest();
  const given = Buffer.from(signature, "hex");
  return given.length === expected.length && timingSafeEqual(given, expected);
}

export interface StackFrame {
  filename: string;
  function?: string;
  lineno?: number;
  colno?: number;
  inApp: boolean;
}

/** The subset of a Sentry issue we forward. Never includes user, request, tags, extra or breadcrumbs. */
export interface RelayIssue {
  issueId: string;
  shortId?: string;
  title: string;
  culprit?: string;
  errorType?: string;
  errorValue?: string;
  level?: string;
  project?: string;
  link?: string;
  frames: StackFrame[];
}

type Json = Record<string, unknown>;
const obj = (v: unknown): Json | undefined => (v && typeof v === "object" && !Array.isArray(v) ? (v as Json) : undefined);
const str = (v: unknown): string | undefined => (typeof v === "string" && v ? v : typeof v === "number" ? String(v) : undefined);
const num = (v: unknown): number | undefined => (typeof v === "number" && Number.isFinite(v) ? v : undefined);

function framesFrom(event: Json | undefined): { frames: StackFrame[]; errorType?: string; errorValue?: string } {
  const values = obj(event?.exception)?.values;
  if (!Array.isArray(values) || values.length === 0) return { frames: [] };
  // Sentry lists chained exceptions oldest-first; the last one is the error that was raised.
  const last = obj(values[values.length - 1]);
  const rawFrames = obj(last?.stacktrace)?.frames;
  const frames = (Array.isArray(rawFrames) ? rawFrames : [])
    .map(obj)
    .filter((f): f is Json => !!f)
    .map((f) => ({ filename: str(f.filename) ?? str(f.abs_path) ?? str(f.module) ?? "?", function: str(f.function), lineno: num(f.lineno), colno: num(f.colno), inApp: f.in_app === true }))
    .reverse() // Sentry frames are oldest-call-first; show the crashing frame first
    .slice(0, MAX_FRAMES);
  return { frames, errorType: str(last?.type), errorValue: str(last?.value) };
}

/**
 * Parses a Sentry integration webhook. Supports `issue` (action "created") and `event_alert`
 * (action "triggered", sent by an alert rule; includes the full event with its stack trace).
 * Returns undefined for resources/actions the relay doesn't act on.
 */
export function parseSentryWebhook(resource: string | null, payload: unknown): RelayIssue | undefined {
  const body = obj(payload);
  const data = obj(body?.data);
  if (resource === "issue" && body?.action === "created") {
    const issue = obj(data?.issue);
    const id = str(issue?.id);
    if (!issue || !id) return undefined;
    const meta = obj(issue.metadata);
    return {
      issueId: id,
      shortId: str(issue.shortId),
      title: str(issue.title) ?? "Unknown error",
      culprit: str(issue.culprit),
      errorType: str(meta?.type),
      errorValue: str(meta?.value),
      level: str(issue.level),
      project: str(obj(issue.project)?.slug),
      link: str(issue.web_url) ?? str(issue.permalink),
      frames: [],
    };
  }
  if (resource === "event_alert" && body?.action === "triggered") {
    const event = obj(data?.event);
    const id = str(event?.issue_id) ?? str(event?.groupID);
    if (!event || !id) return undefined;
    const { frames, errorType, errorValue } = framesFrom(event);
    return {
      issueId: id,
      title: str(event.title) ?? "Unknown error",
      culprit: str(event.culprit),
      errorType,
      errorValue,
      level: str(event.level),
      project: str(event.project) ?? str(obj(event.project)?.slug),
      link: str(event.issue_url)?.replace("/api/0/issues/", "/issues/") ?? str(event.web_url),
      frames,
    };
  }
  return undefined;
}

export function formatFrame(f: StackFrame): string {
  const loc = [f.filename, f.lineno, f.colno].filter((x) => x !== undefined).join(":");
  return `${f.inApp ? "  " : "  (lib) "}at ${f.function ?? "<anonymous>"} (${loc})`;
}

/** The instructions given to Devin. All free text from Sentry passes through scrubText(). */
export function buildDevinPrompt(issue: RelayIssue, repo: string): string {
  const error = [issue.errorType, issue.errorValue].filter(Boolean).join(": ");
  const stack = issue.frames.length
    ? issue.frames.map(formatFrame).join("\n")
    : "(not included in this webhook; open the Sentry issue link to see the full stack trace)";
  return [
    `A new production error was reported by Sentry for ${repo}. Please fix it.`,
    "",
    `Sentry issue: ${issue.link ?? `id ${issue.issueId}`}${issue.shortId ? ` (${issue.shortId})` : ""}`,
    `Title: ${scrubText(issue.title)}`,
    issue.culprit ? `Culprit: ${scrubText(issue.culprit)}` : undefined,
    error ? `Error: ${scrubText(error)}` : undefined,
    issue.level ? `Level: ${issue.level}` : undefined,
    "",
    "Stack trace (most recent call first):",
    scrubText(stack),
    "",
    "Instructions:",
    `1. Clone ${repo}, read AGENTS.md / docs/CONVENTIONS.md and the relevant playbook in playbooks/.`,
    "2. Reproduce the error locally (Postgres + `pnpm db:deploy && pnpm db:seed`), ideally as a failing test.",
    "3. Fix the root cause, not the symptom. Follow the security rules (requireRole, audit, mask, no PII in logs).",
    "4. Add a regression test that fails before the fix and passes after it.",
    "5. Run `pnpm lint && pnpm typecheck && pnpm policy && pnpm test && pnpm build` until all pass.",
    `6. Open a PR titled \`fix: ${scrubText(issue.title).slice(0, 80)}\` that links the Sentry issue and explains the root cause and the fix.`,
    "Do not include customer data from Sentry or the database in the PR, commits or logs.",
  ]
    .filter((l) => l !== undefined)
    .join("\n");
}
