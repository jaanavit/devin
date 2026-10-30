// Shared Sentry options for server and browser. Sentry is enabled only when a DSN is configured.
// Events are scrubbed before they leave the app: no request bodies, cookies, headers, user details
// beyond an ID, and PII-named keys anywhere in extra/contexts/tags are redacted.
import { redactPii } from "@fintech/platform";

const SSN = /\b\d{3}-\d{2}-\d{4}\b/g;
const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;

/** Redacts SSN-shaped numbers and email addresses inside free text (error messages, breadcrumbs). */
export function scrubText(text: string): string {
  return text.replace(SSN, "[REDACTED-SSN]").replace(EMAIL, "[REDACTED-EMAIL]");
}

/** Redacts PII-named keys, then SSN/email patterns inside every remaining string value. */
export function deepScrub(value: unknown): unknown {
  const walk = (v: unknown): unknown => {
    if (typeof v === "string") return scrubText(v);
    if (Array.isArray(v)) return v.map(walk);
    if (v && typeof v === "object") return Object.fromEntries(Object.entries(v as Record<string, unknown>).map(([k, x]) => [k, walk(x)]));
    return v;
  };
  return walk(redactPii(value));
}

interface ScrubbableEvent {
  message?: string;
  user?: { id?: string | number; [k: string]: unknown };
  request?: { data?: unknown; cookies?: unknown; headers?: unknown; query_string?: unknown; [k: string]: unknown };
  extra?: Record<string, unknown>;
  contexts?: Record<string, unknown>;
  tags?: Record<string, unknown>;
  breadcrumbs?: { message?: string; data?: unknown; [k: string]: unknown }[];
  exception?: { values?: { value?: string; [k: string]: unknown }[] };
}

/** `beforeSend` for Sentry: strips or redacts anything that could carry PII. */
export function scrubEvent<E extends ScrubbableEvent>(event: E): E {
  if (event.message) event.message = scrubText(event.message);
  if (event.user) event.user = event.user.id !== undefined ? { id: event.user.id } : {};
  if (event.request) {
    delete event.request.data;
    delete event.request.cookies;
    delete event.request.headers;
    delete event.request.query_string;
  }
  for (const key of ["extra", "contexts", "tags"] as const) {
    if (event[key]) event[key] = deepScrub(event[key]) as Record<string, unknown>;
  }
  // Breadcrumb text can echo anything that was logged or fetched (including names, which no
  // pattern can catch), so keep only category/level/timestamp.
  for (const b of event.breadcrumbs ?? []) {
    delete b.message;
    delete b.data;
  }
  // Covers exception messages and stack-frame local variables (`vars`).
  if (event.exception) event.exception = deepScrub(event.exception) as ScrubbableEvent["exception"];
  return event;
}

export function sentryOptions(dsn: string | undefined) {
  return {
    dsn,
    enabled: Boolean(dsn),
    environment: process.env.SENTRY_ENVIRONMENT ?? process.env.NODE_ENV,
    sendDefaultPii: false,
    tracesSampleRate: 0.1,
    beforeSend: <E extends object>(event: E): E => scrubEvent(event as ScrubbableEvent) as E,
  };
}
