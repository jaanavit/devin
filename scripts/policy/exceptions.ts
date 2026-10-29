// Approved exceptions to the policy checks. Every entry needs a justification; adding one must be
// called out in the PR description (docs/CONVENTIONS.md rule 6).

export interface PolicyException {
  rule: 1 | 2 | 3 | 4;
  /** Repo-relative path. */
  file: string;
  justification: string;
}

export const EXCEPTIONS: readonly PolicyException[] = [
  {
    rule: 2,
    file: "apps/internal-tools/app/api/auth/[...nextauth]/route.ts",
    justification: "Auth.js sign-in/callback endpoints: the login exception in security rule 2.",
  },
  {
    rule: 2,
    file: "apps/internal-tools/app/login/page.tsx",
    justification: "The login page itself (security rule 2: no route is public except login).",
  },
  {
    rule: 2,
    file: "apps/internal-tools/app/api/webhooks/sentry/route.ts",
    justification: "Machine-to-machine Sentry webhook: authenticated by HMAC signature (SENTRY_WEBHOOK_SECRET), not a user session. Audits every relayed issue.",
  },
  {
    rule: 2,
    file: "apps/internal-tools/app/403/page.tsx",
    justification: "Static 'access denied' page used as the middleware's 403 rewrite target; renders no data.",
  },
];

export function isExcepted(rule: PolicyException["rule"], file: string): boolean {
  return EXCEPTIONS.some((e) => e.rule === rule && e.file === file);
}
