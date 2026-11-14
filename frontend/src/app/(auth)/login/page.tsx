import type { Metadata } from "next";
import { Suspense } from "react";
import { LoginForm } from "@/components/auth/login-form";

export const metadata: Metadata = { title: "Sign in" };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

function first(value: string | string[] | undefined): string | null {
  return (Array.isArray(value) ? value[0] : value) ?? null;
}

/** Reads the query string at request time; everything around it is prerendered. */
async function LoginFormWithParams({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams;
  return <LoginForm nextPath={first(params.next)} expired={params.expired !== undefined} />;
}

export default function LoginPage({ searchParams }: { searchParams: SearchParams }) {
  return (
    <div className="w-full max-w-sm animate-fade-up rounded-2xl border border-border bg-card/90 p-7 shadow-lg backdrop-blur">
      <div className="mb-6 space-y-1">
        <h1 className="text-xl font-semibold tracking-tight">Sign in</h1>
        <p className="text-sm text-muted-foreground">Continue to your datasets and reports.</p>
      </div>
      <Suspense fallback={<LoginForm />}>
        <LoginFormWithParams searchParams={searchParams} />
      </Suspense>
    </div>
  );
}
