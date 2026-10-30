# Conventions

These rules apply to every change in this repository. CI enforces the ones marked **(CI)**.

## Security rules (non-negotiable)

1. **Every mutation is audited.** Every server action or API route that writes data calls `audit()` from `@fintech/platform`. Viewing PII is also audited. **(CI)**
2. **Deny by default.** Every route and server action declares required roles with `requireRole()`. No route is public except login. **(CI)**
3. **PII is masked by role.** Fields `ssn`, `dob`, `address`, and `documentNumber` pass through `mask()` unless the user has the Reviewer role. Never log PII. **(CI: logging check)**
4. **Maker-checker on money and risk decisions.** Use the `approval` primitive. The approver can never be the requester. Refunds over $500 require a second approver.
5. **Outbound allowlist.** Network calls only to `services/payments-mock`, the Slack webhook, Sentry, the Devin API, and the LLM API. Anything else must be justified in the PR description. **(CI)**
6. **Definition of done for every PR:** lint, typecheck, tests, and build pass; every new route has at least one RBAC test and one audit test; the PR description lists screens built, roles, and any rule exceptions.

## Stack

- Next.js (App Router) + TypeScript `strict`, Prisma + Postgres, Auth.js, Tailwind + shadcn/ui-style components, Vitest, pnpm workspaces, GitHub Actions.
- Node 20 (see `.nvmrc`), pnpm 9 (via `corepack`).

## Repository layout

| Path | Purpose |
| --- | --- |
| `packages/models` | Prisma schema, migrations, and shared types. |
| `packages/platform` | auth, `requireRole`, `audit`, `mask`, `approval`, `notify`, jobs, shared UI. |
| `services/payments-mock` | HTTP service: `GET /transactions`, `POST /refunds`. |
| `apps/internal-tools` | Next.js app; one route group per tool under `app/(tools)/`. |
| `scripts/seed.ts` | Synthetic data. |
| `playbooks/` | Devin playbooks for building and porting tools. |
| `docs/` | Conventions, ports, architecture notes. |

## CI and policy checks

Every PR runs `.github/workflows/ci.yml`:

| Job | What it checks |
| --- | --- |
| Policy checks | `pnpm policy` (`scripts/policy/check.ts`) |
| Lint, typecheck, test, build | `pnpm lint`, `pnpm typecheck`, `pnpm test` (against a Postgres service), `pnpm build` |
| Prisma migration check | `pnpm db:check`: migrations apply to an empty DB and match `schema.prisma` exactly |
| Deploy | Preview per PR, staging on merge to `main`, production on a `v*` tag, all only after the checks pass (`scripts/deploy.sh`, stubbed until a host is configured) |

The policy checks fail the build with a message naming the rule:

| Code | Rule | Fails when |
| --- | --- | --- |
| POLICY-1 `audit-on-write` | Rule 1 | A server action, route handler or page performs a Prisma write (`create`/`update`/`upsert`/`delete`/`…Many`/`$executeRaw`), directly or via a helper it calls in a local module, and no `audit()` call (or audited platform helper such as `approveRequest`) is reachable. |
| POLICY-2 `require-role` | Rule 2 | A server action or route handler doesn't call `requireRole()`, or a page doesn't call `requirePageRole()`. |
| POLICY-3 `no-pii-logging` | Rule 3 | A `console.*` call references `ssn`, `dob`, `documentNumber` or `address`. |
| POLICY-4 `outbound-allowlist` | Rule 5 | Code calls `fetch()` directly (only `packages/platform/src/outbound.ts` may), calls `outboundFetch()` with a literal non-allowlisted host, or imports another HTTP client (axios, got, …). |

Run `pnpm policy` locally before pushing. Exceptions live in `scripts/policy/exceptions.ts`, each with a written justification, and must be called out in the PR description.

Known limits: the checks are static and name-based. POLICY-1 checks that an audit is *reachable* from each entry point, not that every write is paired with its own audit. POLICY-3 can't see PII hidden inside a whole object (`console.log(customer)`). Code review still applies.

## Code rules

- **Shared types live only in `packages/models`.** Never redefine a model type (or a hand-written copy of one) in an app or service. Import from `@fintech/models`.
- **Schema changes only in `packages/models`**, always with a Prisma migration (`pnpm db:migrate`).
- Cross-cutting behaviour (auth, audit, masking, approvals, notifications, jobs, shared UI) lives in `packages/platform`. Tools compose platform helpers; they do not reimplement them.
- Server-only code (DB access, secrets) must never be imported into client components.
- Do not log request bodies or records that may contain PII. Log IDs instead.
- Every PR must keep `pnpm lint`, `pnpm typecheck`, `pnpm test`, and `pnpm build` green.
