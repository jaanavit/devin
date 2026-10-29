import { DEMO_IDENTITIES, rolesForGroups } from "@fintech/platform";
import { isMockIdpEnabled } from "@fintech/platform/server";
import { Card, Notice } from "@fintech/platform/ui";
import { UserSwitcher } from "./user-switcher";

export const dynamic = "force-dynamic";

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ callbackUrl?: string; error?: string }> }) {
  const { callbackUrl, error } = await searchParams;
  const safeCallback = callbackUrl?.startsWith("/") && !callbackUrl.startsWith("//") ? callbackUrl : "/";
  const users = DEMO_IDENTITIES.map((i) => ({ sub: i.sub, name: i.name, title: i.title, email: i.email, roles: rolesForGroups(i.groups) }));
  return (
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col justify-center p-8">
      <h1 className="text-2xl font-semibold">Sign in to Internal Tools</h1>
      <p className="mt-1 text-sm text-slate-600">Single sign-on via the company identity provider.</p>
      {error ? (
        <div className="mt-4">
          <Notice tone="danger">Sign-in failed. Try again.</Notice>
        </div>
      ) : null}
      <Card className="mt-6 p-4">
        {isMockIdpEnabled() ? (
          <>
            <p className="mb-3 text-sm text-slate-600">
              <strong>Demo IdP:</strong> pick a user. Roles come from their IdP groups.
            </p>
            <UserSwitcher users={users} callbackUrl={safeCallback} />
          </>
        ) : (
          <Notice tone="warning">The mock identity provider is disabled and no real OIDC provider is configured.</Notice>
        )}
      </Card>
    </main>
  );
}
