import { hasAnyRole, toolForPath } from "@fintech/platform";
import type { Role } from "@fintech/models/shared";
import { getToken } from "next-auth/jwt";
import { NextResponse, type NextRequest } from "next/server";
import { TOOLS } from "./lib/catalog";

const PUBLIC_PATHS = ["/login", "/api/auth"];

/**
 * Edge gate (defense in depth): deny by default. Anonymous users are sent to /login (or get 401
 * for APIs); users lacking a tool's roles get HTTP 403. Pages/actions re-check with requireRole().
 */
export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  if (PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`))) return NextResponse.next();

  const token = await getToken({ req, secret: process.env.NEXTAUTH_SECRET });
  const isApi = pathname.startsWith("/api/");
  if (!token?.sub) {
    if (isApi) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
    const url = new URL("/login", req.url);
    url.searchParams.set("callbackUrl", pathname);
    return NextResponse.redirect(url);
  }

  const tool = toolForPath(pathname.replace(/^\/api/, ""), TOOLS);
  if (tool && !hasAnyRole({ roles: (token.roles ?? []) as Role[] }, tool.roles)) {
    if (isApi) return NextResponse.json({ error: "forbidden" }, { status: 403 });
    return NextResponse.rewrite(new URL("/403", req.url), { status: 403 });
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
