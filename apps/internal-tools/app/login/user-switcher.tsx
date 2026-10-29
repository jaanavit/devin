"use client";

import { Badge } from "@fintech/platform/ui";
import { signIn } from "next-auth/react";
import { useState } from "react";

interface DemoUser {
  sub: string;
  name: string;
  title: string;
  email: string;
  roles: string[];
}

export function UserSwitcher({ users, callbackUrl }: { users: DemoUser[]; callbackUrl: string }) {
  const [pending, setPending] = useState<string | null>(null);
  return (
    <ul className="divide-y divide-slate-100">
      {users.map((u) => (
        <li key={u.sub}>
          <button
            type="button"
            disabled={pending !== null}
            onClick={() => {
              setPending(u.sub);
              void signIn("mock-oidc", { sub: u.sub, callbackUrl });
            }}
            className="flex w-full items-center justify-between gap-4 rounded px-2 py-3 text-left hover:bg-slate-50 disabled:opacity-60"
          >
            <span>
              <span className="block font-medium">{u.name}</span>
              <span className="block text-xs text-slate-500">
                {u.title} · {u.email}
              </span>
            </span>
            <span className="flex gap-1">
              {u.roles.map((r) => (
                <Badge key={r} tone={r === "Admin" ? "danger" : r === "Reviewer" ? "warning" : "info"}>
                  {r}
                </Badge>
              ))}
              {pending === u.sub ? <span className="text-xs text-slate-500">Signing in…</span> : null}
            </span>
          </button>
        </li>
      ))}
    </ul>
  );
}
