"use client";

import {
  CircleUser,
  Database,
  FileText,
  LayoutDashboard,
  LogOut,
  Menu,
  MessagesSquare,
  Plus,
  Settings,
  type LucideIcon,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Suspense, useState, type ReactNode } from "react";
import { toast } from "sonner";
import { Logo } from "@/components/brand/logo";
import { ClientOnly } from "@/components/common/client-only";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Progress } from "@/components/ui/progress";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { hardNavigate } from "@/lib/navigation";
import { useLogout, useMe, useUsage } from "@/lib/query/hooks";
import { cn } from "@/lib/utils";
import { ThemeToggle } from "./theme-toggle";

interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
  /** Matches only the exact path (the dashboard), not everything below it. */
  exact?: boolean;
}

const NAV_ITEMS: readonly NavItem[] = [
  { href: "/app", label: "Dashboard", icon: LayoutDashboard, exact: true },
  { href: "/app/datasets", label: "Datasets", icon: Database },
  { href: "/app/analyses", label: "Analyses", icon: MessagesSquare },
  { href: "/app/reports", label: "Reports", icon: FileText },
  { href: "/app/settings", label: "Settings", icon: Settings },
];

function isActive(item: NavItem, pathname: string | null): boolean {
  if (!pathname) return false;
  return item.exact
    ? pathname === item.href
    : pathname === item.href || pathname.startsWith(`${item.href}/`);
}

function NavList({ pathname, onNavigate }: { pathname: string | null; onNavigate?: () => void }) {
  return (
    <ul className="flex flex-col gap-0.5">
      {NAV_ITEMS.map((item) => {
        const active = isActive(item, pathname);
        const Icon = item.icon;
        return (
          <li key={item.href}>
            <Link
              href={item.href}
              onClick={onNavigate}
              aria-current={active ? "page" : undefined}
              className={cn(
                "flex h-9 items-center gap-2.5 rounded-md px-2.5 text-sm transition-colors",
                active
                  ? "bg-muted font-medium text-foreground"
                  : "text-muted-foreground hover:bg-muted hover:text-foreground",
              )}
            >
              <Icon className="size-4 shrink-0" aria-hidden="true" />
              {item.label}
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

function ActiveNavList({ onNavigate }: { onNavigate?: () => void }) {
  return <NavList pathname={usePathname()} onNavigate={onNavigate} />;
}

/** The current path is only known per request, so the highlighted item streams in. */
function Navigation({ onNavigate }: { onNavigate?: () => void }) {
  return (
    <Suspense fallback={<NavList pathname={null} onNavigate={onNavigate} />}>
      <ActiveNavList onNavigate={onNavigate} />
    </Suspense>
  );
}

function SidebarUsage() {
  const usage = useUsage();
  if (!usage.data) return null;
  const { analyses_today: used, daily_analysis_limit: limit } = usage.data;
  const percent = limit > 0 ? (used / limit) * 100 : 0;
  return (
    <div className="space-y-1.5 rounded-md border border-border bg-background p-3">
      <p className="flex items-baseline justify-between text-xs">
        <span className="text-muted-foreground">Analyses (24h)</span>
        <span className="tabular font-medium">
          {used} of {limit}
        </span>
      </p>
      <Progress
        value={percent}
        tone={percent >= 100 ? "danger" : percent >= 80 ? "warning" : "primary"}
        aria-label={`Analyses used in the last 24 hours: ${used} of ${limit}`}
      />
    </div>
  );
}

function SidebarContent({ onNavigate }: { onNavigate?: () => void }) {
  return (
    <div className="flex h-full flex-col gap-4 p-3">
      <Link href="/app" onClick={onNavigate} className="flex h-9 items-center rounded-md px-1.5">
        <Logo />
      </Link>
      <Button asChild size="sm" className="w-full">
        <Link href="/app/analyses/new" onClick={onNavigate}>
          <Plus aria-hidden="true" />
          New analysis
        </Link>
      </Button>
      <nav aria-label="Main" className="flex-1 overflow-y-auto">
        <Navigation onNavigate={onNavigate} />
      </nav>
      <ClientOnly>
        <SidebarUsage />
      </ClientOnly>
    </div>
  );
}

function UserMenu() {
  const me = useMe();
  const logout = useLogout();

  const signOut = () =>
    logout.mutate(undefined, {
      onSuccess: () => hardNavigate("/login"),
      onError: () => toast.error("You could not be signed out. Please try again."),
    });

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label="Account menu"
          className="flex size-8 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        >
          <CircleUser className="size-5" aria-hidden="true" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-60">
        {me.data ? (
          <>
            <DropdownMenuLabel className="space-y-0.5">
              <span className="block truncate text-sm font-medium text-foreground">
                {me.data.name}
              </span>
              <span className="block truncate font-normal">{me.data.email}</span>
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
          </>
        ) : null}
        <DropdownMenuItem asChild>
          <Link href="/app/settings">
            <Settings aria-hidden="true" />
            Settings
          </Link>
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={signOut} disabled={logout.isPending}>
          <LogOut aria-hidden="true" />
          Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** The signed-in frame: sidebar on wide screens, a drawer on narrow ones, and a top bar. */
export function AppShell({ children }: { children: ReactNode }) {
  const [drawerOpen, setDrawerOpen] = useState(false);
  return (
    <div className="flex min-h-dvh flex-1">
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-70 focus:rounded-md focus:bg-primary focus:px-3 focus:py-2 focus:text-sm focus:font-medium focus:text-primary-foreground"
      >
        Skip to content
      </a>

      <aside
        data-print="hide"
        className="sticky top-0 hidden h-dvh w-60 shrink-0 border-r border-border bg-surface lg:block"
      >
        <SidebarContent />
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header
          data-print="hide"
          className="sticky top-0 z-30 flex h-14 shrink-0 items-center gap-2 border-b border-border bg-background/95 px-4 backdrop-blur supports-backdrop-filter:bg-background/80 sm:px-6"
        >
          <Sheet open={drawerOpen} onOpenChange={setDrawerOpen}>
            <SheetTrigger asChild>
              <Button
                variant="ghost"
                size="icon-sm"
                className="lg:hidden"
                aria-label="Open navigation"
              >
                <Menu aria-hidden="true" />
              </Button>
            </SheetTrigger>
            <SheetContent>
              <SheetTitle className="sr-only">Navigation</SheetTitle>
              <SheetDescription className="sr-only">
                Move between the sections of the app.
              </SheetDescription>
              <SidebarContent onNavigate={() => setDrawerOpen(false)} />
            </SheetContent>
          </Sheet>
          <Link
            href="/app"
            className="rounded-md lg:hidden"
            aria-label="AI Workflow Assistant dashboard"
          >
            <Logo className="[&>span:last-child]:hidden sm:[&>span:last-child]:inline" />
          </Link>
          <div className="ml-auto flex items-center gap-1.5">
            <ThemeToggle />
            <UserMenu />
          </div>
        </header>

        <main id="main-content" tabIndex={-1} className="flex min-w-0 flex-1 flex-col outline-none">
          {children}
        </main>
      </div>
    </div>
  );
}
