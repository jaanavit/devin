# Fintech Internal-Tools Platform

A code-based replacement for the core of Power Apps: a shared internal-tools platform (SSO, RBAC, audit, approvals, PII masking, guardrails) plus the tools built on it.

See [`docs/CONVENTIONS.md`](docs/CONVENTIONS.md) for the security rules every change must follow (and the CI policy checks that enforce them), and [`SUMMARY.md`](SUMMARY.md) for build status.

- Building a tool: [`playbooks/new-tool.devin.md`](playbooks/new-tool.devin.md). Porting a Power Apps app: [`playbooks/port-app.devin.md`](playbooks/port-app.devin.md)
- Requesting a tool (non-engineers): [`docs/requesting-a-tool.md`](docs/requesting-a-tool.md)
- Sentry, the Sentry → Devin relay, weekly dependency upgrades: [`docs/maintenance.md`](docs/maintenance.md)

## Layout

```
packages/models          Prisma schema, migrations, shared types
packages/platform        auth, requireRole, audit, mask, approval, notify, jobs, shared UI
services/payments-mock   HTTP service: GET /transactions, POST /refunds
apps/internal-tools      Next.js app; one route group per tool under app/(tools)/
scripts/seed.ts          synthetic data
playbooks/               Devin playbooks
docs/                    conventions, ports, architecture notes
```

## Prerequisites

- Node 20 (`nvm use` reads `.nvmrc`)
- pnpm 10 via corepack: `corepack enable`
- Postgres 16, either:
  - **Docker:** `docker compose up -d` (creates `fintech_tools` and `fintech_tools_test`), or
  - **Homebrew:** `brew install postgresql@16 && brew services start postgresql@16`, then
    ```sh
    createuser -s postgres 2>/dev/null; psql -U postgres -c "ALTER USER postgres PASSWORD 'postgres';"
    createdb -U postgres fintech_tools && createdb -U postgres fintech_tools_test
    ```

## Local setup

```sh
cp .env.example .env          # then set NEXTAUTH_SECRET (openssl rand -base64 32)
pnpm install                  # also generates the Prisma client
pnpm db:deploy                # apply migrations (use `pnpm db:migrate` when changing the schema)
pnpm db:seed                  # synthetic data
pnpm dev                      # http://localhost:3000
pnpm dev:payments             # payments-mock on http://localhost:4100 (separate terminal)
```

To use a different app port, set `PORT` (and a matching `NEXTAUTH_URL`) in `.env`. The payments-mock port comes from `PAYMENTS_MOCK_PORT` in `.env`.

## Scheduled jobs

```sh
pnpm jobs:worker                     # scheduler: approval reminders every 15 min, nightly ops summary at 02:00 UTC
pnpm jobs:run nightly-ops-summary    # trigger a job once from the CLI
```

Admins can also trigger jobs and see their run history at `/jobs`. Slack posts go to `SLACK_WEBHOOK_URL`. If it's empty, each notification logs a one-line `slack stub:` instead.

## Logging in as each demo role

Open http://localhost:3000. You'll be redirected to `/login`, which lists the demo users from the mocked OIDC IdP (`MOCK_IDP_ENABLED=true`). Roles come from each user's IdP groups, mapped in `packages/platform/src/auth/mock-idp.ts`.

| User | IdP groups | Roles |
| --- | --- | --- |
| Alice Analyst | grp-compliance-analysts | Analyst |
| Aaron Support | grp-support-agents, grp-risk-analysts | Analyst |
| Rita Reviewer | grp-compliance-reviewers | Reviewer |
| Felix Finance | grp-finance-approvers | Reviewer |
| Ada Admin | grp-platform-admins | Admin |
| Sam Senior | grp-compliance-analysts, grp-compliance-reviewers | Analyst + Reviewer |

Use "Sign out / switch user" in the sidebar to change users. Sam holds both roles, so he's the user to test maker-checker with: he can prepare a request but can never approve his own.

From the command line, `scripts/smoke.sh u_ada /audit` signs in as a demo user and prints HTTP status codes.

## Scripts

| Command | What it does |
| --- | --- |
| `pnpm lint` | ESLint across the monorepo (zero warnings allowed) |
| `pnpm typecheck` | `tsc --noEmit` in every package |
| `pnpm test` | Vitest (unit + DB integration tests against `DATABASE_URL_TEST`) |
| `pnpm build` | Builds payments-mock and the Next.js app |
| `pnpm policy` | Security policy checks (audit on write, requireRole, no PII logging, outbound allowlist) |
| `pnpm db:check` | Migration check (needs `SHADOW_DATABASE_URL`, an empty disposable DB) |
| `pnpm bench:search` | Times the transaction searches on the current DB |

## Try every phase

A guided tour of what each phase built, on the seeded data. Run `pnpm db:seed` first: the IDs below are only in their starting state on a fresh seed, and the steps change data (re-seed to start over). Keep both `pnpm dev` and `pnpm dev:payments` running. Switch users with "Sign out / switch user" in the sidebar.

> New shells may default to an older Node. If `pnpm` is missing or installs fail, run `nvm use` in the repo first.

### Phase 0: scaffold
`pnpm lint && pnpm typecheck && pnpm test && pnpm build` should all pass. `pnpm test` needs `fintech_tools_test` (see Prerequisites).

