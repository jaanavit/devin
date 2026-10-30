import { prisma } from "@fintech/models";
import type { Role } from "@fintech/models/shared";
import type { NextAuthOptions } from "next-auth";
import CredentialsProvider from "next-auth/providers/credentials";
import { audit } from "../audit";
import { findIdentity, rolesForGroups, type IdpIdentity } from "./mock-idp";
import type {} from "./next-auth-augment";

export function isMockIdpEnabled(): boolean {
  return process.env.MOCK_IDP_ENABLED === "true";
}

async function syncUserFromIdp(identity: IdpIdentity, roles: Role[]): Promise<void> {
  const data = { email: identity.email, name: identity.name, roles, idpGroups: identity.groups };
  await prisma.user.upsert({ where: { id: identity.sub }, create: { id: identity.sub, ...data }, update: data });
}

/**
 * Auth.js configuration. The "mock-oidc" provider simulates an OIDC IdP: it resolves a directory
 * identity (sub, email, name, groups) and maps IdP groups to platform roles. Swap it for a real
 * OIDC provider (e.g. AzureAD/Okta) and keep `rolesForGroups` for the group mapping.
 */
export const authOptions: NextAuthOptions = {
  secret: process.env.NEXTAUTH_SECRET,
  session: { strategy: "jwt", maxAge: 8 * 60 * 60 },
  pages: { signIn: "/login" },
  providers: [
    CredentialsProvider({
      id: "mock-oidc",
      name: "Mock OIDC (demo)",
      credentials: { sub: { label: "Subject", type: "text" } },
      async authorize(credentials) {
        if (!isMockIdpEnabled()) return null;
        const identity = findIdentity(credentials?.sub);
        if (!identity) return null;
        const roles = rolesForGroups(identity.groups);
        await syncUserFromIdp(identity, roles);
        return { id: identity.sub, email: identity.email, name: identity.name, roles };
      },
    }),
  ],
  callbacks: {
    jwt({ token, user }) {
      if (user) {
        token.sub = user.id;
        token.roles = user.roles;
      }
      return token;
    },
    session({ session, token }) {
      session.user = {
        id: token.sub ?? "",
        email: token.email ?? "",
        name: token.name ?? "",
        roles: token.roles ?? [],
      };
      return session;
    },
  },
  events: {
    async signIn({ user }) {
      await audit(
        { id: user.id, email: user.email ?? "", name: user.name ?? "", roles: user.roles ?? [] },
        { action: "auth.sign_in", entityType: "User", entityId: user.id, metadata: { provider: "mock-oidc" } },
      );
    },
  },
};
