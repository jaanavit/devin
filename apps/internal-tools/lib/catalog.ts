import type { ToolDefinition } from "@fintech/platform";

/**
 * App catalog: every tool registers here. Middleware uses `roles` to deny access to everything
 * under `href`; pages and actions must still call `requirePageRole()` / `requireRole()`.
 */
export const AUDIT_ROLES = ["Admin"] as const;
/** KYC review queue: Analysts prepare (claim + recommend), Reviewers make the final decision. */
export const KYC_ROLES = ["Analyst", "Reviewer"] as const;
export const KYC_PREPARER_ROLES = ["Analyst"] as const;
export const KYC_DECIDER_ROLES = ["Reviewer"] as const;

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
    slug: "kyc",
    name: "KYC review queue",
    href: "/kyc",
    owner: "Compliance",
    roles: KYC_ROLES,
    description: "Claim KYC cases, prepare a recommendation (Analyst) and make the final decision (Reviewer, never the preparer).",
  },
];

/** Roles allowed to see the catalog home page: anyone holding at least one platform role. */
export const CATALOG_ROLES = ["Analyst", "Reviewer", "Admin"] as const;
