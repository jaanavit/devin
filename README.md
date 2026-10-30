# Fintech Internal-Tools Platform

A code-based replacement for the core of Power Apps: a shared internal-tools platform (SSO, RBAC, audit, approvals, PII masking, guardrails) plus the tools built on it.

See [`docs/CONVENTIONS.md`](docs/CONVENTIONS.md) for the security rules every change must follow, and [`SUMMARY.md`](SUMMARY.md) for build status.

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
