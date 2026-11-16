import {
  ArrowRight,
  Calculator,
  Check,
  Download,
  FileSearch,
  Link2,
  MessagesSquare,
  ScanSearch,
  ShieldCheck,
  Upload,
  type LucideIcon,
} from "lucide-react";
import Link from "next/link";
import { Logo } from "@/components/brand/logo";
import { LandingAuthLinks } from "@/components/landing/landing-auth-links";
import { ThemeToggle } from "@/components/layout/theme-toggle";
import { NumberTicker } from "@/components/motion/number-ticker";
import { Reveal } from "@/components/motion/reveal";
import { Button } from "@/components/ui/button";
import sampleReportJson from "@/data/sample-report.json";
import type { ReportContent } from "@/lib/api/types";
import { verificationSummary } from "@/components/reports/verification-badge";
import { formatNumber } from "@/lib/format";

// Real output of the backend for data/sample_sales.csv (src/data/sample-report.json).
const sampleReport = sampleReportJson as unknown as ReportContent;

const STEPS: { icon: LucideIcon; title: string; text: string }[] = [
  {
    icon: Upload,
    title: "Upload a dataset",
    text: "A CSV, TSV, XLSX or XLS file. It is validated, parsed and profiled: column types, missing values, duplicates and a quality score.",
  },
  {
    icon: MessagesSquare,
    title: "Ask a question",
    text: "In plain language. The AI model reads the column names and summary statistics and plans which computations to run.",
  },
  {
    icon: Calculator,
    title: "Tools compute the numbers",
    text: "Aggregations, time series, correlations and other analyses run as deterministic Python and pandas code on your data. You watch each step as it happens.",
  },
  {
    icon: FileSearch,
    title: "Read a verified report",
    text: "The model writes the report from the computed results. Every figure in it is then checked against those results, and any that cannot be traced is flagged.",
  },
];

const FEATURES: { icon: LucideIcon; title: string; text: string }[] = [
  {
    icon: Calculator,
    title: "Computed, not generated",
    text: "Numbers in a report come from deterministic Python and pandas tools. The language model plans and writes; it does not do the arithmetic.",
  },
  {
    icon: ShieldCheck,
    title: "Every figure verified",
    text: "Each figure in the summary, metrics and findings is compared with the computed results. Unverified figures are listed, not hidden.",
  },
  {
    icon: Link2,
    title: "Provenance on every finding",
    text: "Metrics and findings cite evidence records. Open one to see the tool that ran, its arguments and the table it returned.",
  },
  {
    icon: ScanSearch,
    title: "Automatic data profiling",
    text: "On upload you get column kinds, missing-value rates, distinct counts, summary statistics and a list of data-quality issues.",
  },
  {
    icon: MessagesSquare,
    title: "Follow-up questions",
    text: "Keep asking about the same dataset in one conversation. Each answer is a new report with its own evidence.",
  },
  {
    icon: Download,
    title: "Exports",
    text: "Download a report as Markdown, PDF or Excel, and any result table as CSV.",
  },
];

function SectionIntro({
  id,
  eyebrow,
  title,
  text,
}: {
  id: string;
  eyebrow: string;
  title: string;
  text: string;
}) {
  return (
    <Reveal className="max-w-2xl space-y-3">
      <p className="text-gradient w-fit text-xs font-semibold tracking-widest uppercase">
        {eyebrow}
      </p>
      <h2
        id={id}
        className="text-3xl leading-tight font-semibold tracking-tight text-balance sm:text-4xl"
      >
        {title}
      </h2>
      <p className="text-base leading-7 text-pretty text-muted-foreground">{text}</p>
    </Reveal>
  );
}

/**
 * The product's central idea in one picture: a figure, and the computation it came from.
 * Both halves are taken from the sample report shown further down the page.
 */
