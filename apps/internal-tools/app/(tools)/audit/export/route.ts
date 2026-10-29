import { prisma } from "@fintech/models";
import { AUDIT_EXPORT_LIMIT, audit, auditLogsToCsv, auditWhere, requireRole, route } from "@fintech/platform/server";
import type { NextRequest } from "next/server";
import { AUDIT_ROLES } from "@/lib/catalog";
import { parseAuditFilters } from "../filters";

export const dynamic = "force-dynamic";

/** CSV export of the audit log for the current filters. The export itself is audited. */
export const GET = route(async (req: NextRequest) => {
  const user = await requireRole(AUDIT_ROLES);
  const filters = parseAuditFilters(Object.fromEntries(req.nextUrl.searchParams));
  const rows = await prisma.auditLog.findMany({ where: auditWhere(filters), orderBy: { createdAt: "desc" }, take: AUDIT_EXPORT_LIMIT });
  await audit(user, {
    action: "audit_log.export",
    entityType: "AuditLog",
    entityId: "export",
    metadata: { filters, rowCount: rows.length, truncated: rows.length === AUDIT_EXPORT_LIMIT },
  });
  return new Response(auditLogsToCsv(rows), {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="audit-log-${new Date().toISOString().slice(0, 10)}.csv"`,
      "cache-control": "no-store",
    },
  });
});
