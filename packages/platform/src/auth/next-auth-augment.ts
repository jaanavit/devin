import type { Role } from "@fintech/models/shared";

declare module "next-auth" {
  interface User {
    roles?: Role[];
  }
  interface Session {
    user: { id: string; email: string; name: string; roles: Role[] };
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    roles?: Role[];
  }
}
