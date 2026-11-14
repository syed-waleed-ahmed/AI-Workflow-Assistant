import {
  ArrowRight,
  Calculator,
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
import { ReportView } from "@/components/reports/report-view";
import { Button } from "@/components/ui/button";
import sampleReportJson from "@/data/sample-report.json";
import type { ReportContent } from "@/lib/api/types";
import { verificationSummary } from "@/components/reports/verification-badge";
import { formatInteger, formatNumber } from "@/lib/format";

// Real output of the backend for data/sample_sales.csv, copied from docs/sample-report.json.
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

const SECURITY: { title: string; text: string }[] = [
  {
    title: "Private to your account",
    text: "Datasets, analyses and reports can only be read by the account that created them. This is enforced on the server for every request.",
  },
  {
    title: "What the AI model sees",
    text: "The model is an open-weight model hosted by Groq. Column names, summary statistics and aggregated results are sent to it to plan the analysis and write the report. The whole file is not sent.",
  },
  {
    title: "Uploads are validated",
    text: "Files are checked before they are stored, and spreadsheet formulas and macros are never executed.",
  },
  {
    title: "Sign-in",
    text: "Passwords are hashed with Argon2id. Sessions use HttpOnly cookies, and requests that change data are protected against cross-site request forgery.",
  },
  {
    title: "You can delete everything",
    text: "Delete individual datasets and reports, or your whole account with all of its data, from inside the app.",
  },
  {
    title: "Free-tier infrastructure",
    text: "This app runs on free hosting with daily usage limits, which are shown in the app. After a period of inactivity the first request can take up to a minute while the server wakes up.",
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
    <div className="max-w-2xl space-y-2">
      <p className="text-sm font-medium text-accent-text">{eyebrow}</p>
      <h2 id={id} className="text-2xl leading-8 font-semibold tracking-tight">
        {title}
      </h2>
      <p className="text-base leading-7 text-muted-foreground">{text}</p>
    </div>
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
    <figure className="hidden min-w-0 lg:block">
      <div className="space-y-3 rounded-xl border border-border bg-surface p-4 shadow-sm">
        <div className="rounded-lg border border-border bg-card p-4">
          <p className="text-xs text-muted-foreground">{metric.label}</p>
          <p className="tabular mt-1 text-2xl font-semibold tracking-tight">{metric.value}</p>
          <p className="mt-2 flex items-center gap-1.5 text-xs text-muted-foreground">
            Computed in
            <span className="tabular rounded-sm border border-border bg-background px-1.5 py-0.5 font-mono font-medium text-accent-text">
              {evidence.id}
            </span>
          </p>
        </div>
        <div className="rounded-lg border border-border bg-card">
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
        <p className="flex items-center gap-2 rounded-md bg-success-soft px-3 py-2 text-xs font-medium text-success-text">
          <ShieldCheck className="size-3.5 shrink-0" aria-hidden="true" />
          {verificationSummary(sampleReport.verification)}
        </p>
      </div>
      <figcaption className="mt-3 text-xs leading-5 text-muted-foreground">
        A figure and the computation behind it, taken from the{" "}
        <a
          href="#example"
          className="font-medium text-accent-text underline-offset-4 hover:underline"
        >
          sample report
        </a>{" "}
        below.
      </figcaption>
    </figure>
  );
}

export default function LandingPage() {
  const overview = sampleReport.dataset_overview;
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
            <a href="#how-it-works" className="rounded-sm transition-colors hover:text-foreground">
              How it works
            </a>
            <a href="#example" className="rounded-sm transition-colors hover:text-foreground">
              Example report
            </a>
            <a href="#security" className="rounded-sm transition-colors hover:text-foreground">
              Privacy and security
            </a>
          </nav>
          <div className="ml-auto flex items-center gap-1.5">
            <ThemeToggle />
            <LandingAuthLinks />
          </div>
        </div>
      </header>

      <main id="main-content" className="flex-1">
        <section className="border-b border-border">
          <div className="mx-auto grid w-full max-w-6xl items-center gap-12 px-4 py-16 sm:px-6 sm:py-24 lg:grid-cols-[minmax(0,1fr)_minmax(0,25rem)]">
            <div className="max-w-3xl space-y-6">
              <p className="inline-flex items-center gap-2 rounded-full border border-border px-3 py-1 text-xs font-medium text-muted-foreground">
                <ShieldCheck className="size-3.5 text-success-text" aria-hidden="true" />
                Every figure traced to a computation
              </p>
              <h1 className="text-4xl leading-[1.1] font-semibold tracking-tight text-balance sm:text-5xl">
                Ask questions of your spreadsheet. Get answers you can check.
              </h1>
              <p className="max-w-2xl text-lg leading-8 text-pretty text-muted-foreground">
                Upload a CSV or Excel file and ask in plain language. An AI model plans the
                analysis, deterministic tools compute every number, and each figure in the report
                links to the calculation behind it.
              </p>
              <div className="flex flex-wrap gap-3">
                <Button size="lg" asChild>
                  <Link href="/register">
                    Get started
                    <ArrowRight aria-hidden="true" />
                  </Link>
                </Button>
                <Button size="lg" variant="outline" asChild>
                  <a href="#example">See a real report</a>
                </Button>
              </div>
              <p className="text-sm text-muted-foreground">
                Free to use, with daily limits. Works with CSV, TSV, XLSX and XLS files.
              </p>
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
                <li
                  key={step.title}
                  className="space-y-3 rounded-lg border border-border bg-card p-5"
                >
                  <div className="flex items-center gap-3">
                    <span className="flex size-8 items-center justify-center rounded-md bg-muted text-muted-foreground">
                      <step.icon className="size-4" aria-hidden="true" />
                    </span>
                    <span className="tabular text-xs font-medium text-muted-foreground">
                      Step {index + 1}
                    </span>
                  </div>
                  <h3 className="text-sm font-semibold">{step.title}</h3>
                  <p className="text-sm leading-6 text-muted-foreground">{step.text}</p>
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
            <ul className="grid gap-x-8 gap-y-8 sm:grid-cols-2 lg:grid-cols-3">
              {FEATURES.map((feature) => (
                <li key={feature.title} className="space-y-2">
                  <feature.icon className="size-5 text-accent-text" aria-hidden="true" />
                  <h3 className="text-sm font-semibold">{feature.title}</h3>
                  <p className="text-sm leading-6 text-muted-foreground">{feature.text}</p>
                </li>
              ))}
            </ul>
          </div>
        </section>

        <section aria-labelledby="example" className="border-b border-border bg-surface">
          <div className="mx-auto w-full max-w-6xl space-y-8 px-4 py-16 sm:px-6">
            <SectionIntro
              id="example"
              eyebrow="Example output"
              title="A real report, not a mock-up"
              text="This is unedited output produced by this product for the bundled sample dataset. It is rendered here with the same components the app uses, so the evidence chips and the Methodology section work."
            />
            <p className="max-w-3xl rounded-md border border-border bg-background px-4 py-3 text-sm leading-6 text-muted-foreground">
              <span className="font-medium text-foreground">Source:</span> {overview.name} (
              {formatInteger(overview.rows)} rows, {formatInteger(overview.columns)} columns), a
              sales dataset bundled with the app. You can run the same analysis yourself with “Try
              the sample dataset” after signing up. A new run may word things differently or choose
              different computations, because the model plans and writes; the numbers are always
              computed.
            </p>
            <div className="rounded-xl border border-border bg-background p-4 shadow-sm sm:p-8">
              <ReportView report={sampleReport} headingLevel={3} />
            </div>
          </div>
        </section>

        <section aria-labelledby="security" className="border-b border-border">
          <div className="mx-auto w-full max-w-6xl space-y-10 px-4 py-16 sm:px-6">
            <SectionIntro
              id="security"
              eyebrow="Privacy and security"
              title="What happens to your data"
              text="Plain statements about how the product works today, including its limits."
            />
            <dl className="grid gap-x-8 gap-y-8 sm:grid-cols-2 lg:grid-cols-3">
              {SECURITY.map((item) => (
                <div key={item.title} className="space-y-2">
                  <dt className="text-sm font-semibold">{item.title}</dt>
                  <dd className="text-sm leading-6 text-muted-foreground">{item.text}</dd>
                </div>
              ))}
            </dl>
          </div>
        </section>

        <section aria-labelledby="cta">
          <div className="mx-auto flex w-full max-w-6xl flex-col items-start gap-5 px-4 py-16 sm:px-6">
            <h2 id="cta" className="text-2xl leading-8 font-semibold tracking-tight">
              Try it on your own data
            </h2>
            <p className="max-w-2xl text-base leading-7 text-muted-foreground">
              Create an account, upload a file or use the sample dataset, and ask your first
              question. An analysis usually takes one to two minutes.
            </p>
            <div className="flex flex-wrap gap-3">
              <Button size="lg" asChild>
                <Link href="/register">
                  Create an account
                  <ArrowRight aria-hidden="true" />
                </Link>
              </Button>
              <Button size="lg" variant="outline" asChild>
                <Link href="/login">Sign in</Link>
              </Button>
            </div>
          </div>
        </section>
      </main>

      <footer className="border-t border-border">
        <div className="mx-auto flex w-full max-w-6xl flex-col gap-4 px-4 py-8 text-sm text-muted-foreground sm:flex-row sm:items-center sm:justify-between sm:px-6">
          <Logo className="text-foreground" />
          <nav aria-label="Footer" className="flex flex-wrap gap-x-5 gap-y-2">
            <a href="#how-it-works" className="rounded-sm transition-colors hover:text-foreground">
              How it works
            </a>
            <a href="#example" className="rounded-sm transition-colors hover:text-foreground">
              Example report
            </a>
            <a href="#security" className="rounded-sm transition-colors hover:text-foreground">
              Privacy and security
            </a>
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
