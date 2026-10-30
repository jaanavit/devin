# Playbook: port a Power Apps canvas app to the platform

Use this to migrate an unpacked Power Apps canvas app (`pac canvas unpack` output) into a tool in `apps/internal-tools`. Building the target follows `playbooks/new-tool.devin.md`. This playbook adds the inventory, mapping and parity work around it.

**Input:** a directory containing `src/*.fx.yaml` (screens and controls with Power Fx), `DataSources/*.json`, `Connections/*.json` (connectors), and optionally exported Power Automate flows. Call the app `<app>` (kebab-case) below.

---

## 1. Inventory everything → `docs/ports/<app>/inventory.md`

Go through every file and record:

| Section | What to capture | Where to find it |
| --- | --- | --- |
| Screens | Screen name, purpose, visible-when conditions | `src/<Screen>.fx.yaml` top-level `As screen` |
| Data-writing controls | Control name, screen, and the formula that writes (`Patch`, `SubmitForm`, `Remove`, `UpdateIf`, `Collect` to a data source) | `OnSelect`, `OnSuccess`, `OnChange` properties |
| Data sources | Name, type (Dataverse table, SharePoint list, SQL), columns used | `DataSources/*.json` |
| Connectors | Connector, operations used, auth type | `Connections/*.json`, formulas calling `<Connector>.<Op>()` |
| Business logic | Every Power Fx formula with a rule in it (`If`, `Switch`, validation, calculations, `Filter` with conditions, role checks such as `User().Email in ...`) | Any property, especially `DisplayMode`, `Visible`, `OnSelect`, `Items` |
| Flows | Power Automate flows triggered (`<Flow>.Run(...)`), their triggers and steps | Formulas plus the flow exports |
| Security | Dataverse security roles, field-level security, sharing | Environment / solution export |

Grep for writers with `grep -nE "Patch\(|SubmitForm\(|Remove\(|RemoveIf\(|UpdateIf\(|\.Run\(" src/*.fx.yaml`.

## 2. Map data and roles

- **Data sources → models.** For each data source, either map it to an existing model in `packages/models/prisma/schema.prisma` or add a new model with a migration (see new-tool step 2). Record the column-by-column mapping in `inventory.md`. Rename PII columns to the canonical `PII_FIELDS` names (`ssn`, `dob`, `address`, `documentNumber`) so masking applies automatically.
- **Dataverse security roles → platform roles.** Map each role to `Analyst`, `Reviewer` or `Admin`. If a role doesn't fit, record it as an open question; don't invent a new role. Map the AAD groups behind them in `GROUP_ROLE_MAP` (`packages/platform/src/auth/mock-idp.ts`) or in the real IdP config.

## 3. Map screens to routes

| Power Apps pattern | Platform equivalent |
| --- | --- |
| Gallery / data table screen | `app/(tools)/<app>/page.tsx` with `DataTable` + `FilterBar` (server-side paging replaces delegation limits) |
| Detail / form screen | `[id]/page.tsx` with `DetailView` + `Form` |
| "Assign to me" / ownership toggles | `Queue` (claim/unclaim) |
| `Navigate(...)` between screens | Next.js links / routes |
| `Visible` / `DisplayMode` role checks | `hasAnyRole()` in the page (UI) **and** `requireRole()` in the action (enforcement) |

## 4. Translate Power Fx business logic into typed, tested server functions

- Put each rule in `app/(tools)/<app>/_lib/<rule>.ts` as a pure, typed function, called from server actions. Business rules must never live only in the UI.
- Write a unit test for each rule using the cases implied by the formula (each `If` branch, boundary values).
- Watch the semantic differences: Power Fx `Blank()` maps to `null`/`undefined`; `Value()`/`Text()` coercions need explicit parsing; currency should be integer cents (`parseDollarsToCents`); `Now()` is UTC on the server; delegation warnings in the original can hide bugs where only the first 500/2000 rows were evaluated (document any behaviour change).

## 5. Replace flows and connectors

| Original | Replacement |
| --- | --- |
| Approval flows (Start and wait for an approval) | `createApprovalRequest` / `approveRequest` / `rejectRequest` with an `ApprovalPolicy` |
| Email / Teams / Slack notification steps | `notify()` from `@fintech/platform/server` (added in Phase 7) |
| Scheduled flows | A job in the platform job runner (added in Phase 7) |
| HTTP / custom connectors | A typed client using `outboundFetch()`; add the host to the allowlist and justify it in the PR (security rule 5) |
| Office 365 Users lookups | `SessionUser` / IdP claims |

## 6. Apply all security rules

Follow `docs/CONVENTIONS.md` and new-tool step 4. Power Apps often relies on hidden controls for security; every one of those becomes a `requireRole()` check plus a test. Every `Patch`/`SubmitForm` you replace becomes an audited server action.

## 7. Write the parity report → `docs/ports/<app>/parity.md`

One row for every item in the inventory:

| Original feature | New implementation | Status | Notes |
| --- | --- | --- | --- |
| `scrReview` gallery filtered by status | `/<app>?status=` DataTable | done | Server-side paging removes the 2,000-row delegation cap |
| `btnApprove.OnSelect` Patch + flow | `approve` action + approval primitive | changed | Now maker-checker enforced on the server |
| Export to Excel connector | — | dropped | Replaced by audited CSV export; Excel not needed (owner: X) |

Status is one of `done`, `changed` or `dropped`. `changed` and `dropped` always need a reason.

## 8. Verify and open the PR

Run `pnpm lint && pnpm typecheck && pnpm test && pnpm build` until green. Register the tool in the catalog (new-tool step 5) and update `SUMMARY.md`. Open a PR titled **`port: <app>`** linking `inventory.md` and `parity.md`, using the PR description template from `new-tool.devin.md`.