### Phase 1: platform (SSO, roles, masking, audit)
1. Sign in as **Alice**. The catalog at `/` only shows the tools her role allows.
2. Open `/flags`: **403**. Everything is denied by default, at the edge and again inside every page and action.
3. Sign in as **Ada** (Admin). She sees Audit log, Feature flags and Scheduled jobs, but Admin does not include Reviewer, so she can't see unmasked PII.
4. At `/audit`, filter by action and click **Export CSV**. The export is itself audited.

### Phase 2: playbooks and parallel builds
- Read `playbooks/new-tool.devin.md` and `playbooks/port-app.devin.md`.
- `scripts/worktree-setup.sh <N> <branch>` (e.g. `scripts/worktree-setup.sh 3 phase-3-kyc`) creates a git worktree with its own databases and ports (`PORT`, `NEXTAUTH_URL`, `PAYMENTS_MOCK_PORT`, `PAYMENTS_MOCK_URL`). This is how Phases 3–5 were built in parallel.

### Phase 3: KYC review queue (masking + maker-checker)
1. As **Alice**, open `/kyc/kyc_0198`. SSN, DOB and address are masked. Click **Claim**, choose a recommendation, add notes and **Submit recommendation**.
2. As **Sam** (Analyst + Reviewer), open `/kyc/kyc_0107`, claim it and submit a recommendation. Reload: *"You prepared this case, so another Reviewer must make the final decision"*. Blocked on the server, not just hidden.
3. As **Rita**, open `/kyc/kyc_0198`. Full SSN visible (logged as `pii.view` in `/audit`). Enter a reason and **Record final decision**.

### Phase 4: refunds (thresholds, second approver, idempotent payouts)
1. As **Aaron**, open `/refunds/new?q=cus_010861`. Search results come from payments-mock.
2. **Select** `txn_0239807`, amount **499**, a reason, **Request refund** → **PROCESSED** immediately ($500 or less auto-approves).
3. **Select** `txn_0184641`, amount **501** → **PENDING APPROVAL**. Aaron can't approve his own refund.
4. As **Felix**, open the pending refund → **Approve and send to payments** → PROCESSED.
5. `curl localhost:4100/refunds/log` shows both payouts (49900 and 50100 cents), each sent once with an idempotency key. Refunds over $2,000 post to Slack (or log `slack stub:`) when requested.

### Phase 5: feature flags
1. As **Ada**, open Feature flags → **prod** → `instant-payouts`.
2. A prod change requires a reason: the form won't submit without one, and the server rejects it too.
3. Add a reason and turn it on. **Change history** shows before → after, and a prod change posts to Slack (or the stub).

### Phase 6: transaction investigation
1. As **Aaron**, open `/transactions?merchant=Amazon&minAmount=1000`. This searches all 500,000 transactions.
2. Open `/transactions/customers/cus_900001`: **Linked accounts** surfaces the seeded fraud ring (shared device, card or address), with a merged timeline of transactions, refunds and KYC events.
3. `pnpm bench:search` times the searches on your database.

### Phase 7: workflows
As **Ada**, open `/jobs` and click **Run now** on `nightly-ops-summary`: you get counts of KYC cases past SLA and refunds awaiting approval, recorded as a job run and audited. See [Scheduled jobs](#scheduled-jobs) for the worker and CLI.

### Phase 8: CI, environments and policy checks
- `pnpm policy` runs the four checks: audit on write, role check, no PII in logs, outbound allowlist. It should pass on this branch.
- **See it fail:** `git checkout ci-demo-policy-violation && pnpm policy` fails with `POLICY-1 audit-on-write`, naming the file and line. The same branch is open as PR #12 (do not merge), where GitHub CI fails it.
- **Migration check:** create an empty, disposable database and point `SHADOW_DATABASE_URL` at it:
  ```sh
  createdb -U postgres fintech_tools_shadow
  SHADOW_DATABASE_URL=postgresql://postgres:postgres@localhost:5432/fintech_tools_shadow pnpm db:check
  ```
- `.github/workflows/ci.yml` runs all of this on every PR, then deploys to preview, staging (merge to `main`) or prod (release tag). Deploys are placeholders in `scripts/deploy.sh` until hosting is chosen.

### Phase 9: automated maintenance
Start the app with a webhook secret, then send a signed sample Sentry alert:
```sh
SENTRY_WEBHOOK_SECRET=dev-secret pnpm dev                                                   # terminal 1
SENTRY_WEBHOOK_SECRET=dev-secret scripts/maintenance/send-sample-sentry-webhook.sh http://localhost:3000
```
Expect `HTTP 201` with `"status":"stubbed"` (a real Devin session once `DEVIN_API_KEY` / `DEVIN_ORG_ID` are set). A wrong secret returns 401. See [`docs/maintenance.md`](docs/maintenance.md) for the full setup and the weekly dependency workflow.

### Phase 10: self-service requests
Read [`docs/requesting-a-tool.md`](docs/requesting-a-tool.md) for the Slack request template and the short-lived backfill example. `scripts/docs/request-template.test.ts` (part of `pnpm test`) fails if the template and the `new-tool` playbook drift apart.
