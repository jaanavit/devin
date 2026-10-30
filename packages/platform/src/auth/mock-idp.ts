import { ROLES, type Role } from "@fintech/models/shared";

/**
 * Mocked OIDC identity provider directory. In production this is replaced by the real IdP
 * (Entra ID / Okta); only the group → role mapping below carries over.
 */
export interface IdpIdentity {
  sub: string;
  email: string;
  name: string;
  title: string;
  groups: string[];
}

export const GROUP_ROLE_MAP: Readonly<Record<string, Role>> = {
  "grp-compliance-analysts": "Analyst",
  "grp-support-agents": "Analyst",
  "grp-risk-analysts": "Analyst",
  "grp-compliance-reviewers": "Reviewer",
  "grp-finance-approvers": "Reviewer",
  "grp-platform-admins": "Admin",
};

export function rolesForGroups(groups: readonly string[]): Role[] {
  const granted = new Set(groups.map((g) => GROUP_ROLE_MAP[g]).filter((r): r is Role => r !== undefined));
  return ROLES.filter((r) => granted.has(r));
}

export const DEMO_IDENTITIES: readonly IdpIdentity[] = [
  {
    sub: "u_alice",
    email: "alice.analyst@example.com",
    name: "Alice Analyst",
    title: "Compliance Analyst",
    groups: ["grp-compliance-analysts"],
  },
  {
    sub: "u_aaron",
    email: "aaron.support@example.com",
    name: "Aaron Support",
    title: "Support & Risk Analyst",
    groups: ["grp-support-agents", "grp-risk-analysts"],
  },
  {
    sub: "u_rita",
    email: "rita.reviewer@example.com",
    name: "Rita Reviewer",
    title: "Compliance Reviewer",
    groups: ["grp-compliance-reviewers"],
  },
  {
    sub: "u_felix",
    email: "felix.finance@example.com",
    name: "Felix Finance",
    title: "Finance Approver",
    groups: ["grp-finance-approvers"],
  },
  {
    sub: "u_ada",
    email: "ada.admin@example.com",
    name: "Ada Admin",
    title: "Platform Admin",
    groups: ["grp-platform-admins"],
  },
  {
    sub: "u_sam",
    email: "sam.senior@example.com",
    name: "Sam Senior",
    title: "Senior Compliance (Analyst + Reviewer)",
    groups: ["grp-compliance-analysts", "grp-compliance-reviewers"],
  },
];

export function findIdentity(sub: unknown): IdpIdentity | undefined {
  return typeof sub === "string" ? DEMO_IDENTITIES.find((i) => i.sub === sub) : undefined;
}
