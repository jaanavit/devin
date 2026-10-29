import { visibleTools } from "@fintech/platform";
import { requirePageRole } from "@fintech/platform/server";
import { AppShell } from "@fintech/platform/ui";
import type { ReactNode } from "react";
import { CATALOG_ROLES, TOOLS } from "@/lib/catalog";

export const dynamic = "force-dynamic";

export default async function ToolsLayout({ children }: { children: ReactNode }) {
  const user = await requirePageRole(CATALOG_ROLES);
  return (
    <AppShell user={user} nav={visibleTools(user, TOOLS)}>
      {children}
    </AppShell>
  );
}