function HeroProvenance() {
  const metric = sampleReport.key_metrics[0];
  const evidence = sampleReport.methodology.find((record) => record.id === metric?.evidence_ids[0]);
  const table = evidence?.table;
  if (!metric || !evidence || !table) return null;
  const columns = table.columns.slice(0, 3);

  return (
    <figure className="hidden min-w-0 animate-fade-up [animation-delay:150ms] lg:block">
      <div className="relative space-y-3 rounded-2xl border border-border bg-surface/80 p-4 shadow-lg backdrop-blur">
        <div aria-hidden="true" className="border-beam" />
        <div className="rounded-xl border border-border bg-card p-4">
          <p className="text-xs text-muted-foreground">{metric.label}</p>
          <NumberTicker
            value={metric.value}
            className="tabular mt-1 block text-3xl font-semibold tracking-tight"
          />
          <p className="mt-2 flex items-center gap-1.5 text-xs text-muted-foreground">
            Computed in
            <span className="tabular rounded-sm border border-border bg-background px-1.5 py-0.5 font-mono font-medium text-accent-text">
              {evidence.id}
            </span>
          </p>
        </div>
        <div className="overflow-hidden rounded-xl border border-border bg-card">
          <p className="flex items-center gap-2 border-b border-border px-4 py-2.5 text-xs">
            <span className="tabular font-mono font-semibold text-accent-text">{evidence.id}</span>
            <span className="min-w-0 flex-1 truncate font-medium">{evidence.label}</span>
            <span className="rounded-sm bg-muted px-1.5 py-0.5 font-mono text-muted-foreground">
              {evidence.tool}
            </span>
          </p>
          <table className="w-full text-xs">
            <thead>
              <tr className="text-left text-muted-foreground">
                {columns.map((column, index) => (
                  <th
                    key={column}
                    scope="col"
                    className={`px-4 py-2 font-medium ${index > 0 ? "text-right" : ""}`}
                  >
                    {column}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {table.rows.slice(0, 4).map((row, rowIndex) => (
                <tr key={rowIndex} className="border-t border-border">
                  {columns.map((column, index) => {
                    const value = row[index] ?? null;
                    return (
                      <td
                        key={column}
                        className={`px-4 py-2 ${index > 0 ? "tabular text-right" : ""}`}
                      >
                        {typeof value === "number" ? formatNumber(value) : String(value ?? "—")}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="flex items-center gap-2 rounded-lg bg-success-soft px-3 py-2 text-xs font-medium text-success-text">
          <ShieldCheck className="size-3.5 shrink-0" aria-hidden="true" />
          {verificationSummary(sampleReport.verification)}
        </p>
      </div>
      <figcaption className="mt-3 text-xs leading-5 text-muted-foreground">
        A figure from a real report, and the computation behind it.
      </figcaption>
    </figure>
  );
}

const SECTION_LINKS = [
  { href: "#how-it-works", label: "How it works" },
  { href: "#features", label: "Features" },
] as const;

export default function LandingPage() {
  return (
    <div className="flex flex-1 flex-col">
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-50 focus:rounded-md focus:bg-primary focus:px-3 focus:py-2 focus:text-sm focus:font-medium focus:text-primary-foreground"
      >
        Skip to content
      </a>

      <header className="sticky top-0 z-30 border-b border-border bg-background/95 backdrop-blur supports-backdrop-filter:bg-background/80">
        <div className="mx-auto flex h-14 w-full max-w-6xl items-center gap-4 px-4 sm:px-6">
          <Link href="/" className="rounded-md" aria-label="AI Workflow Assistant home">
            <Logo className="[&>span:last-child]:hidden sm:[&>span:last-child]:inline" />
          </Link>
          <nav
            aria-label="Sections"
            className="ml-4 hidden items-center gap-5 text-sm text-muted-foreground md:flex"
          >
            {SECTION_LINKS.map((link) => (
              <a
                key={link.href}
                href={link.href}
                className="rounded-sm transition-colors hover:text-foreground"
              >
                {link.label}
              </a>
            ))}
          </nav>
          <div className="ml-auto flex items-center gap-1.5">
            <ThemeToggle />
            <LandingAuthLinks />
          </div>
        </div>
      </header>

      <main id="main-content" className="flex-1">
        <section className="relative isolate overflow-hidden border-b border-border">
          <div aria-hidden="true" className="bg-dots pointer-events-none absolute inset-0 -z-10" />
          <div
            aria-hidden="true"
            className="bg-glow pointer-events-none absolute -top-56 left-1/2 -z-10 h-[38rem] w-[70rem] max-w-none -translate-x-1/2"
          />
          <div className="mx-auto grid w-full max-w-6xl items-center gap-12 px-4 py-16 sm:px-6 sm:py-28 lg:grid-cols-[minmax(0,1fr)_minmax(0,26rem)]">
            <div className="max-w-3xl space-y-7">
              <p className="inline-flex animate-fade-up items-center gap-2 rounded-full border border-border bg-background/70 py-1 pr-3 pl-1 text-xs font-medium text-muted-foreground shadow-sm backdrop-blur">
                <span className="flex size-5 items-center justify-center rounded-full bg-success-soft">
                  <ShieldCheck className="size-3 text-success-text" aria-hidden="true" />
                </span>
                Every figure traced to a computation
              </p>
              <h1 className="text-4xl leading-[1.05] font-semibold tracking-tight text-balance sm:text-5xl lg:text-6xl">
                Ask questions of your spreadsheet.{" "}
                <span className="text-gradient">Get answers you can check.</span>
              </h1>
              <p className="max-w-2xl text-lg leading-8 text-pretty text-muted-foreground">
                Upload a CSV or Excel file and ask in plain language. An AI model plans the
                analysis, deterministic tools compute every number, and each figure in the report
                links to the calculation behind it.
              </p>
              <div className="flex flex-wrap gap-3">
                <Button size="lg" asChild className="group">
                  <Link href="/register">
                    Get started free
                    <ArrowRight
                      aria-hidden="true"
                      className="transition-transform group-hover:translate-x-0.5"
                    />
                  </Link>
                </Button>
                <Button size="lg" variant="outline" asChild>
                  <a href="#how-it-works">See how it works</a>
                </Button>
              </div>
              <ul className="flex flex-wrap gap-x-5 gap-y-2 text-sm text-muted-foreground">
                {["CSV, TSV, XLSX and XLS", "Free to use", "Charts and exports"].map((item) => (
                  <li key={item} className="flex items-center gap-1.5">
                    <Check className="size-3.5 text-success-text" aria-hidden="true" />
                    {item}
                  </li>
                ))}
              </ul>
            </div>
            <HeroProvenance />
          </div>
        </section>

        <section aria-labelledby="how-it-works" className="border-b border-border">
          <div className="mx-auto w-full max-w-6xl space-y-10 px-4 py-16 sm:px-6">
            <SectionIntro
              id="how-it-works"
              eyebrow="How it works"
              title="The model plans and writes. Code does the maths."
              text="Language models are good at deciding what to look at and explaining what was found. They are unreliable at arithmetic. So the two jobs are kept apart."
            />
            <ol className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              {STEPS.map((step, index) => (
                <li key={step.title}>
                  <Reveal
                    delay={index * 0.08}
                    className="card-interactive relative h-full space-y-3 overflow-hidden rounded-xl border border-border bg-card p-5 shadow-sm"
                  >
                    <span
                      aria-hidden="true"
                      className="tabular pointer-events-none absolute -top-3 right-3 text-7xl font-bold text-muted select-none"
                    >
                      {index + 1}
                    </span>
                    <div className="relative flex items-center gap-3">
                      <span className="flex size-9 items-center justify-center rounded-lg bg-brand-soft text-accent-text ring-1 ring-border">
                        <step.icon className="size-4" aria-hidden="true" />
                      </span>
                      <span className="tabular text-xs font-medium text-muted-foreground">
                        Step {index + 1}
                      </span>
                    </div>
                    <h3 className="relative text-sm font-semibold">{step.title}</h3>
                    <p className="relative text-sm leading-6 text-muted-foreground">{step.text}</p>
                  </Reveal>
                </li>
              ))}
            </ol>
          </div>
        </section>

        <section aria-labelledby="features" className="border-b border-border">
          <div className="mx-auto w-full max-w-6xl space-y-10 px-4 py-16 sm:px-6">
            <SectionIntro
              id="features"
              eyebrow="What you get"
              title="A report you can audit"
              text="Not a chat transcript: a structured report with metrics, findings, charts, recommendations and the full method behind them."
            />
            <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {FEATURES.map((feature, index) => (
                <li key={feature.title}>
                  <Reveal
                    delay={(index % 3) * 0.08}
                    className="card-interactive group relative h-full space-y-3 overflow-hidden rounded-xl border border-border bg-card p-6 shadow-sm"
                  >
                    <div
                      aria-hidden="true"
                      className="bg-glow pointer-events-none absolute -top-16 -right-16 size-40 opacity-0 transition-opacity duration-300 group-hover:opacity-100"
                    />
                    <span className="bg-brand-gradient relative flex size-10 items-center justify-center rounded-lg text-primary-foreground shadow-sm">
                      <feature.icon className="size-5" aria-hidden="true" />
                    </span>
                    <h3 className="relative text-base font-semibold">{feature.title}</h3>
                    <p className="relative text-sm leading-6 text-muted-foreground">
                      {feature.text}
                    </p>
                  </Reveal>
                </li>
              ))}
            </ul>
          </div>
        </section>

        <section aria-labelledby="cta">
          <div className="mx-auto w-full max-w-6xl px-4 py-16 sm:px-6 sm:py-24">
            <Reveal className="relative isolate overflow-hidden rounded-3xl border border-border bg-card px-6 py-14 text-center shadow-lg sm:px-12">
              <div
                aria-hidden="true"
                className="bg-dots pointer-events-none absolute inset-0 -z-10"
              />
              <div
                aria-hidden="true"
                className="bg-glow pointer-events-none absolute -bottom-40 left-1/2 -z-10 h-[28rem] w-[48rem] max-w-none -translate-x-1/2"
              />
              <h2
                id="cta"
                className="mx-auto max-w-2xl text-3xl leading-tight font-semibold tracking-tight text-balance sm:text-4xl"
              >
                Try it on <span className="text-gradient">your own data</span>
              </h2>
              <p className="mx-auto mt-4 max-w-xl text-base leading-7 text-pretty text-muted-foreground">
                Create an account, upload a file or use the sample dataset, and ask your first
                question. An analysis usually takes one to two minutes.
              </p>
              <div className="mt-8 flex flex-wrap justify-center gap-3">
                <Button size="lg" asChild className="group">
                  <Link href="/register">
                    Create an account
                    <ArrowRight
                      aria-hidden="true"
                      className="transition-transform group-hover:translate-x-0.5"
                    />
                  </Link>
                </Button>
                <Button size="lg" variant="outline" asChild>
                  <Link href="/login">Sign in</Link>
                </Button>
              </div>
            </Reveal>
          </div>
        </section>
      </main>

      <footer className="border-t border-border">
        <div className="mx-auto flex w-full max-w-6xl flex-col gap-4 px-4 py-8 text-sm text-muted-foreground sm:flex-row sm:items-center sm:justify-between sm:px-6">
          <Logo className="text-foreground" />
          <nav aria-label="Footer" className="flex flex-wrap gap-x-5 gap-y-2">
            {SECTION_LINKS.map((link) => (
              <a
                key={link.href}
                href={link.href}
                className="rounded-sm transition-colors hover:text-foreground"
              >
                {link.label}
              </a>
            ))}
            <Link href="/login" className="rounded-sm transition-colors hover:text-foreground">
              Sign in
            </Link>
            <Link href="/register" className="rounded-sm transition-colors hover:text-foreground">
              Create an account
            </Link>
          </nav>
        </div>
      </footer>
    </div>
  );
}
