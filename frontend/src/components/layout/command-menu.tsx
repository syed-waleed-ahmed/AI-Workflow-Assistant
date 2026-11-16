"use client";

import {
  Database,
  LayoutDashboard,
  LogOut,
  MessagesSquare,
  Search,
  Settings,
  Sparkles,
  Upload,
  type LucideIcon,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useTheme } from "next-themes";
import { useEffect, useState, useSyncExternalStore, type ReactNode } from "react";
import { toast } from "sonner";
import { StatusBadge } from "@/components/analyses/status-badge";
import { UploadDialog } from "@/components/datasets/upload-dialog";
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
  CommandShortcut,
} from "@/components/ui/command";
import { formatInteger } from "@/lib/format";
import { useAnalyses, useDatasets } from "@/lib/query/hooks";
import { cn } from "@/lib/utils";
import { THEME_OPTIONS } from "./theme-toggle";
import { useSignOut } from "./use-sign-out";

const PAGES: { href: string; label: string; icon: LucideIcon }[] = [
  { href: "/app", label: "Dashboard", icon: LayoutDashboard },
  { href: "/app/datasets", label: "Datasets", icon: Database },
  { href: "/app/analyses", label: "Analyses", icon: MessagesSquare },
  { href: "/app/settings", label: "Settings", icon: Settings },
];

const noopSubscribe = () => () => undefined;

/** "⌘" on Apple platforms, "Ctrl" elsewhere. Only known in the browser. */
function useModifierLabel(): string {
  return useSyncExternalStore(
    noopSubscribe,
    () => (/Mac|iPhone|iPad/.test(navigator.userAgent) ? "⌘" : "Ctrl"),
    () => "Ctrl",
  );
}

/**
 * A titled group while browsing; flat while searching. cmdk ranks loose items by how well they
 * match, but (as of 1.1.1) never reorders groups, so a grouped list would keep the best match
 * below weaker ones and Enter would pick the wrong item.
 */
function Section({
  heading,
  flat,
  children,
}: {
  heading: string;
  flat: boolean;
  children: ReactNode;
}) {
  return flat ? <>{children}</> : <CommandGroup heading={heading}>{children}</CommandGroup>;
}

/**
 * Items that need data. Rendered only while the palette is open, so the queries run on demand
 * (and usually hit the cache the dashboard already filled).
 */
function RecentItems({ go, flat }: { go: (href: string) => void; flat: boolean }) {
  const analyses = useAnalyses({ limit: 5 });
  const datasets = useDatasets({ limit: 5 });
  const recentAnalyses = analyses.data?.items ?? [];
  const recentDatasets = datasets.data?.items ?? [];
  return (
    <>
      {recentAnalyses.length > 0 ? (
        <Section heading="Recent analyses" flat={flat}>
          {recentAnalyses.map((analysis) => (
            <CommandItem
              key={analysis.id}
              // The title leads so it ranks first; the id keeps two equal titles apart.
              value={`${analysis.title} ${analysis.id}`}
              keywords={[analysis.dataset_name, "analysis"]}
              onSelect={() => go(`/app/analyses/${analysis.id}`)}
            >
              <MessagesSquare aria-hidden="true" />
              <span className="min-w-0 flex-1 truncate">{analysis.title}</span>
              <StatusBadge status={analysis.status} />
            </CommandItem>
          ))}
        </Section>
      ) : null}
      {recentDatasets.length > 0 ? (
        <Section heading="Datasets" flat={flat}>
          {recentDatasets.map((dataset) => (
            <CommandItem
              key={dataset.id}
              value={`${dataset.name} ${dataset.id}`}
              keywords={[dataset.original_filename, "dataset"]}
              onSelect={() => go(`/app/datasets/${dataset.id}`)}
            >
              <Database aria-hidden="true" />
              <span className="min-w-0 flex-1 truncate">{dataset.name}</span>
              <CommandShortcut className="tabular tracking-normal">
                {formatInteger(dataset.row_count)} rows
              </CommandShortcut>
            </CommandItem>
          ))}
        </Section>
      ) : null}
    </>
  );
}

