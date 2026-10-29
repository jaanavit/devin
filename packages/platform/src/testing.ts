// Test helpers. Import only from *.test.ts files.
import { prisma, type SessionUser } from "@fintech/models";
import { DEMO_IDENTITIES, rolesForGroups } from "./auth/mock-idp";

export { runAsUser } from "./auth/session";

type DemoKey = "alice" | "aaron" | "rita" | "felix" | "ada" | "sam";

/** Demo users as session principals: alice/aaron = Analyst, rita/felix = Reviewer, ada = Admin, sam = Analyst+Reviewer. */
export const demoUsers = Object.fromEntries(
  DEMO_IDENTITIES.map((i) => [i.sub.replace(/^u_/, ""), { id: i.sub, email: i.email, name: i.name, roles: rolesForGroups(i.groups) }]),
) as Record<DemoKey, SessionUser>;

/** Truncates every table (including the append-only audit log, via the test-only escape hatch). */
export async function resetDb(): Promise<void> {
  const url = process.env.DATABASE_URL ?? "";
  if (!/_test\b|_test\?/.test(url)) throw new Error("resetDb() refuses to run against a non-test database");
  const tables = await prisma.$queryRaw<{ tablename: string }[]>`
    SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`;
  const list = tables.map((t) => `"public"."${t.tablename}"`).join(", ");
  await prisma.$transaction([
    prisma.$executeRawUnsafe(`SET LOCAL app.allow_audit_truncate = 'on'`),
    prisma.$executeRawUnsafe(`TRUNCATE TABLE ${list} CASCADE`),
  ]);
}

/** Inserts the demo users so foreign keys (requester, assignee, ...) resolve. */
export async function seedDemoUsers(): Promise<void> {
  await prisma.user.createMany({
    data: Object.values(demoUsers).map((u) => ({
      id: u.id,
      email: u.email,
      name: u.name,
      roles: u.roles,
      idpGroups: DEMO_IDENTITIES.find((i) => i.sub === u.id)?.groups ?? [],
    })),
    skipDuplicates: true,
  });
}

/** Matches the error thrown by Next's `forbidden()` (rendered as HTTP 403). */
export const FORBIDDEN = { digest: "NEXT_HTTP_ERROR_FALLBACK;403" } as const;

/** True if `err` is Next's redirect interrupt targeting `path`. */
export function isRedirectTo(err: unknown, path: string): boolean {
  const digest = (err as { digest?: unknown } | null)?.digest;
  return typeof digest === "string" && digest.startsWith("NEXT_REDIRECT;") && digest.split(";")[2] === path;
}

export async function auditRowsFor(entityType: string, entityId?: string) {
  return prisma.auditLog.findMany({ where: { entityType, ...(entityId ? { entityId } : {}) }, orderBy: { createdAt: "asc" } });
}
