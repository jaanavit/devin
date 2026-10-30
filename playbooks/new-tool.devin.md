# Playbook: build a new internal tool on the platform

Use this to build any new tool in `apps/internal-tools`. Follow the steps in order. Security rules are in `docs/CONVENTIONS.md`; they are non-negotiable.

**Inputs you need from the request:** tool name (kebab-case slug), owner team, users and roles (`Analyst` | `Reviewer` | `Admin`), data (new or existing models), actions, approval rules, and any notifications.

---

## 1. Read the platform first, and reuse it

Read these before writing code:

- `packages/models/prisma/schema.prisma`: existing models. Reuse them; only add what's missing.
- `packages/models/src/shared.ts`: `Role`, `SessionUser`, `PII_FIELDS` (`ssn`, `dob`, `address`, `documentNumber`).
- `packages/platform/src/server.ts`: the server API (`requireRole`, `requirePageRole`, `audit`, `maskForViewer`, `createApprovalRequest`, `approveRequest`, `rejectRequest`, `runAction`, `route`, `outboundFetch`, `paymentsClient`, `inTransaction`).
- `packages/platform/src/index.ts`: pure helpers (`mask`, `hasAnyRole`, `canViewPii`, `parseTableParams`, `formatCents`, `parseDollarsToCents`, `toCsv`, errors such as `ValidationError`, `NotFoundError` and `ConflictError`).
- `packages/platform/src/ui/index.ts`: `DataTable`, `FilterBar`, `Form`, `Queue`, `DetailView`, `PageHeader`, `Badge`, `Card`, `Field`, `Input`, `Select`, `Textarea`, `Notice`.
- `apps/internal-tools/app/(tools)/audit/`: a complete reference tool (list page, filters, route handler, tests).

Never redefine a model type in the app. Import it from `@fintech/models`. If a helper you need is missing from the platform, say so in the PR and explain why before adding it.

## 2. New data goes in `packages/models` with a migration

1. Edit `packages/models/prisma/schema.prisma`. Mark PII columns with a `/// PII` doc comment and use the canonical field names from `PII_FIELDS`.
2. Create the migration: `pnpm db:migrate --name <tool>_<change>`. This writes `packages/models/prisma/migrations/<timestamp>_<name>/migration.sql` and regenerates the client.
3. Add an index for every column you filter or sort on in the list view.
4. Export any new model types from `packages/models/src/index.ts`.
5. Extend `scripts/seed/generate.ts` and `scripts/seed.ts` if the tool needs demo data.

## 3. Create the tool's routes

```
apps/internal-tools/app/(tools)/<tool>/
  page.tsx              # list: DataTable + FilterBar, server-side pagination
  [id]/page.tsx         # detail: DetailView + action forms
  actions.ts            # "use server": every mutation
  <name>/route.ts       # only if an HTTP endpoint is needed (export, webhook)
  _lib/*.ts             # pure domain logic (business rules), unit-tested
  <tool>.test.ts        # RBAC + audit + approval tests
```

`actions.ts` may only export async functions (a Next.js rule). Put constants and types in `_lib/`.

### Page pattern (list or detail)

```tsx
import { parseTableParams, type SearchParams } from "@fintech/platform";
import { requirePageRole } from "@fintech/platform/server";
import { DataTable, FilterBar, PageHeader, type Column } from "@fintech/platform/ui";
import { MY_TOOL_ROLES } from "@/lib/catalog";

export default async function Page({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const user = await requirePageRole(MY_TOOL_ROLES); // first line, always
  const sp = await searchParams;
  const params = parseTableParams(sp, { sortable: ["createdAt"], defaultSort: "createdAt", filterKeys: ["status"] });
  // prisma query with skip/take/orderBy from params, where from params.filters
  // ...
}
```

### Server action pattern

```ts
"use server";
import { audit, requireRole, runAction, inTransaction, type ActionResult } from "@fintech/platform/server";
import { prisma } from "@fintech/models";
import { revalidatePath } from "next/cache";
import { MY_TOOL_ROLES } from "@/lib/catalog";

export async function doThing(_prev: ActionResult<unknown> | null, formData: FormData): Promise<ActionResult<unknown>> {
  return runAction(async () => {
    const user = await requireRole(MY_TOOL_ROLES); // first call inside runAction
    const id = String(formData.get("id") ?? "");
    // validate input; throw ValidationError for bad input
    await inTransaction(prisma, async (tx) => {
      const before = await tx.thing.findUniqueOrThrow({ where: { id } });
      const after = await tx.thing.update({ where: { id }, data: { /* ... */ } });
      await audit(user, { action: "thing.do", entityType: "Thing", entityId: id, before, after }, tx);
    });
    revalidatePath(`/my-tool/${id}`);
  }, "Done.");
}
```

Rules for actions:

- `requireRole()` is the first statement inside `runAction`, so a 403 comes back as `{ ok: false, code: "forbidden" }`.
- Pass the transaction client to `audit()` so the audit row and the mutation commit together. Audit actions are named `<entity_snake>.<verb>`, e.g. `kyc_case.claim`.
- For state changes, use a conditional `updateMany({ where: { id, status: <expected> } })` and check `count === 1` to prevent races. Throw `ConflictError` otherwise.
- Don't trust hidden form fields for authorization. Re-load the entity and re-check ownership and state on the server.
- To show a form in the UI, pass the action to `<Form action={doThing} submitLabel="...">`.

