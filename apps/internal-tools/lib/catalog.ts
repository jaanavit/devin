import type { ToolDefinition } from "@fintech/platform";

/**
 * App catalog: every tool registers here. Middleware uses `roles` to deny access to everything
 * under `href`; pages and actions must still call `requirePageRole()` / `requireRole()`.
 */
export const AUDIT_ROLES = ["Admin"] as const;
export const FLAGS_ROLES = ["Admin"] as const;

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
    slug: "flags",
    name: "Feature flags",
    href: "/flags",
    owner: "Platform team",
    roles: FLAGS_ROLES,
    description: "Toggle feature flags and set rollout per environment; prod changes need a reason and post to Slack.",
  },
];

/** Roles allowed to see the catalog home page: anyone holding at least one platform role. */
export const CATALOG_ROLES = ["Analyst", "Reviewer", "Admin"] as const;
