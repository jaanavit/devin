# Build Summary

Running log of what was built per phase, deviations, security exceptions, stubs, and gaps.

## Open blockers / questions

- None open. (Resolved: GitHub remote. The code lives in the private repo `jaanavit/devin`; `main` starts with an empty "Initial commit" so Phase 0 could be opened as a PR.)

## Pull requests

| Phase | Branch | PR | Base |
| --- | --- | --- | --- |
| 0 Repo setup | `phase-0-setup` | [#1](https://github.com/jaanavit/devin/pull/1) | `main` |
| 1 Platform | `phase-1-platform` | [#2](https://github.com/jaanavit/devin/pull/2) | `phase-0-setup` |
| 2 Playbooks | `phase-2-playbooks` | [#3](https://github.com/jaanavit/devin/pull/3) | `phase-1-platform` |
| 3 KYC review queue | `phase-3-kyc` | [#5](https://github.com/jaanavit/devin/pull/5) | `phase-2-playbooks` |
| 4 Refunds | `phase-4-refunds` | [#6](https://github.com/jaanavit/devin/pull/6) | `phase-2-playbooks` |
| 5 Feature flags | `phase-5-flags` | [#4](https://github.com/jaanavit/devin/pull/4) | `phase-2-playbooks` |
| 3+4+5 combined | `phase-3-4-5-integration` | (base for Phase 6) | `phase-2-playbooks` |
| 6 Transaction investigation | `phase-6-transactions` | [#7](https://github.com/jaanavit/devin/pull/7) | `phase-3-4-5-integration` |
| 7 Workflows | `phase-7-workflows` | [#8](https://github.com/jaanavit/devin/pull/8) | `phase-6-transactions` |

## Phase 0 — Repo setup

**Branch:** `phase-0-setup` (PR [#1](https://github.com/jaanavit/devin/pull/1))

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

**Branch:** `phase-1-platform` (PR [#2](https://github.com/jaanavit/devin/pull/2))

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

**Branch:** `phase-2-playbooks` (PR [#3](https://github.com/jaanavit/devin/pull/3))

Built:
- `playbooks/new-tool.devin.md`: the step-by-step procedure for building a tool, using the real Phase 1 names and paths (`requirePageRole`, `requireRole`, `runAction`, `audit(..., tx)`, `maskForViewer`, `createApprovalRequest`/`approveRequest`/`rejectRequest`, `outboundFetch`, the `lib/catalog.ts` registration, and the `@fintech/platform/testing` helpers). It includes copy-paste patterns for pages, actions and route handlers, the PR template, and the `tool: <name>` title.
- `playbooks/port-app.devin.md`: the Power Apps migration procedure. It covers the inventory (screens, writing controls, data sources, connectors, Power Fx logic, flows), data and role mapping, the screen-to-route mapping table, translating Power Fx into tested `_lib/` functions, replacing flows and connectors, and the `parity.md` format. PR title: `port: <app>`.
- Test setup: `next/cache` is mocked globally (`scripts/test/setup.ts`) so server actions that call `revalidatePath()` can be tested directly.
- `scripts/worktree-setup.sh <N> <branch>` creates a parallel-phase worktree at `~/fit-pN`. It gets its own `fintech_pN_dev`/`fintech_pN_test` databases and a `.env` with `PORT=300N`, `NEXTAUTH_URL` on :300N and payments-mock on :410N (`PAYMENTS_MOCK_PORT` and `PAYMENTS_MOCK_URL`). The script then installs, migrates and seeds with 50K transactions.
- The app's `dev`/`start` scripts now read `PORT` from `.env`, so each worktree runs on its own port with plain `pnpm dev`.

Decisions:
- **Phases 3, 4 and 5 are built in parallel** in separate git worktrees (`~/fit-p3`, `~/fit-p4`, `~/fit-p5`), each branched from `phase-2-playbooks` with its own databases and ports. This deviates from strictly stacked PRs: 3, 4 and 5 are siblings, and each one's PR targets `phase-2-playbooks`. Expect small merge conflicts in `schema.prisma`, `lib/catalog.ts`, `scripts/seed*` and this file when they're combined before Phase 6.

## Phase 3 — KYC review queue

**Branch:** `phase-3-kyc` (from `phase-2-playbooks`; PR [#5](https://github.com/jaanavit/devin/pull/5) `tool: kyc-review-queue`)

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

## Phase 4 — Refunds dashboard

**Branch:** `phase-4-refunds`, branched from `phase-2-playbooks` (PR [#6](https://github.com/jaanavit/devin/pull/6) `tool: refunds`)

Built (following `playbooks/new-tool.devin.md`):
- **`/refunds`** (Analyst, Reviewer): a list of refunds showing status, amount, customer, transaction and requester. It has server-side pagination and sorting, plus a status filter. **Search by customer (ID or name prefix) or transaction ID goes through payments-mock** (`paymentsClient().searchTransactions`). The matching transaction and customer IDs then filter the refund list. If payments-mock is down, the page shows an error instead of crashing.
- **`/refunds/new`** (Analyst only): searches payments-mock for a transaction, selects it, shows the refundable balance, and submits a refund request (amount and reason).
- **`/refunds/[id]`** (Analyst, Reviewer): refund, transaction and approval details, and a history built from the audit log. Reviewers who didn't request the refund get Approve (optional note) and Reject (required reason) forms. The requester sees a notice instead. Failed refunds show a Retry button.
- **Actions** (`actions.ts`): `createRefund` (Analyst), `approveRefund` / `rejectRefund` (Reviewer), `retryRefund` (Analyst or Reviewer, failed refunds only).
- **Maker-checker** uses the platform primitive unchanged: `REFUND_POLICY = { kind: "refund", entityType: "Refund", approverRoles: ["Reviewer"], autoApproveMaxCents: 50_000 }` with `createApprovalRequest` / `approveRequest` / `rejectRequest`. ≤ $500 is `AUTO_APPROVED`. Over $500 stays `PENDING` until a Reviewer who isn't the requester approves it.
- **Payments:** an approved refund (auto or by a Reviewer) immediately calls `POST /refunds` via `paymentsClient()`, with `refundId` = platform `Refund.id` as the idempotency key. Success → `PROCESSED`, with `externalRefundId` set and the transaction moved to `PARTIALLY_REFUNDED` / `REFUNDED`. Failure → `FAILED`, retryable.
- **Slack alert for refunds over $2,000:** `outboundFetch(process.env.SLACK_WEBHOOK_URL, …)`. When the variable is empty it logs `console.info("slack stub: …")` with only the refund ID. The message carries only the amount, refund ID and transaction ID, never customer data. A Slack failure is logged (IDs only) and never blocks the refund.
- **Business rules** live in `_lib/policy.ts` and are unit-tested. Amount must be positive and ≤ the refundable balance, which is the transaction amount minus pending, approved, processed and failed refunds (rejected refunds free their amount up). A reason is required (≤ 500 chars). Only `SETTLED` / `PARTIALLY_REFUNDED` transactions can be refunded. The transaction row is locked (`SELECT … FOR UPDATE`) while creating a refund, so concurrent requests can't over-refund.
- Registered in `lib/catalog.ts` (`REFUNDS_ROLES`, `REFUND_REQUESTER_ROLES`, `REFUND_APPROVER_ROLES`). The middleware RBAC test covers it automatically.

Verification:
- 24 new tests (82 total), using a **real in-process payments-mock server** backed by the test DB so they can inspect its refund log. They cover: RBAC for every page and action (anonymous, Admin, wrong role); $499 and $500 auto-approve and appear in the payments-mock log; $501 stays pending and doesn't reach payments; self-approval and self-rejection are rejected (`sam`); Analysts can't approve; double decisions are rejected; a reject reason is required; payments failure → `FAILED` → retry → `PROCESSED` exactly once; the Slack post (and no post at exactly $2,000); the console stub without PII; a Slack failure doesn't block the refund; search goes through payments-mock; audit rows for every mutation.
- Manual run against `pnpm dev` (:3004) + `pnpm dev:payments` (:4104), using real Auth.js sign-in and real server-action calls:
  - Alice $499 → auto-approved, `PROCESSED`, in `services/payments-mock/logs/refunds.jsonl`.
  - Alice $501 → `PENDING_APPROVAL`, nothing logged. Alice approving → `forbidden`. Rita approves → `PROCESSED` and logged. A second approval → `not_pending`.
  - Sam $2,500 → `slack stub: large refund alert for refund <id>`. Sam approving his own → `self_approval`. Felix approves → logged.
  - Page RBAC: Alice and Sam 200 everywhere. Rita 200 on the list and detail pages, 403 on `/refunds/new`. Ada 403 everywhere.

Decisions / deviations:
- **No platform code was needed** (`packages/platform` is unchanged).
- **Test infra fix (`scripts/test/setup.ts`):** the global `next/cache` mock added in Phase 2 never applied. `next` is installed only in `apps/internal-tools`, so a bare `"next/cache"` from `scripts/test/` resolved to a different module ID. Any server action calling `revalidatePath()` failed in tests with "static generation store missing". The mock now targets the app's copy of `next`.
- **The Slack alert fires when the refund is requested** (not when it's paid), so Finance knows a large refund is waiting for approval. Anything over $2,000 is always above the $500 auto-approve limit, so every alert is for a pending request.
- **Payments is called synchronously** inside the approving action rather than by a background job. Failures are recorded as `FAILED` and retried from the UI; payments-mock deduplicates on `refundId`. An outbox/job could replace this once Phase 7's job runner exists.
- **Customer name and ID are shown** (they aren't in `PII_FIELDS`). The refunds screens show no `ssn` / `dob` / `address` / `documentNumber`, so `maskForViewer` isn't needed and refund views aren't audited (the spec doesn't ask for it).
- **Search-to-refund filtering** uses up to 100 matching transactions from payments-mock (its page-size cap). Refunds for the matched customers are all included. A notice appears when a broad name search matches more than 100 transactions.
- **Creating a refund reads the transaction from the product DB** (needed for the row lock and the FK). Search and the transaction picker go through payments-mock.

Security:
- Audited actions: `refund.create`, `refund.approve`, `refund.reject`, `refund.process`, `refund.process_fail`, `transaction.refund_status`, plus the platform's `approval.request` / `approval.auto_approve` / `approval.approve` / `approval.reject`.
- Outbound calls: payments-mock (`paymentsClient()`), the Slack webhook (`outboundFetch`). Both are on the allowlist.
- Rule exceptions: none.

Stubs / needed to make real:
- `SLACK_WEBHOOK_URL` (empty → console stub). Phase 7 moves this to `notify()` (see `TODO(Phase 7)` in `_lib/process.ts`).

Known gaps / next steps:
- No partial-refund reversal or cancellation of a pending request by its requester.
- No approval reminder for pending refunds yet (Phase 7).

PR description (`tool: refunds`):
```
## Screens
- /refunds — list (status, amount, customer, transaction; status filter; search by customer or transaction ID via payments-mock)
- /refunds/new — search payments-mock for a transaction, request a refund (Analyst)
- /refunds/[id] — detail, approval, history; approve/reject (Reviewer ≠ requester); retry failed
## Roles
- Analyst: list, detail, create, retry. Reviewer: list, detail, approve/reject, retry. Admin: no access
## Security
- Audited actions: refund.create, refund.approve, refund.reject, refund.process, refund.process_fail, transaction.refund_status (+ platform approval.*)
- PII fields shown via maskForViewer: none shown
- Approvals: REFUND_POLICY (Reviewer), auto-approve ≤ $500, > $500 needs a second person; approver ≠ requester enforced by the platform
- Outbound calls: payments-mock (GET /transactions, POST /refunds) via paymentsClient(); Slack webhook via outboundFetch (refunds > $2,000; stubbed when unset)
## Rule exceptions
- None
## Platform changes
- None. (Test setup fix in scripts/test/setup.ts so the global next/cache mock actually applies.)
## Test plan
- [x] lint / typecheck / test / build
- [x] RBAC + audit tests per route/action
- [x] $499 auto-approves, $501 waits for a second Reviewer, approved refunds appear in the payments-mock log, > $2,000 alerts Slack
```

## Phase 5 — Feature-flag admin

**Branch:** `phase-5-flags` (PR [#4](https://github.com/jaanavit/devin/pull/4) `tool: feature-flags`, targets `phase-2-playbooks`)

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

## Phase 6 — Transaction investigation

**Branch:** `phase-6-transactions`, stacked on `phase-3-4-5-integration` (PR [#7](https://github.com/jaanavit/devin/pull/7))

Built (following `playbooks/new-tool.devin.md`):
- **Catalog entry** `transactions` → `/transactions`, owner Risk, roles `TRANSACTIONS_ROLES = [Analyst, Reviewer]`. Admins get 403.
- **`/transactions` search** over all 500K transactions by customer (exact `cus_…` ID, or case-insensitive name prefix resolved to at most 500 customers with a warning when capped), transaction ID, merchant (select), amount range ($) and date range. Server-side pagination; sort by date or amount (with `id` as a tiebreaker for stable paging). Invalid filters show a message instead of failing.
- **Customer view** `/transactions/customers/[id]`:
  - profile with SSN, DOB and address through `maskForViewer`; the view is audited as `customer.view` for every role, plus `pii.view` for Reviewers;
  - **timeline** merging transactions (200 most recent; all refunds and KYC events are always included), refunds (requested and paid out) and KYC events (opened, claimed, recommended, decided), newest first with deterministic tie-breaking (`_lib/customer.ts`, unit-tested);
  - **linked accounts**: other customers sharing a device ID, card fingerprint or address hash, one row per customer with badges for each shared identifier, strongest links first.
- **CSV export** `/transactions/export` for the current filters, capped at 50,000 rows, audited as `transaction.export` with the filters, row count and truncation flags. It contains no PII fields, so it's the same for every role.
- **Indexes** (migration `transaction_search_indexes`): `Transaction(createdAt)`, `(merchant, createdAt)`, `(amountCents)`, `(deviceId)`, `(cardFingerprint)`.
- `pnpm bench:search` (`scripts/bench/transaction-search.ts`) times the exact queries the page runs (paged rows + total count), 7 runs per case after a warm-up.

Search timings on the full seed (500,000 transactions, Homebrew Postgres 16 on the build laptop), median / max of 7 runs:

| Search | Matches | Before indexes (ms) | After indexes (ms) |
| --- | ---: | ---: | ---: |
| No filters (newest first) | 500,000 | 69.4 / 71.7 | 23.5 / 28.0 |
| Transaction ID | 1 | 2.2 / 3.1 | 1.7 / 6.9 |
| Customer ID | 24 | 1.2 / 2.2 | 1.3 / 2.6 |
| Customer name prefix ("Olivia") | 9,915 | 32.8 / 40.6 | 18.1 / 20.4 |
| Merchant | 25,035 | 55.2 / 61.9 | 5.0 / 7.2 |
| Amount $1,000–$1,500 | 25,269 | 33.2 / 34.6 | 4.6 / 6.7 |
| Last 7 days | 9,659 | 38.4 / 41.6 | 3.8 / 6.1 |
| Merchant + amount + 30 days | 460 | 38.2 / 40.6 | 9.0 / 9.3 |
| Amount ≥ $2,000, sorted by amount | 25,289 | 44.9 / 46.9 | 5.6 / 6.6 |
| Merchant, page 200 | 24,960 | 39.0 / 41.6 | 9.3 / 12.1 |

Slowest single search: **28 ms** after indexes (target < 1,000 ms). Full page loads over HTTP with real sign-in: 35–190 ms (the 190 ms was the first, cold request).

Verification:
- 18 new tests (159 total): filter parsing and validation; search correctness for each filter, name-prefix case-insensitivity, amount sort and paging; timeline ordering and tie-breaks; linked-account grouping and lookup; **the seeded fraud ring (`generateFraudRing`) shows up as linked accounts**, and every ring member links to at least one other; page RBAC (anonymous → /login, Admin 403, 404 for unknown customers); Analyst sees masked PII with only `customer.view` audited; Reviewer sees full PII with `customer.view` + `pii.view`, and no PII in audit rows; export RBAC (401/403), filtered CSV without PII, export audited, invalid filters → 400 with no audit row.
- Mutation check: reversing the timeline sort or bypassing `maskForViewer` makes 4 tests fail.
- Manual check on the full seed as Aaron (Risk analyst): `cus_900001` lists `cus_900002`–`cus_900007` as linked accounts. `cus_900008` is in the ring via a shared card with other members but shares nothing directly with `cus_900001`.

Decisions / deviations:
- **Reviewers can use the tool too** (the spec says "Risk analysts"). This is what makes "PII masked by role" meaningful: Analysts see masked values, Reviewers see full values and the reveal is audited.
- **Searches themselves are not audited**; customer views and exports are. Auditing every search would flood the log with low-value rows.
- **Customer name search** uses a two-step lookup (resolve up to 500 matching customers, then filter transactions by `customerId`), which uses the existing `(customerId, createdAt)` index. A trigram index would allow substring search; not needed for the spec.
- The page's merchant dropdown comes from `groupBy(merchant)`, which uses the new merchant index.

Platform changes: none. Security rule exceptions: none.

Known gaps / next steps:
- Linked accounts are one hop. A graph view (multi-hop, e.g. to reach `cus_900008` from `cus_900001`) would help ring investigations.
- Deep OFFSET pagination gets slower on very large result sets; keyset pagination would fix it if needed.

## Phase 7 — Workflows

**Branch:** `phase-7-workflows`, stacked on `phase-6-transactions` (PR [#8](https://github.com/jaanavit/devin/pull/8))

Built:
- **`notify({ event, entity, text })`** in `packages/platform`. It posts to `SLACK_WEBHOOK_URL` via `outboundFetch` and returns `sent`, `stubbed` or `failed`. It never throws, so a Slack problem can't undo or fail the action that triggered it. When the webhook isn't configured it logs `slack stub: <event> <entity type> <entity id>`, never the message text.
- **Refunds and feature flags refactored to use `notify()`.** Their inline Slack helpers are gone. All 56 existing Refunds and Flags tests pass with no test changes, which shows the behavior (webhook payloads, stub log lines, failure handling) is unchanged.
- **Job runner** (`packages/platform/src/jobs.ts`):
  - `JobDefinition` with `{ everyMinutes }` or `{ dailyAtUtc: "HH:MM" }` schedules;
  - `runJob()` records each execution as a `JobRun` (new model + migration) and audits it as `job.run` (job, trigger, status, PII-redacted summary);
  - a partial unique index allows only one `RUNNING` run per job, so the scheduler and a manual trigger can't run a job twice at once (`JobAlreadyRunningError`);
  - `RUNNING` rows older than 1 hour are marked `FAILED (stale)` so a crashed run doesn't block the job forever;
  - failures store the error class only (DB error messages can contain row values);
  - `runDueJobs()` / `startScheduler()` check for due jobs every minute.
- **Approval reminders** (`approval-reminders` job, every 15 min, in the platform so every approval kind gets it): finds approval requests `PENDING` for more than 1 hour, sends one Slack digest with kind, entity, amount, age, approver roles and deep links, sets `lastReminderAt` with a conditional update (no double reminders from concurrent runs), and audits `approval.remind`. A request is reminded at most once per 24 hours; batches are capped at 50 per run.
- **Nightly ops summary** (`nightly-ops-summary`, daily 02:00 UTC, `apps/internal-tools/lib/jobs`): KYC cases past SLA (count, by risk, 10 most overdue) and refunds awaiting approval (count, total, 10 oldest), with deep links and no customer data.
- **Manual trigger:** Admin-only `/jobs` page (catalog entry "Scheduled jobs") shows each job, its schedule, last run and next run, a "Run now" button, and the 25 most recent runs. CLI: `pnpm jobs:run <name>`. Scheduler process: `pnpm jobs:worker`.
- Playbooks updated: `new-tool` now says to use `notify()` and shows how to add a job; `port-app` maps notification, reminder and scheduled flows to these.

Security fix found while testing: the outbound allowlist trusted whatever host `SLACK_WEBHOOK_URL` pointed at, so a misconfigured or tampered value could send notifications anywhere. Slack is now allowed only via the static `hooks.slack.com` entry, with a test for it.

Verification:
- 19 new tests (178 total):
  - `notify` sends, stubs without leaking the text, and returns `failed` without throwing on HTTP errors, network errors and non-allowlisted hosts;
  - `isDue` / `nextRunAt` for both schedule types;
  - `runJob` success (PII redacted, audited), failure (error class only), concurrency rejection, stale-run recovery, `runDueJobs`;
  - reminders: only requests pending more than 1 hour, once, re-reminded after 24 hours, decided requests skipped, digest text, audit rows, nothing posted when nothing is due;
  - `/jobs` Admin-only (page and action);
  - **manually triggering `nightly-ops-summary` posts the expected summary to Slack** (correct counts and ordering, closed and on-time items excluded, no customer data), and the run is recorded and audited as the Admin.
- On the full seed: `pnpm jobs:run nightly-ops-summary` → `SUCCEEDED` (115 KYC cases past SLA, 40 refunds pending, $54,764.15). `pnpm jobs:worker` picked up `approval-reminders` immediately and reminded about the first 50 overdue approvals.

Decisions / deviations:
- **Reminders are a digest**, one message per run rather than one per request, to avoid flooding the channel. The first reminder comes after 1 hour, then at most once a day per request.
- **The scheduler is an in-process loop** (`pnpm jobs:worker`) rather than cron or a queue. The `JobRun` table and the one-running-per-job index make it safe to run more than one worker, or to trigger a job manually while the worker runs.
- Platform changes: `notify`, `jobs`, `approval-reminders` (all called for by the spec). Schema change: `JobRun` model.

Stubs / needed to make real:
- `SLACK_WEBHOOK_URL` (currently stubbed). A process manager or container to keep `pnpm jobs:worker` running in each environment (Phase 8 deploy).

Known gaps / next steps:
- Blocked actions (e.g. a denied self-approval) still aren't audited or notified.
- No per-team Slack channels; everything goes to one webhook.

## Phase 8 — Environments and guardrails

**Branch:** `phase-8-ci-guardrails`, stacked on `phase-7-workflows`. Deliberate-violation branch: `ci-demo-policy-violation` (PR must stay unmerged).

Built:
- **`.github/workflows/ci.yml`** on every PR and push to `main`:
  - **Policy checks** (`pnpm policy`)
  - **Lint, typecheck, test, build** (tests against a Postgres 16 service container)
  - **Prisma migration check** (`pnpm db:check`: migrations apply to an empty DB and `prisma migrate diff --exit-code` proves they match `schema.prisma`)
  - Third-party actions pinned to commit SHAs; `permissions: contents: read`; concurrency cancels superseded runs.
- **Deploys** in the same workflow, gated on all three check jobs: **preview** per PR, **staging** on push to `main`, **production** on a `v*` tag. Each targets a GitHub environment (`preview` / `staging` / `production`) so protection rules (e.g. a required reviewer for production) can be configured in repo settings. `scripts/deploy.sh` is a stub: with no `<ENV>_DEPLOY_HOOK_URL` secret it prints what it would deploy; with one it calls the hook.
- **Policy checks** (`scripts/policy/check.ts`, TypeScript compiler API, documented in `docs/CONVENTIONS.md`):
  1. **POLICY-1 audit-on-write:** a server action, route handler or page that reaches a Prisma write (`create` / `update` / `upsert` / `delete` / `…Many` / `$executeRaw`), including through helpers it calls in local modules, with no reachable `audit()` (or audited platform helper such as `approveRequest` / `runJob`).
  2. **POLICY-2 require-role:** an action or route without `requireRole()`, or a page without `requirePageRole()`.
  3. **POLICY-3 no-pii-logging:** `console.*` arguments referencing `ssn`, `dob`, `documentNumber` or `address`.
  4. **POLICY-4 outbound-allowlist:** `fetch()` outside `packages/platform/src/outbound.ts`, `outboundFetch()` to a literal non-allowlisted host, or importing axios / got / node-fetch / undici etc.
  - Each violation prints `✖ [POLICY-n name] file:line`, what's wrong and the rule text, plus a GitHub annotation on the PR diff.
  - Exceptions live in `scripts/policy/exceptions.ts` with written justifications (currently: the Auth.js route, the login page, the static 403 page).
- `pnpm policy` added to the `new-tool` playbook's verify step.

Verification:
- 14 checker tests (positive and negative cases for every rule, helpers in other files, `route()`-wrapped handlers, raw SQL, exceptions, host matching). 192 tests total.
- `pnpm policy` passes on the whole codebase (110 files), so every existing tool already complies.
- Migration check proven both ways locally: passes on the real migrations, and fails with a clear message naming the change when a column is added to `schema.prisma` without a migration.
- **Deliberate violation** (`ci-demo-policy-violation`): adds `flags/bulk-actions.ts`, a server action that turns off every flag with `prisma.featureFlag.updateMany` and never calls `audit()`. Locally `pnpm policy` fails with:
  ```
  ✖ [POLICY-1 audit-on-write] apps/internal-tools/app/(tools)/flags/bulk-actions.ts:11
      server action `disableAllFlags` writes to the database (prisma.featureFlag.updateMany at line 15) but never calls audit().
      Rule: Every mutation is audited: call audit() from @fintech/platform/server (docs/CONVENTIONS.md rule 1).
  ```

Decisions / deviations:
- **Policy checks are a custom static checker** rather than ESLint rules, because rule 1 needs to follow calls across files (actions → `_lib` helpers) and report per entry point.
- The checks are static and name-based. POLICY-1 proves an audit is reachable from each entry point, not that each individual write has its own audit. POLICY-3 can't see PII inside a whole logged object. Both limits are documented in `docs/CONVENTIONS.md`; code review still applies.
- One workflow file for checks and deploys, so deploys can depend on the check jobs directly (no duplicate CI runs).

Stubs / needed to make real:
- A hosting target: set `PREVIEW_DEPLOY_HOOK_URL` / `STAGING_DEPLOY_HOOK_URL` / `PRODUCTION_DEPLOY_HOOK_URL` as environment secrets, or replace `scripts/deploy.sh` with the provider's CLI.
- Branch protection on `main` requiring the three check jobs, and a required reviewer on the `production` environment (repo settings).
- **Blocked:** pushing workflow files requires the GitHub token to have the `workflow` scope. The current token doesn't, so this branch and the violation PR are committed locally but not yet pushed.

## Phase 9 — Automated maintenance

**Branch:** `phase-9-maintenance`, stacked on `phase-8-ci-guardrails`. Setup and testing guide: `docs/maintenance.md`.

Built:
- **Sentry** in `apps/internal-tools` (`@sentry/nextjs` 10.76): server, route-handler and server-action errors via `instrumentation.ts` / `onRequestError`; browser errors via `instrumentation-client.ts`. Disabled when `SENTRY_DSN` / `NEXT_PUBLIC_SENTRY_DSN` are empty. `beforeSend` (`lib/sentry.ts`):
  - keeps only the user ID; drops request body, cookies, headers and query string;
  - redacts PII-named keys and SSN/email patterns everywhere, including stack-frame local variables;
  - removes breadcrumb text.
- **Sentry → Devin relay** `POST /api/webhooks/sentry`:
  - verifies Sentry's HMAC-SHA256 signature (constant-time);
  - parses `issue.created` and `event_alert.triggered`, the latter carrying the full stack trace;
  - forwards only the error, culprit, up to 15 frames (crashing frame first) and the issue link;
  - creates a session through the **Devin API v3** (`POST /v3/organizations/{org_id}/sessions`, checked against the current docs; v1 is the legacy API), with instructions to reproduce, fix, add a regression test, run the full check suite and open a PR;
  - is idempotent per Sentry issue (the audit log is the ledger), audits every relay as `system:sentry-relay`, and is stubbed when `DEVIN_API_KEY` / `DEVIN_ORG_ID` are unset.
  - The Devin client lives in the platform (`createDevinSession`) and goes through `outboundFetch`.
- **Weekly dependency upgrade** (`.github/workflows/weekly-deps.yml`, Mondays 06:00 UTC + manual run):
  - `scripts/deps/weekly-update.ts` bumps exact pins to the newest same-major, non-prerelease version published ≥ 7 days ago;
  - then the full suite runs (lint, typecheck, policy, test, build, migration check), and a PR opens only if everything passes;
  - available major upgrades are listed in the PR body, never applied automatically.
  - `.github/dependabot.yml` keeps the SHA-pinned Actions current (7-day cooldown).
- `scripts/maintenance/send-sample-sentry-webhook.sh` sends a correctly signed sample payload to a running app.

Verification:
- 13 new tests (205 total). 11 relay/Sentry tests against realistic sample payloads (`lib/maintenance/__fixtures__/`): signature accept/reject cases; both payload types parsed; prompt contents with **no PII** even though the sample payload deliberately contains an SSN, emails, an IP, a cookie, a request body and a customer name; exact v3 request (URL, auth, repos, tags); duplicate webhook → one session; stub mode; Devin API failure → 502 with no audit row; the `beforeSend` scrubber. Plus 2 tests for the dependency picker.
- Against the running production build: signed sample → `201 {"status":"stubbed"}` and an audit row; wrong secret → 401; other `/api/*` paths still need a session (401).
- `pnpm deps:update` dry run against the live registry: 7 same-major updates (React 19.3.1, ESLint 10.13.0, dotenv 16.6.1), and 11 majors listed but not applied (Next 16, Prisma 7, TypeScript 7, Vitest 5, Sentry 11, …).

Decisions / deviations:
- **The webhook route is a documented POLICY-2 exception.** A webhook has no user session; it's authenticated by signature instead, and is the only public API besides Auth.js.
- **Breadcrumbs are stripped of text** rather than pattern-scrubbed: writing the tests showed that a customer name in a log breadcrumb would otherwise reach Sentry, and names can't be matched by pattern.
- **A custom weekly workflow, not Dependabot, for npm**, so upgrades obey the same 7-day rule as the lockfile, never jump majors, and only open a PR after the whole suite (including policy and migration checks) has passed. Dependabot is used for GitHub Actions.
- Sentry source maps aren't uploaded (needs a Sentry auth token and `withSentryConfig`). `@sentry/cli`'s install script is intentionally not allowed to run.
- `@opentelemetry/api` is pinned to 1.9.1 via a pnpm override to satisfy `@sentry/nextjs`'s OpenTelemetry peer range.

Stubs / needed to make real:
- `SENTRY_DSN`, `NEXT_PUBLIC_SENTRY_DSN`, `SENTRY_WEBHOOK_SECRET` (Sentry internal integration), `DEVIN_API_KEY` + `DEVIN_ORG_ID` (Devin service user with `UseDevinSessions`), and optionally a `DEPS_PR_TOKEN` secret so CI also runs on the weekly PR.
- Same push blocker as Phase 8 (`workflow` scope needed for `.github/workflows/*`).