### Route handler pattern

```ts
import { audit, requireRole, route } from "@fintech/platform/server";
export const GET = route(async (req) => {
  const user = await requireRole(MY_TOOL_ROLES);
  // ...
  await audit(user, { action: "thing.export", entityType: "Thing", entityId: "export", metadata: { rowCount } });
  return new Response(/* ... */);
});
```

## 4. Apply the security rules

- **RBAC:** every `page.tsx` calls `requirePageRole(ROLES)`, and every action and route calls `requireRole(ROLES)`. Hide UI controls the user can't use too, but the server check is what actually protects them.
- **Audit:** every mutation calls `audit()`. Viewing a record's detail page is audited as `<entity>.view` when the spec says so.
- **PII:** never render a PII field directly. Use `maskForViewer(user, record, { entityType, entityId })` on the server. It masks for non-Reviewers and audits `pii.view` for Reviewers. Never `console.*` a record, request body or PII field; log IDs only.
- **Maker-checker:** money and risk decisions go through `createApprovalRequest({ policy, entityId, amountCents, requester })` followed by `approveRequest` / `rejectRequest`. Declare the policy in `_lib/`:
  ```ts
  export const REFUND_POLICY: ApprovalPolicy = { kind: "refund", entityType: "Refund", approverRoles: ["Reviewer"], autoApproveMaxCents: 50_000 };
  ```
  The platform enforces approver ≠ requester and approver roles. For non-amount decisions (e.g. a KYC final decision), also check in your domain logic that the deciding user is not the preparer, and test it.
- **Outbound calls:** only via `outboundFetch()` or `paymentsClient()`. For Slack before `notify()` exists (Phase 7), call `outboundFetch(process.env.SLACK_WEBHOOK_URL, { method: "POST", body: JSON.stringify({ text }) })` and skip the call (with `console.info("slack stub: ...")`, no PII) when the variable is empty.

## 5. Register the tool in the catalog

In `apps/internal-tools/lib/catalog.ts`:

```ts
export const MY_TOOL_ROLES = ["Analyst", "Reviewer"] as const;
// add to TOOLS:
{ slug: "my-tool", name: "My tool", href: "/my-tool", owner: "<Team>", roles: MY_TOOL_ROLES, description: "<one line>" },
```

The middleware then denies every other role on `/my-tool/**` with HTTP 403, and the nav and catalog pick the tool up automatically. `apps/internal-tools/middleware.test.ts` iterates `TOOLS`, so the new entry gets middleware RBAC coverage for all 6 demo users with no extra work.

## 6. Tests

Tests run against the real test database. Use `@fintech/platform/testing`:

```ts
import { FORBIDDEN, auditRowsFor, demoUsers, resetDb, runAsUser, seedDemoUsers } from "@fintech/platform/testing";
beforeEach(async () => { await resetDb(); await seedDemoUsers(); /* insert fixtures with prisma */ });

it("Analyst cannot open the page", async () => {
  await expect(runAsUser(demoUsers.ada, () => Page({ params: Promise.resolve({ id }), searchParams: Promise.resolve({}) }))).rejects.toMatchObject(FORBIDDEN);
});
it("action is denied for the wrong role", async () => {
  const res = await runAsUser(demoUsers.ada, () => doThing(null, form({ id })));
  expect(res).toMatchObject({ ok: false, code: "forbidden" });
});
it("action is audited", async () => {
  await runAsUser(demoUsers.alice, () => doThing(null, form({ id })));
  expect((await auditRowsFor("Thing", id)).map((r) => r.action)).toContain("thing.do");
});
```

Demo users: `alice`/`aaron` = Analyst, `rita`/`felix` = Reviewer, `ada` = Admin, `sam` = Analyst+Reviewer (use him for self-approval tests).

Required: at least one RBAC test and one audit test per route and action, approval tests where applicable (self-approval rejected, thresholds), and unit tests for `_lib/` business rules. `next/cache` is mocked globally (`scripts/test/setup.ts`).

## 7. Verify and open the PR

```sh
pnpm lint && pnpm typecheck && pnpm test && pnpm build
```

Repeat until all four are green, then smoke-test manually: run `pnpm dev`, sign in as each relevant demo user, and check `scripts/smoke.sh <sub> /my-tool` for status codes.

Update `SUMMARY.md` (what was built, deviations, rule exceptions, stubs, gaps). Commit, then open a PR titled **`tool: <name>`** with this description:

```
## Screens
- /my-tool — list (...)
- /my-tool/[id] — detail (...)
## Roles
- Analyst: ..., Reviewer: ..., Admin: no access
## Security
- Audited actions: thing.do, ...
- PII fields shown via maskForViewer: ...
- Approvals: policy ..., thresholds ...
- Outbound calls: ...
## Rule exceptions
- None (or list with justification)
## Platform changes
- None (or why they were needed)
## Test plan
- [ ] lint / typecheck / test / build
- [ ] RBAC + audit tests per route/action
```
