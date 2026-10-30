import { AccessDeniedError } from "./errors";

/** Static allowlist entries (exact host or "*.suffix"). Env-configured hosts are added at runtime. */
const STATIC_ALLOWED_HOSTS = ["hooks.slack.com", "*.sentry.io", "*.ingest.sentry.io", "api.devin.ai", "api.anthropic.com", "api.openai.com"];

function hostOf(url: string | undefined): string | undefined {
  if (!url) return undefined;
  try {
    return new URL(url).host;
  } catch {
    return undefined;
  }
}

/**
 * Hosts configured by env (payments-mock runs on a deployment-specific host). Slack is deliberately
 * NOT taken from `SLACK_WEBHOOK_URL`: webhooks always live on hooks.slack.com (static entry), so a
 * misconfigured or tampered webhook URL cannot redirect notifications to another host.
 */
export function allowedOutboundHosts(env: NodeJS.ProcessEnv = process.env): string[] {
  const fromEnv = [env.PAYMENTS_MOCK_URL, env.LLM_API_URL, env.DEVIN_API_URL].map(hostOf);
  return [...STATIC_ALLOWED_HOSTS, ...fromEnv.filter((h): h is string => Boolean(h))];
}

export function isAllowedOutbound(url: string, env: NodeJS.ProcessEnv = process.env): boolean {
  const host = hostOf(url);
  if (!host) return false;
  return allowedOutboundHosts(env).some((entry) =>
    entry.startsWith("*.") ? host.endsWith(entry.slice(1)) : host === entry,
  );
}

/** The only sanctioned way to make outbound HTTP calls from platform/app code (security rule 5). */
export async function outboundFetch(url: string, init?: RequestInit): Promise<Response> {
  if (!isAllowedOutbound(url)) throw new AccessDeniedError(`Outbound call blocked: host not in allowlist (${hostOf(url) ?? "invalid"})`);
  return fetch(url, { ...init, signal: init?.signal ?? AbortSignal.timeout(10_000) });
}
