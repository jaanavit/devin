# Build Summary

Running log of what was built per phase, deviations, security exceptions, stubs, and gaps.

## Open blockers / questions

- **No GitHub remote / `gh` auth.** The `gh` token on the build machine is invalid and no remote is configured, so PRs cannot be opened yet. Each phase is committed on its own stacked local branch (`phase-0-setup` → `phase-1-platform` → …). PR descriptions are recorded below so they can be opened as-is once a remote exists (`gh auth login`, `git remote add origin …`, `git push -u origin --all`).

## Phase 0 — Repo setup

**Branch:** `phase-0-setup` (PR: _pending remote_)

Built:
- pnpm workspace monorepo with the spec layout (`packages/models`, `packages/platform`, `services/payments-mock`, `apps/internal-tools`, `scripts/`, `playbooks/`, `docs/`).
- Root `pnpm lint | typecheck | test | build` scripts; shared strict `tsconfig.base.json`; ESLint 10 flat config (typescript-eslint + Next plugin); Vitest.
- Prisma schema with an initial `User` model and migration; Next.js 15 App Router app with Tailwind v4.
- `docs/CONVENTIONS.md` (security rules + stack conventions), `README.md` (Docker or Homebrew Postgres), `.env.example`, `docker-compose.yml`.

Decisions / deviations:
- **Postgres via Homebrew** on the build machine (Docker not installed). `docker-compose.yml` is still provided and documented; app code is identical either way (only `DATABASE_URL` differs).
- **Pinned versions, supply-chain guard.** All direct deps pinned exactly; `minimumReleaseAge: 10080` (7 days) in `pnpm-workspace.yaml` so transitive deps never resolve to brand-new releases (a dependency published minutes earlier 404'd during install, which prompted this). Requires pnpm ≥ 10.16 (pinned to 10.34.7 via `packageManager`).
- **Stable majors over bleeding edge:** Next 15.5 (patched), React 19.1, Prisma 6.19, TypeScript 5.9, Vitest 3.2. Newer majors (Next 16, Prisma 7/8, TS 7) exist but are recent and change configuration significantly; upgrading is a follow-up for the weekly dependency PR (Phase 9).
- Workspace packages are consumed as TypeScript source (Next `transpilePackages`), so there is no separate build step for `models`/`platform`.
- ESLint runs once at the root; `next build` skips its own lint pass to avoid a duplicate, divergent config.
- Verified on a fresh database: `pnpm db:deploy` applies cleanly, and all four scripts pass.
- **Side effects of installing Postgres with Homebrew on the build machine (macOS 12, which Homebrew no longer ships prebuilt packages for, so everything was built from source):** `postgresql@16` pulled in `openssl@4`, and Homebrew **unlinked `openssl@3`** (its 6,504 symlinks under `/opt/homebrew` were removed; the keg is still installed). Anything on that machine that relied on Homebrew's `openssl` binary or headers being 3.x now resolves to 4.x; `brew link --overwrite openssl@3` reverts it. Homebrew also upgraded cmake, readline, xz, gettext, pkgconf and ca-certificates, ran its automatic cleanup, and autoremoved an unused `googletest`. None of this affects the repo.

## Phase 1 — Platform

**Branch:** `phase-1-platform` (PR: _pending remote_)

Built:
- **Models** (`packages/models`): User, AuditLog, ApprovalRequest, Customer, Transaction, KycCase, KycDocument, Refund, FeatureFlag, plus enums. `@fintech/models/shared` holds pure types (`Role`, `SessionUser`, `PII_FIELDS`) that are safe for edge and client code, with a compile-time check that they stay in sync with Prisma. `@fintech/models/payments` is the payments-mock wire contract.
- **Auth** (`platform/auth`): Auth.js with a `mock-oidc` provider. The IdP directory has 6 demo users, and `GROUP_ROLE_MAP` maps IdP groups to Analyst/Reviewer/Admin. Users are upserted on sign-in, sign-in is audited, and the login page has a user switcher.
- **`requireRole(roles)`** for server actions and route handlers throws 401/403. **`requirePageRole(roles)`** does the same for pages: it redirects anonymous users to `/login` and renders `app/forbidden.tsx` with HTTP 403 via Next `forbidden()`. **Middleware** denies by default as a second layer: only `/login` and `/api/auth/*` are public, and catalog roles are enforced per path prefix with a real 403.
- **`audit(actor, entry, tx?)`** writes to an append-only `AuditLog` (actor, action, entity type/id, before/after, metadata, timestamp). PII keys are redacted before they're stored. Postgres triggers block UPDATE, DELETE and TRUNCATE. The only exception is a test-only escape hatch for TRUNCATE.
- **Audit viewer** (`/audit`, Admin only) filters by actor, entity, action and date range, with server-side pagination and sorting. **CSV export** (`/audit/export`) is itself audited (`audit_log.export`) and guards against spreadsheet formula injection.
- **`mask(record, viewer)`** masks `ssn`, `dob`, `address` and `documentNumber` unless the viewer has the Reviewer role. **`maskForViewer()`** also audits `pii.view`, recording field names only. **`redactPii()`** handles payloads.
- **Approval primitive:** `createApprovalRequest` auto-approves at or below `autoApproveMaxCents`. `approveRequest` and `rejectRequest` enforce approver ≠ requester, the approver's role, a required reject reason, and a single decision (a conditional update guards against races). Every step is audited.
- **Shared UI** (`@fintech/platform/ui`): `DataTable` (server-side pagination, sort, filter), `FilterBar`, `Form` (server action + `ActionResult`), `Queue` (claim/unclaim), `DetailView`, `AppShell` with role-aware nav, and shadcn-style primitives.
- **App catalog** (`/`): every tool's name, owner, allowed roles and description, registered in `apps/internal-tools/lib/catalog.ts`.
- **Other helpers:** `outboundFetch()` with a runtime host allowlist; `route()`/`runAction()` turn errors into responses without logging PII; `paymentsClient()`.
- **payments-mock:** `GET /transactions` (search by txn ID, customer ID or name prefix; paginated, page size capped at 100) and `POST /refunds` (validated, idempotent on `refundId`, every call logged to stdout and `logs/refunds.jsonl`). `GET /refunds/log` returns the log. Every endpoint except `/health` requires a bearer token.
- **Seed** (deterministic, ~32s): 25,008 customers, 500,000 transactions (with device ID, card fingerprint and address hash), a fraud ring of 8 linked accounts (`cus_900001`–`cus_900008`), 200 KYC cases (`kyc_0042` has a document DOB 2 years off from the customer record), 1,000 refunds with approval records, and 12 flags × 3 environments.

Verification:
- 58 tests pass: requireRole, append-only audit enforced by the database, self-approval rejection, thresholds, reject reason, double decisions, masking and PII-view audit, and middleware RBAC for all 6 demo users.
- End-to-end over HTTP with real Auth.js sign-in: anonymous `/` → 307 to `/login`. All 6 users get 200 on `/`. Only Ada (Admin) gets 200 on `/audit` and `/audit/export`; everyone else gets 403. Sign-ins and the export appear in the audit log.

Decisions / deviations:
- **Auth.js v4 (`next-auth@4.24.15`)** rather than v5, which is still beta. The mock IdP is a Credentials provider that issues OIDC-style claims (sub, email, name, groups). Moving to real OIDC means replacing the provider and keeping `rolesForGroups`.
- **Admin does not imply Reviewer** (least privilege): Admins see masked PII and can't approve money decisions unless they also hold Reviewer.
- **Roles are carried in the session JWT** (8h) and come from IdP groups at sign-in. Role changes take effect at the next sign-in.
- **Tests run against a real Postgres** (`DATABASE_URL_TEST`, whose name must end in `_test`). Files run sequentially, and `runAsUser()` impersonates a user only when `NODE_ENV=test`.
- **PII is stored in plaintext** in the prototype database. Column-level encryption or tokenization is a follow-up.
- **The payments-mock ledger reads the product database** (via `@fintech/models`) instead of keeping its own store, which keeps the seed in one place.

Security rule exceptions:
- `app/api/auth/[...nextauth]` is public by design (the login exception in rule 2).
- `/403` is reachable by any signed-in user; it's the middleware's rewrite target and has no data.

Stubs / needed to make real:
- Real OIDC IdP (client ID/secret, issuer) to replace `mock-oidc`.

## Phase 2 — Playbooks

**Branch:** `phase-2-playbooks` (PR: _pending remote_)

Built:
- `playbooks/new-tool.devin.md`: the step-by-step procedure for building a tool, using the real Phase 1 names and paths (`requirePageRole`, `requireRole`, `runAction`, `audit(..., tx)`, `maskForViewer`, `createApprovalRequest`/`approveRequest`/`rejectRequest`, `outboundFetch`, the `lib/catalog.ts` registration, and the `@fintech/platform/testing` helpers). It includes copy-paste patterns for pages, actions and route handlers, the PR template, and the `tool: <name>` title.
- `playbooks/port-app.devin.md`: the Power Apps migration procedure. It covers the inventory (screens, writing controls, data sources, connectors, Power Fx logic, flows), data and role mapping, the screen-to-route mapping table, translating Power Fx into tested `_lib/` functions, replacing flows and connectors, and the `parity.md` format. PR title: `port: <app>`.
- Test setup: `next/cache` is mocked globally (`scripts/test/setup.ts`) so server actions that call `revalidatePath()` can be tested directly.
- `scripts/worktree-setup.sh <N> <branch>` creates a parallel-phase worktree at `~/fit-pN`. It gets its own `fintech_pN_dev`/`fintech_pN_test` databases and a `.env` with `PORT=300N`, `NEXTAUTH_URL` on :300N and payments-mock on :410N (`PAYMENTS_MOCK_PORT` and `PAYMENTS_MOCK_URL`). The script then installs, migrates and seeds with 50K transactions.
- The app's `dev`/`start` scripts now read `PORT` from `.env`, so each worktree runs on its own port with plain `pnpm dev`.

Decisions:
- **Phases 3, 4 and 5 are built in parallel** in separate git worktrees (`~/fit-p3`, `~/fit-p4`, `~/fit-p5`), each branched from `phase-2-playbooks` with its own databases and ports. This deviates from strictly stacked PRs: 3, 4 and 5 are siblings, and each one's PR targets `phase-2-playbooks`. Expect small merge conflicts in `schema.prisma`, `lib/catalog.ts`, `scripts/seed*` and this file when they're combined before Phase 6.

## Phase 5 — Feature-flag admin

**Branch:** `phase-5-flags` (PR: _pending remote_; title `tool: feature-flags`, targets `phase-2-playbooks`)

Built (following `playbooks/new-tool.devin.md`):
- **`/flags`** (Admin only): `DataTable` of every flag × environment with environment tabs (All / dev / staging / prod), a `FilterBar` (environment, key prefix), server-side pagination and sort by key. Shows status, rollout %, description and last update.
- **`/flags/[id]`**: `DetailView` of the current state, a **Turn on/off** form and a **Set rollout** form (0–100, whole numbers), and the flag's change history (last 20 audit rows, with a link into the audit viewer). Prod flags show a warning and the reason field is `required`.
- **Server actions** (`flags/actions.ts`): `toggleFlag` and `setRollout`. Each one calls `requireRole(["Admin"])` first, re-loads the flag, validates the reason for the flag's environment, applies the change with a compare-and-set `updateMany` on the current `enabled`/`rolloutPercentage` (a concurrent edit returns `conflict`), sets `updatedById`, and writes the audit row in the same transaction.
- **Audit:** `feature_flag.toggle` and `feature_flag.set_rollout` on `FeatureFlag:<id>`, with `before`/`after` = `{ key, environment, enabled, rolloutPercentage }` and `metadata` = `{ environment, key, reason }`.
- **Prod rules:** a non-blank reason (≤ 500 chars) is required server-side for any prod change; outside prod it's optional and still recorded. After the transaction commits, prod changes post to Slack via `outboundFetch(process.env.SLACK_WEBHOOK_URL, …)` (`flags/_lib/slack.ts`). The message carries the flag key, environment, before → after, the actor's work email and the reason.
- **Catalog:** `flags` registered in `lib/catalog.ts` with `FLAGS_ROLES = ["Admin"]`, so middleware returns 403 to everyone else and `middleware.test.ts` covers it for all 6 demo users.
- **Tests:** 32 new ones. `flags.test.ts` (DB) covers RBAC on both pages and both actions (anonymous, Analyst, Reviewer, and Analyst+Reviewer `sam` all denied; nothing changed or audited), before/after audit rows, prod reason required (no change, no audit, no Slack), the Slack stub with no actor email or reason in the log line, a real webhook POST when `SLACK_WEBHOOK_URL` is set (fetch mocked), Slack failure not rolling back the change, no-op/invalid input and unknown flags. `_lib/rules.test.ts` holds the unit tests for reason, rollout and enabled parsing and for the Slack text.

Verification:
- `pnpm lint`, `pnpm typecheck`, `pnpm test` (90 tests) and `pnpm build` all pass.
- Over HTTP on :3005 with `scripts/smoke.sh`, Ada gets 200 on `/flags`, `/flags?environment=prod` and `/flags/<prod id>`, while Alice, Rita and Sam get 403 on all three.

Decisions / deviations:
- **No schema change or migration.** The Phase 1 `FeatureFlag` model already had everything needed. The prod reason lives in the audit row's `metadata` rather than a column, because the audit log is the system of record for change history. List filters use the existing `@@index([environment])` and the `@@unique([key, environment])` index (key prefix and sort), so sorting is restricted to `key`.
- **Two actions instead of one generic "update":** toggling and changing rollout are separate audited verbs, which keeps the audit log and Slack messages unambiguous. Submitting the current value is rejected (`conflict` / `no_change`) so no empty audit rows are written.
- **Rollout is independent of on/off.** Turning a flag off keeps its percentage, and the effective exposure is `enabled ? rolloutPercentage : 0`. The UI says the percentage only applies while the flag is on.
- **Slack runs after commit and is best-effort.** A Slack outage never blocks or rolls back a flag change. Failures are logged with only the flag key and the HTTP status or error class. When `SLACK_WEBHOOK_URL` is empty the change is logged as `console.info("slack stub: <action> on prod flag <key> …")`, with no actor or reason. Phase 7 will replace `_lib/slack.ts` with `notify()`.
- **Fixed the global `next/cache` test mock** (`scripts/test/setup.ts`). `next` can't be resolved from the repo root, so `vi.mock("next/cache")` never matched the module the app imports, and any server action calling `revalidatePath()` failed under test with "static generation store missing". Phases 1–2 never exercised a server action, so nobody noticed. The setup now mocks the path that `apps/internal-tools` actually resolves to. Phases 3 and 4 will need the same fix, or will conflict with it on merge.

Security rule exceptions:
- None. Free-text reasons go to Slack by design: they're the justification reviewers need. Admins should keep customer data out of reasons. Slack messages include the acting Admin's work email (staff identity, not customer PII).

Platform changes:
- None. `packages/platform` is untouched.

Stubs / needed to make real:
- `SLACK_WEBHOOK_URL`: unset here, so prod changes are logged by the console stub. Set it to an `https://hooks.slack.com/…` incoming-webhook URL (the host is already allowlisted).

Known gaps / next steps:
- No create/delete/archive of flags and no per-segment targeting. The spec only asks for toggle and rollout.
- No maker-checker on prod flag changes (the spec only asks for a reason). Routing prod changes through the `approval` primitive would be easy to add if the client wants it.
- Prod changes have not been posted to a real Slack workspace yet, because no webhook URL is available. The tests confirm the POST with a mocked fetch.
