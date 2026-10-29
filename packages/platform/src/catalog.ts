import type { Role, SessionUser } from "@fintech/models/shared";
import { hasAnyRole } from "./rbac";

export interface ToolDefinition {
  slug: string;
  name: string;
  /** Route prefix owned by the tool. All paths under it require `roles`. */
  href: string;
  owner: string;
  roles: readonly Role[];
  description: string;
  /** Short-lived tools are removed (route + catalog entry) in a follow-up PR once used. */
  lifecycle?: "permanent" | "short-lived";
  /** Hidden from navigation (e.g. platform pages reachable from elsewhere). */
  hideFromNav?: boolean;
}

export function visibleTools(user: Pick<SessionUser, "roles"> | null | undefined, tools: readonly ToolDefinition[]): ToolDefinition[] {
  return tools.filter((t) => hasAnyRole(user, t.roles));
}

/** Longest-prefix match of a pathname to the tool that owns it. */
export function toolForPath(pathname: string, tools: readonly ToolDefinition[]): ToolDefinition | undefined {
  return tools
    .filter((t) => pathname === t.href || pathname.startsWith(`${t.href}/`))
    .sort((a, b) => b.href.length - a.href.length)[0];
}
