import Link from "next/link";

export default function Forbidden() {
  return (
    <main className="mx-auto max-w-xl p-8">
      <h1 className="text-2xl font-semibold">403 — Access denied</h1>
      <p className="mt-2 text-slate-600">Your roles do not grant access to this page. Ask your manager to request access via the IdP group.</p>
      <Link href="/" className="mt-4 inline-block text-sm font-medium hover:underline">
        Back to the app catalog
      </Link>
    </main>
  );
}
