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

## Phase 3 — KYC review queue

**Branch:** `phase-3-kyc` (from `phase-2-playbooks`; PR `tool: kyc-review-queue`: _pending remote_)

Built (following `playbooks/new-tool.devin.md`):
- **Catalog entry** `kyc` → `/kyc`, owner Compliance, roles `KYC_ROLES = [Analyst, Reviewer]` (`lib/catalog.ts`). `KYC_PREPARER_ROLES = [Analyst]` and `KYC_DECIDER_ROLES = [Reviewer]` gate the actions. Admins get 403 from both the middleware and `requirePageRole`.
- **`/kyc` list:** `DataTable` + `FilterBar` with filters for status, risk level and assignee (me / unassigned / a specific Analyst), plus server-side pagination and sorting. It shows SLA age and an SLA due/overdue badge, and defaults to sorting by SLA due date, soonest first. No PII is loaded on the list.
- **`/kyc/[id]` detail:** customer info (SSN, DOB, address and document number go through `maskForViewer`), case info, documents list, the Analyst recommendation, the Reviewer decision, and history (the case's mutation audit rows). The page also has the Queue claim/unclaim control, the recommendation form (only for the assignee) and the final-decision form (only for a Reviewer who did not prepare the case). The preparer sees "You prepared this case, so another Reviewer must make the final decision" instead of the form. The document `fixture` JSON, which holds the printed DOB and document number, is never selected.
- **Server actions** (`actions.ts`): `claimCase`, `unclaimCase`, `recommendCase` (outcome + required notes), `decideCase` (outcome + required reason). Each one calls `requireRole` first inside `runAction`, re-loads the case, checks the pure `_lib/rules.ts` blockers, applies a conditional `updateMany` keyed on the expected status and assignee (otherwise a `ConflictError`), and calls `audit(..., tx)` in the same transaction.
- **Maker-checker:** `recommendCase` opens an approval request with `createApprovalRequest` under `KYC_DECISION_POLICY` (`kind: kyc_decision`, approver role Reviewer, no amount so it never auto-approves). `decideCase` first checks in domain logic that the decider didn't prepare the case (`decideBlocker` → `ApprovalError("SELF_APPROVAL")`, 403 `self_approval`). It then calls `approveRequest` or `rejectRequest` in the same transaction, so the platform also enforces approver ≠ requester.
- **Audit:** `kyc_case.view` on every detail render (every role). `pii.view` (field names only) when a Reviewer gets unmasked values. `kyc_case.claim`, `kyc_case.unclaim`, `kyc_case.recommend` and `kyc_case.decide` include before/after (`documentNumber` is redacted by `audit()`) and metadata (outcome, approval request id). `approval.request`, `approval.approve` and `approval.reject` come from the platform.
- **Data:** one migration (`kyc_queue_indexes`) adds indexes on `KycCase.riskLevel` and `KycCase.slaDueAt`, which the list filters and sorts on. The other filters already had indexes. The seed now creates a `kyc_decision` approval request for every recommended case (PENDING) and every decided case (APPROVED/REJECTED), so seeded cases can be decided through the same path. The worktree DB was re-seeded with 50K transactions.

Verification:
- `pnpm lint`, `typecheck`, `test` (85 tests, 26 of them new in `kyc.test.ts`, plus one new seed test) and `build` all pass.
- Tests cover RBAC for both pages (anonymous → /login; Admin → 403; Analyst and Reviewer render) and every action (wrong role → `forbidden`). They check the audit rows written by every action and by the view. Analysts get masked SSN/DOB/address/document number in the rendered HTML with no `pii.view` row. Reviewers get full values plus a `pii.view` row, and no PII values appear in the audit rows. Self-decision is blocked in the server action (`self_approval`, with the case and approval request unchanged and no `kyc_case.decide` row) and in the UI (the rendered page for the preparer has no decision form but another Reviewer's does). Tests also cover required reason/notes, stale/invalid state, the reject path, the full claim → recommend → decide flow, and `_lib` unit tests for the blockers, filters and SLA.
- Manual end-to-end against `pnpm dev` (:3003) with real Auth.js sign-in, submitting the server-action forms over HTTP. Alice claims and recommends `kyc_0002`, then Rita approves it: the case and its approval request end APPROVED and the audit trail is complete. Alice sees `•••-••-NNNN` and Rita sees full values with `pii.view` audited. Sam claims and recommends `kyc_0003` and gets no decision form. When Sam replays Rita's decision form, the server rejects it and the case stays RECOMMENDED. Ada gets 403 on `/kyc` and `/kyc/[id]`. `scripts/smoke.sh` shows 200 for alice, rita and sam and 403 for ada.

Decisions / deviations:
- **Who does what:** only Analysts claim and recommend, and only Reviewers decide. Sam (Analyst + Reviewer) can do both, but never on the same case. The "preparer" is whoever claimed or recommended the case. Unclaiming is only allowed by the assignee while the case is IN_REVIEW.
- **Mapping the decision to the approval primitive:** a final APPROVE calls `approveRequest`, and a final REJECT calls `rejectRequest`. The reviewer's reason is stored on both the case and the approval request, and the reviewer can decide against the analyst's recommendation.
- **Every detail render is a view.** That includes the re-render after a form submission, so one visit can produce several `kyc_case.view` rows. History on the page hides view rows and shows only mutations.
- **Test harness fix (`scripts/test/setup.ts`, not platform):** the global `vi.mock("next/cache")` from Phase 2 never applied. `next` isn't installed at the repo root, so the bare id didn't resolve, and the first server action under test failed with "static generation store missing". The setup file now resolves `next/cache` from `apps/internal-tools` and mocks that exact file with `vi.doMock`.
- `kyc.test.ts` imports `KYC_DECISION_KIND` from `scripts/seed/generate.ts` to make sure the seed and the tool's policy use the same approval kind.

Platform changes: **none** (`packages/platform` is untouched). Schema change in `packages/models`: two indexes only.

Security rule exceptions: none.

Known gaps / next steps:
- Denied self-decision attempts return 403 but aren't audited themselves. A `kyc_case.decide_denied` row would help with surveillance.
- Documents are a metadata list only (no file storage or viewer). Phase 3b (Assist panel / LLM extraction) was skipped as instructed.
- No "send back to analyst" path from RECOMMENDED. A reviewer who disagrees records the opposite decision with a reason.
- Expect merge conflicts with Phases 4 and 5 in `lib/catalog.ts`, `schema.prisma` and its migrations, `scripts/seed*`, `scripts/test/setup.ts` (if they also hit the mock issue) and this file.

PR description:
```
## Screens
- /kyc — queue list (filters: status, risk, assignee; SLA age + overdue badge; server-side pagination/sort)
- /kyc/[id] — case detail (customer PII via maskForViewer, documents, recommendation, decision, history; claim/unclaim, recommend, decide forms)
## Roles
- Analyst: view (masked PII), claim/unclaim, recommend. Reviewer: view (full PII, audited), final decision (never on a case they prepared). Admin: no access
## Security
- Audited actions: kyc_case.view, pii.view, kyc_case.claim, kyc_case.unclaim, kyc_case.recommend, kyc_case.decide, approval.request/approve/reject
- PII fields shown via maskForViewer: ssn, dob, address, documentNumber
- Approvals: KYC_DECISION_POLICY (kind kyc_decision, approver Reviewer, no auto-approve); preparer ≠ decider enforced in domain logic and by the platform
- Outbound calls: none
## Rule exceptions
- None
## Platform changes
- None (test setup fix in scripts/test/setup.ts so the global next/cache mock applies)
## Test plan
- [x] lint / typecheck / test / build
- [x] RBAC + audit tests per route/action; self-decision blocked in UI and server action
```
