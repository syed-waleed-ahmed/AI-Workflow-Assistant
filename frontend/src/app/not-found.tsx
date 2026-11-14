import { Compass } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { Logo } from "@/components/brand/logo";
import { Button } from "@/components/ui/button";

export const metadata: Metadata = { title: "Page not found" };

export default function NotFound() {
  return (
    <div className="flex min-h-dvh flex-1 flex-col">
      <header className="flex h-14 items-center px-4 sm:px-6">
        <Link href="/" className="rounded-md">
          <Logo />
        </Link>
      </header>
      <main className="flex flex-1 flex-col items-center justify-center gap-4 px-4 pb-24 text-center">
        <span className="flex size-10 items-center justify-center rounded-md bg-muted text-muted-foreground">
          <Compass className="size-5" aria-hidden="true" />
        </span>
        <div className="space-y-1">
          <p className="tabular text-sm font-medium text-muted-foreground">404</p>
          <h1 className="text-xl font-semibold tracking-tight">Page not found</h1>
          <p className="max-w-sm text-sm leading-6 text-muted-foreground">
            The page you are looking for does not exist or has been moved.
          </p>
        </div>
        <div className="flex flex-wrap justify-center gap-2">
          <Button asChild size="sm">
            <Link href="/app">Go to the dashboard</Link>
          </Button>
          <Button asChild size="sm" variant="outline">
            <Link href="/">Home</Link>
          </Button>
        </div>
      </main>
    </div>
  );
}
