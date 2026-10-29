# Automated maintenance

Three pieces keep the platform healthy with little manual effort:

| Piece | What it does | Where |
| --- | --- | --- |
| Sentry | Captures server, server-action and browser errors, scrubbed of PII | `apps/internal-tools/instrumentation*.ts`, `lib/sentry.ts` |
| Sentry → Devin relay | A new Sentry issue starts a Devin session that reproduces the bug, fixes it, adds a regression test and opens a PR | `app/api/webhooks/sentry/route.ts`, `lib/maintenance/sentry-relay.ts` |
| Weekly dependency upgrade | Every Monday, bumps dependencies (same major, ≥ 7 days old), runs the full CI suite, opens a PR | `.github/workflows/weekly-deps.yml`, `scripts/deps/weekly-update.ts` |

## 1. Sentry error reporting

1. Create a Sentry project (platform: Next.js) and copy its DSN.
2. Set `SENTRY_DSN` (server) and `NEXT_PUBLIC_SENTRY_DSN` (browser) to that DSN in each environment. Optionally set `SENTRY_ENVIRONMENT` (e.g. `staging`). With no DSN, Sentry is disabled.
3. Deploy. Errors from pages, route handlers and server actions are reported by `onRequestError`, and browser errors by `instrumentation-client.ts`.

What gets sent is limited on purpose (`lib/sentry.ts`, `scrubEvent`):
- `sendDefaultPii: false`. The user is reduced to their ID. Request bodies, cookies, headers and query strings are dropped.
- PII-named keys (`ssn`, `dob`, `address`, `documentNumber`) anywhere in `extra` / `contexts` / `tags` / exception data are redacted. SSN-shaped numbers and email addresses inside any string, including stack-frame local variables, are replaced.
- Breadcrumb messages and data are removed (only category/level/time remain), because they can echo names that no pattern can catch.
- Sentry is one of the five allowed outbound destinations (security rule 5). The SDK uses its own transport, so its host (`*.sentry.io`) is on the static allowlist.
- Source maps are not uploaded (that needs a Sentry auth token and `withSentryConfig`). Stack traces point at built files until that's added.

## 2. Sentry → Devin relay

### How it works

```
Sentry (new issue) ──webhook──▶ POST /api/webhooks/sentry ──Devin API v3──▶ Devin session ──▶ PR
```

1. Sentry calls the endpoint with `Sentry-Hook-Resource` and `Sentry-Hook-Signature` headers.
2. The relay verifies the signature (HMAC-SHA256 of the raw body with the integration's client secret, constant-time compare) and rejects anything else with 401.
3. It handles `issue` (action `created`) and `event_alert` (action `triggered`). An alert rule sends the full event, including the stack trace, so `event_alert` is the recommended setup. Everything else gets 202 and is ignored.
4. It extracts only the error type and message, culprit, level, up to 15 stack frames (crashing frame first) and the issue link. It never forwards user, request, tags, extra or breadcrumbs, and scrubs SSNs and emails from the remaining text.
5. If this Sentry issue was already relayed (an `sentry_relay.session_created` row exists in the audit log), it returns `duplicate`. Sentry retries never start a second session.
6. It calls `POST https://api.devin.ai/v3/organizations/{DEVIN_ORG_ID}/sessions` with a prompt telling Devin to reproduce the error, fix the root cause, add a regression test, run `pnpm lint && pnpm typecheck && pnpm policy && pnpm test && pnpm build`, and open a PR linking the issue. It's tagged `sentry-relay` and `sentry-issue:<id>`, scoped to `DEVIN_TARGET_REPO`.
7. It audits the result as `sentry_relay.session_created` (or `…session_stubbed` when the Devin API isn't configured), with actor `system:sentry-relay`, the session URL and the issue link.

The endpoint is public at the middleware level and authenticated by signature instead of a user session. That's a documented exception to POLICY-2 in `scripts/policy/exceptions.ts`.

### Configure it

1. **Devin:** in Devin, create a service user with the `UseDevinSessions` permission for your organization and create an API key for it. Note your organization ID (`org-…`). Make sure Devin has access to the repository.
2. **App environment:**
   ```
   DEVIN_API_KEY=apk_…            # service user key (secret)
   DEVIN_ORG_ID=org-…
   DEVIN_TARGET_REPO=jaanavit/devin
   SENTRY_WEBHOOK_SECRET=…        # filled in at step 3
   ```
3. **Sentry:** go to Settings → Developer Settings → Custom Integrations → **Create New Integration → Internal Integration**.
   - Webhook URL: `https://<your-app-host>/api/webhooks/sentry`
   - Permissions: Issue & Event = Read.
   - Webhooks: enable **issue**. Turn on **Alert Rule Action** too, so alert rules can send `event_alert` with stack traces.
   - Save, then copy the integration's **Client Secret** into `SENTRY_WEBHOOK_SECRET`.
4. **Alert rule (recommended):** in the project, go to Alerts → Create Alert → Issues. Set "A new issue is created" → action "Send a notification via <your integration>". This delivers `event_alert` payloads that include the stack trace.

### Test it

- **Unit tests** (no network, sample payloads in `apps/internal-tools/lib/maintenance/__fixtures__/`): `pnpm exec vitest run apps/internal-tools/app/api/webhooks`. They cover signature checks, parsing both payload types, prompt content with no PII, the v3 request shape, idempotency, the stub mode, error handling and the Sentry `beforeSend` scrubber.
- **Locally against a running app** (stub mode unless `DEVIN_API_KEY` / `DEVIN_ORG_ID` are set):
  ```sh
  SENTRY_WEBHOOK_SECRET=dev-secret pnpm dev        # terminal 1 (or put it in .env)
  SENTRY_WEBHOOK_SECRET=dev-secret scripts/maintenance/send-sample-sentry-webhook.sh http://localhost:3000
  ```
  Expect `HTTP 201` with `"status":"stubbed"` (or `"created"` and a session URL). Sending it again returns `"duplicate"` only after a real session was created. The audit log (`/audit`, entity type `SentryIssue`) shows the relay events.
- **End to end:** with everything configured, throw a test error in staging. In the Sentry project, "Send Test Notification" on the alert rule also works.

## 3. Weekly dependency upgrade

`.github/workflows/weekly-deps.yml` runs every Monday at 06:00 UTC. You can also run it from the Actions tab ("Run workflow").

1. `pnpm deps:update` bumps every exactly-pinned dependency to the newest release with the same major version that isn't a prerelease and was published at least 7 days ago. That's the same supply-chain rule as `minimumReleaseAge` in `pnpm-workspace.yaml`.
2. `pnpm install`, then the full suite: lint, typecheck, policy, test, build, migration check.
3. If everything passes and something changed, it opens a PR `chore(deps): weekly upgrades <date>`. The PR body lists the updates and any **major** upgrades available, which are never applied automatically and need a deliberate PR.

PRs opened with the default `GITHUB_TOKEN` don't trigger other workflows. The checks run inside the job before the PR is opened for that reason. To also run CI on the PR itself, add a `DEPS_PR_TOKEN` secret (fine-grained PAT, this repo only, Contents + Pull requests: read & write).

`.github/dependabot.yml` keeps the SHA-pinned GitHub Actions current (weekly, 7-day cooldown).

Run it locally: `pnpm deps:update` (edits the package.json files; review with `git diff`).
