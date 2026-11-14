import type { Metadata } from "next";
import { Suspense } from "react";
import { RegisterForm } from "@/components/auth/register-form";

export const metadata: Metadata = { title: "Create an account" };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

async function RegisterFormWithParams({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams;
  const next = Array.isArray(params.next) ? params.next[0] : params.next;
  return <RegisterForm nextPath={next ?? null} />;
}

export default function RegisterPage({ searchParams }: { searchParams: SearchParams }) {
  return (
    <div className="w-full max-w-sm animate-fade-up rounded-2xl border border-border bg-card/90 p-7 shadow-lg backdrop-blur">
      <div className="mb-6 space-y-1">
        <h1 className="text-xl font-semibold tracking-tight">Create an account</h1>
        <p className="text-sm text-muted-foreground">
          Free to use, with daily limits. Your datasets stay private to your account.
        </p>
      </div>
      <Suspense fallback={<RegisterForm />}>
        <RegisterFormWithParams searchParams={searchParams} />
      </Suspense>
    </div>
  );
}
