import type { SessionUser } from "@fintech/models/shared";
import Link from "next/link";
import type { ReactNode } from "react";
import type { ToolDefinition } from "../catalog";
import { NavLinks, SignOutButton } from "./client-nav";

/** Application chrome with role-aware navigation. Pass only the tools the user may see. */
export function AppShell({ user, nav, children }: { user: SessionUser; nav: readonly ToolDefinition[]; children: ReactNode }) {
  return (
    <div className="flex min-h-screen">
      <aside className="flex w-60 shrink-0 flex-col border-r border-slate-200 bg-white">
        <Link href="/" className="border-b border-slate-200 px-4 py-4 text-base font-semibold">
          Internal Tools
        </Link>
        <NavLinks items={nav.filter((t) => !t.hideFromNav).map((t) => ({ href: t.href, label: t.name }))} />
        <div className="mt-auto border-t border-slate-200 p-4 text-sm">
          <div className="font-medium">{user.name}</div>
          <div className="text-xs text-slate-500">{user.roles.join(", ") || "No roles"}</div>
          <SignOutButton />
        </div>
      </aside>
      <main className="min-w-0 flex-1 p-8">{children}</main>
    </div>
  );
}
