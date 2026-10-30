// Public by design: the Auth.js sign-in/callback endpoints are the only unauthenticated routes
// (security rule 2 exception "login"). No data is written here except via the audited signIn event.
import { authOptions } from "@fintech/platform/server";
import NextAuth from "next-auth";

const handler = NextAuth(authOptions);

export { handler as GET, handler as POST };
