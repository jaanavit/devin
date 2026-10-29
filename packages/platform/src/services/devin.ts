import { PlatformError } from "../errors";
import { outboundFetch } from "../outbound";

export interface DevinSessionRequest {
  prompt: string;
  title?: string;
  tags?: string[];
  repos?: string[];
}

export type DevinSessionResult = { stubbed: false; sessionId: string; url: string } | { stubbed: true; reason: string };

export class DevinApiError extends PlatformError {
  constructor(message: string) {
    super(message, 502, "devin_api_error");
  }
}

/**
 * Creates a Devin session via the Devin API v3 (`POST /v3/organizations/{org_id}/sessions`,
 * service-user token with the UseDevinSessions permission). Stubbed (no network call) when
 * DEVIN_API_KEY or DEVIN_ORG_ID is not configured.
 */
export async function createDevinSession(req: DevinSessionRequest, env: NodeJS.ProcessEnv = process.env): Promise<DevinSessionResult> {
  const key = env.DEVIN_API_KEY;
  const org = env.DEVIN_ORG_ID;
  if (!key || !org) return { stubbed: true, reason: "DEVIN_API_KEY or DEVIN_ORG_ID not set" };
  const base = env.DEVIN_API_URL ?? "https://api.devin.ai";
  const res = await outboundFetch(`${base}/v3/organizations/${encodeURIComponent(org)}/sessions`, {
    method: "POST",
    headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
    body: JSON.stringify({ prompt: req.prompt, title: req.title, tags: req.tags, repos: req.repos }),
  });
  if (!res.ok) throw new DevinApiError(`Devin API responded ${res.status}`);
  const body = (await res.json()) as { session_id?: string; url?: string };
  if (!body.session_id || !body.url) throw new DevinApiError("Devin API response missing session_id/url");
  return { stubbed: false, sessionId: body.session_id, url: body.url };
}
