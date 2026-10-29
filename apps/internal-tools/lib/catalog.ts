import type { ToolDefinition } from "@fintech/platform";

/**
 * App catalog: every tool registers here. Middleware uses `roles` to deny access to everything
 * under `href`; pages and actions must still call `requirePageRole()` / `requireRole()`.
 */
export const AUDIT_ROLES = ["Admin"] as const;

export const TOOLS: readonly ToolDefinition[] = [
  {
    slug: "audit",
    name: "Audit log",
    href: "/audit",
    owner: "Platform team",
    roles: AUDIT_ROLES,
    description: "Search the append-only audit log by actor, entity, action and date; export to CSV.",
  },
];

/** Roles allowed to see the catalog home page: anyone holding at least one platform role. */
export const CATALOG_ROLES = ["Analyst", "Reviewer", "Admin"] as const;
