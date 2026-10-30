import { describe, expect, it } from "vitest";
import { checkSources, formatViolation, hostAllowed } from "./check";

const T = "apps/internal-tools/app/(tools)/thing";
const check = (files: Record<string, string>) => checkSources(new Map(Object.entries(files)));
const rules = (files: Record<string, string>) => check(files).map((v) => v.rule);

const goodAction = `"use server";
import { prisma } from "@fintech/models";
import { audit, inTransaction, requireRole, runAction } from "@fintech/platform/server";
export async function save(_p: unknown, fd: FormData) {
  return runAction(async () => {
    const user = await requireRole(["Analyst"]);
    await inTransaction(prisma, async (tx) => {
      const after = await tx.thing.update({ where: { id: "1" }, data: {} });
      await audit(user, { action: "thing.save", entityType: "Thing", entityId: "1", after }, tx);
    });
  });
}`;

describe("POLICY-1 audit-on-write", () => {
  it("passes when a write is audited", () => {
    expect(check({ [`${T}/actions.ts`]: goodAction })).toEqual([]);
  });

  it("flags a server action that writes without audit()", () => {
    const [v] = check({ [`${T}/actions.ts`]: goodAction.replace(/await audit\([^;]+;/, "") });
    expect(v).toMatchObject({ rule: 1, file: `${T}/actions.ts` });
    expect(v?.message).toContain("server action `save` writes to the database (tx.thing.update");
    expect(formatViolation(v!)).toContain("[POLICY-1 audit-on-write]");
  });

  it("follows helpers in the same file and in imported local modules", () => {
    const helper = `import { prisma } from "@fintech/models";\nexport async function persist() { await prisma.thing.deleteMany({}); }`;
    const action = `"use server";\nimport { requireRole } from "@fintech/platform/server";\nimport { persist } from "./_lib/persist";\nexport async function wipe() { await requireRole(["Admin"]); await persist(); }`;
    expect(check({ [`${T}/actions.ts`]: action, [`${T}/_lib/persist.ts`]: helper })).toMatchObject([{ rule: 1, message: expect.stringContaining(`${T}/_lib/persist.ts:2`) }]);
    const audited = helper.replace("await prisma.thing.deleteMany({});", "await prisma.thing.deleteMany({}); await audit(u, e);");
    expect(rules({ [`${T}/actions.ts`]: action, [`${T}/_lib/persist.ts`]: audited })).toEqual([]);
  });

  it("detects raw SQL writes and route handlers wrapped in route()", () => {
    const routeFile = `import { prisma } from "@fintech/models";\nimport { requireRole, route } from "@fintech/platform/server";\nexport const POST = route(async () => { await requireRole(["Admin"]); await prisma.$executeRaw\`DELETE FROM "Thing"\`; return new Response(); });`;
    expect(check({ [`${T}/purge/route.ts`]: routeFile })).toMatchObject([{ rule: 1, message: expect.stringContaining("route handler `POST`") }]);
  });

  it("treats platform helpers that audit internally as audited", () => {
    const action = `"use server";\nimport { approveRequest, requireRole } from "@fintech/platform/server";\nexport async function ok() { const u = await requireRole(["Reviewer"]); await approveRequest({ requestId: "1", approver: u }); await tx.refund.updateMany({ where: {}, data: {} }); }`;
    expect(rules({ [`${T}/actions.ts`]: action })).toEqual([]);
  });

  it("ignores reads", () => {
    const page = `import { prisma } from "@fintech/models";\nimport { requirePageRole } from "@fintech/platform/server";\nexport default async function P() { await requirePageRole(["Analyst"]); return prisma.thing.findMany(); }`;
    expect(rules({ [`${T}/page.tsx`]: page })).toEqual([]);
  });
});

describe("POLICY-2 require-role", () => {
  it("flags pages, routes and actions without a role guard", () => {
    const res = check({
      [`${T}/page.tsx`]: `export default async function P() { return null; }`,
      [`${T}/export/route.ts`]: `export async function GET() { return new Response(); }`,
      [`${T}/actions.ts`]: `"use server";\nexport async function a() {}\nexport async function b() { await requireRole(["Admin"]); }`,
    });
    expect(res.map((v) => [v.rule, v.message])).toEqual([
      [2, "server action `a` never calls requireRole()."],
      [2, "route handler `GET` never calls requireRole()."],
      [2, "page never calls requirePageRole()."],
    ]);
  });

  it("does not treat non-handler exports or non-route files as entries", () => {
    expect(rules({ [`${T}/_lib/rules.ts`]: `export function x() { return 1; }`, [`${T}/route.ts`]: `export const dynamic = "force-dynamic";` })).toEqual([]);
  });

  it("honours the documented exceptions (login)", () => {
    expect(rules({ "apps/internal-tools/app/login/page.tsx": `export default function Login() { return null; }` })).toEqual([]);
  });
});

describe("POLICY-3 no-pii-logging", () => {
  it("flags PII identifiers, properties and element access in console calls", () => {
    const res = check({
      "packages/platform/src/x.ts": [
        "console.log(ssn);",
        "console.info(`dob is ${customer.dob}`);",
        "console.error({ address });",
        'console.warn(record["documentNumber"]);',
        "console.info(`refund ${refund.id}`);",
      ].join("\n"),
    });
    expect(res.map((v) => [v.rule, v.line])).toEqual([[3, 1], [3, 2], [3, 3], [3, 4]]);
  });

  it("ignores test files", () => {
    expect(rules({ "packages/platform/src/x.test.ts": "console.log(ssn);" })).toEqual([]);
  });
});

describe("POLICY-4 outbound-allowlist", () => {
  it("flags direct fetch() outside the outbound wrapper and other HTTP clients", () => {
    const res = check({
      "apps/internal-tools/lib/x.ts": `import axios from "axios";\nexport const a = () => fetch("https://hooks.slack.com/x");\nexport const b = () => globalThis.fetch(u);`,
      "packages/platform/src/outbound.ts": `export const f = (u: string) => fetch(u);`,
    });
    expect(res.map((v) => [v.rule, v.line])).toEqual([[4, 1], [4, 2], [4, 3]]);
  });

  it("flags outboundFetch() to a literal non-allowlisted host", () => {
    expect(check({ "apps/internal-tools/lib/x.ts": `outboundFetch("https://evil.example.com/collect");\noutboundFetch("https://api.devin.ai/v1/sessions");\noutboundFetch(\`https://api.devin.ai/v1/\${p}\`);` })).toMatchObject([
      { rule: 4, line: 1, message: expect.stringContaining("evil.example.com") },
    ]);
  });

  it("matches hosts exactly or by subdomain wildcard", () => {
    expect(hostAllowed("https://o1.ingest.sentry.io/api/1")).toBe(true);
    expect(hostAllowed("https://hooks.slack.com.attacker.io")).toBe(false);
    expect(hostAllowed("nope")).toBe(false);
  });
});