/**
 * The app-wide command palette: jump to a page, a recent analysis or a dataset, start work,
 * switch theme or sign out. Opens with Ctrl+K / ⌘K or the search button in the top bar.
 */
export function CommandMenu({ className }: { className?: string }) {
  const router = useRouter();
  const { setTheme } = useTheme();
  const { signOut } = useSignOut();
  const modifier = useModifierLabel();
  const [open, setOpenState] = useState(false);
  const [search, setSearch] = useState("");
  const [uploadOpen, setUploadOpen] = useState(false);
  const flat = search.trim().length > 0;

  const setOpen = (next: boolean) => {
    setOpenState(next);
    if (!next) setSearch("");
  };

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key.toLowerCase() === "k" && (event.metaKey || event.ctrlKey)) {
        event.preventDefault();
        setOpenState((current) => !current);
        setSearch("");
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, []);

  /** Closes the palette, then runs the action. */
  const run = (action: () => void) => {
    setOpen(false);
    action();
  };
  const go = (href: string) => run(() => router.push(href));

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Search and commands"
        aria-keyshortcuts="Control+K Meta+K"
        className={cn(
          "inline-flex h-8 items-center gap-2 rounded-md border border-border bg-surface px-2.5 text-sm text-muted-foreground shadow-sm transition-colors hover:bg-muted hover:text-foreground",
          className,
        )}
      >
        <Search className="size-4 shrink-0" aria-hidden="true" />
        <span className="hidden flex-1 text-left sm:inline">Search or jump to…</span>
        <kbd className="hidden items-center gap-0.5 rounded border border-border bg-background px-1.5 py-0.5 font-sans text-[10px] font-medium sm:inline-flex">
          {modifier}
          <span>K</span>
        </kbd>
      </button>

      <CommandDialog
        open={open}
        onOpenChange={setOpen}
        title="Search and commands"
        description="Jump to a page, an analysis or a dataset, or run a command."
      >
        <CommandInput
          value={search}
          onValueChange={setSearch}
          placeholder="Search pages, analyses, datasets and commands…"
        />
        <CommandList>
          <CommandEmpty>No results.</CommandEmpty>
          <Section heading="Actions" flat={flat}>
            <CommandItem
              value="New analysis"
              keywords={["ask", "question", "start"]}
              onSelect={() => go("/app/analyses/new")}
            >
              <Sparkles aria-hidden="true" />
              New analysis
            </CommandItem>
            <CommandItem
              value="Upload a dataset"
              keywords={["file", "csv", "excel"]}
              onSelect={() => run(() => setUploadOpen(true))}
            >
              <Upload aria-hidden="true" />
              Upload a dataset
            </CommandItem>
          </Section>
          <Section heading="Go to" flat={flat}>
            {PAGES.map((page) => (
              <CommandItem
                key={page.href}
                value={page.label}
                keywords={["go to", "page"]}
                onSelect={() => go(page.href)}
              >
                <page.icon aria-hidden="true" />
                {page.label}
              </CommandItem>
            ))}
          </Section>
          <RecentItems go={go} flat={flat} />
          {flat ? null : <CommandSeparator />}
          <Section heading="Theme" flat={flat}>
            {THEME_OPTIONS.map(({ value, label, icon: Icon }) => (
              <CommandItem
                key={value}
                value={`${label} theme`}
                keywords={["mode", "appearance"]}
                onSelect={() => run(() => setTheme(value))}
              >
                <Icon aria-hidden="true" />
                {label} theme
              </CommandItem>
            ))}
          </Section>
          <Section heading="Account" flat={flat}>
            <CommandItem value="Sign out" keywords={["log out"]} onSelect={() => run(signOut)}>
              <LogOut aria-hidden="true" />
              Sign out
            </CommandItem>
          </Section>
        </CommandList>
      </CommandDialog>

      <UploadDialog
        open={uploadOpen}
        onOpenChange={setUploadOpen}
        onUploaded={(dataset) => {
          toast.success(`Uploaded “${dataset.name}”`);
          router.push(`/app/datasets/${dataset.id}`);
        }}
      />
    </>
  );
}
