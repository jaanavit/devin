"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { signOut } from "next-auth/react";
import { cn } from "./cn";

export function NavLinks({ items }: { items: readonly { href: string; label: string }[] }) {
  const pathname = usePathname();
  return (
    <nav className="flex flex-col gap-1 p-2" aria-label="Tools">
      <Link href="/" className={cn("rounded-md px-3 py-2 text-sm", pathname === "/" ? "bg-slate-100 font-medium" : "hover:bg-slate-50")}>
        App catalog
      </Link>
      {items.map((item) => {
        const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
        return (
          <Link key={item.href} href={item.href} className={cn("rounded-md px-3 py-2 text-sm", active ? "bg-slate-100 font-medium" : "hover:bg-slate-50")}>
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}

export function SignOutButton() {
  return (
    <button type="button" onClick={() => void signOut({ callbackUrl: "/login" })} className="mt-2 text-xs text-slate-600 hover:underline">
      Sign out / switch user
    </button>
  );
}
