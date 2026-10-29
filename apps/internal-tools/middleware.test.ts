import { visibleTools } from "@fintech/platform";
import { demoUsers } from "@fintech/platform/testing";
import type { SessionUser } from "@fintech/models";
import { getToken } from "next-auth/jwt";
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { TOOLS } from "./lib/catalog";
import { middleware } from "./middleware";

vi.mock("next-auth/jwt", () => ({ getToken: vi.fn() }));
const mockedGetToken = vi.mocked(getToken);

function signInAs(user: SessionUser | null) {
  mockedGetToken.mockResolvedValue(user ? ({ sub: user.id, email: user.email, roles: user.roles } as never) : null);
}

const req = (path: string) => new NextRequest(new URL(path, "http://localhost:3000"));

beforeEach(() => mockedGetToken.mockReset());

describe("middleware (deny by default)", () => {
  it("leaves only the login and auth endpoints public", async () => {
    signInAs(null);
    expect((await middleware(req("/login"))).headers.get("x-middleware-next")).toBe("1");
    expect((await middleware(req("/api/auth/session"))).headers.get("x-middleware-next")).toBe("1");
    const res = await middleware(req("/"));
    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toContain("/login?callbackUrl=%2F");
  });

  it("returns 401 JSON for anonymous API calls", async () => {
    signInAs(null);
    expect((await middleware(req("/api/anything"))).status).toBe(401);
  });

  describe.each(Object.entries(demoUsers))("%s", (_name, user) => {
    it("is allowed on its own tools and gets 403 on every other tool", async () => {
      signInAs(user);
      const allowed = new Set(visibleTools(user, TOOLS).map((t) => t.slug));
      for (const tool of TOOLS) {
        const res = await middleware(req(`${tool.href}/some/sub/path`));
        if (allowed.has(tool.slug)) expect(res.status, tool.slug).toBe(200);
        else expect(res.status, tool.slug).toBe(403);
      }
    });
  });

  it("gives Analysts and Reviewers 403 on the Admin-only audit log", async () => {
    for (const user of [demoUsers.alice, demoUsers.rita]) {
      signInAs(user);
      expect((await middleware(req("/audit"))).status).toBe(403);
    }
    signInAs(demoUsers.ada);
    expect((await middleware(req("/audit"))).status).toBe(200);
  });
});
