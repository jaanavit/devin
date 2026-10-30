import type { ToolDefinition } from "@fintech/platform";

/**
 * App catalog: every tool registers here. Middleware uses `roles` to deny access to everything
 * under `href`; pages and actions must still call `requirePageRole()` / `requireRole()`.
 */
export const AUDIT_ROLES = ["Admin"] as const;
/** Support (Analyst) requests refunds; Finance (Reviewer) approves them. */
export const REFUNDS_ROLES = ["Analyst", "Reviewer"] as const;
export const REFUND_REQUESTER_ROLES = ["Analyst"] as const;
export const REFUND_APPROVER_ROLES = ["Reviewer"] as const;

export const TOOLS: readonly ToolDefinition[] = [
  {
    slug: "audit",
    name: "Audit log",
    href: "/audit",
    owner: "Platform team",
    roles: AUDIT_ROLES,
    description: "Search the append-only audit log by actor, entity, action and date; export to CSV.",
  },
  {
    slug: "refunds",
    name: "Refunds",
    href: "/refunds",
    owner: "Support & Finance",
    roles: REFUNDS_ROLES,
    description: "Request refunds against transactions; over $500 needs Finance approval; approved refunds are sent to payments.",
  },
];

/** Roles allowed to see the catalog home page: anyone holding at least one platform role. */
export const CATALOG_ROLES = ["Analyst", "Reviewer", "Admin"] as const;
