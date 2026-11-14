import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { axe } from "@/test/axe";
import type { ReportContent } from "@/lib/api/types";
import { sampleReport } from "@/test/fixtures";
import { ReportView } from "./report-view";
import { verificationSummary } from "./verification-badge";

describe("ReportView with the real sample report", () => {
  it("shows the title, question, summary and the verification result", () => {
    render(<ReportView report={sampleReport} />);

    expect(
      screen.getByRole("heading", { level: 2, name: "Regional Sales Performance Analysis" }),
    ).toBeInTheDocument();
    expect(screen.getByText(sampleReport.question)).toBeInTheDocument();
    expect(screen.getByText(sampleReport.executive_summary)).toBeInTheDocument();
    expect(
      screen.getByText("All 16 figures verified against computed results"),
    ).toBeInTheDocument();
    expect(screen.getByText("2,400 rows × 11 columns")).toBeInTheDocument();
    expect(screen.getByText("openai/gpt-oss-120b")).toBeInTheDocument();
  });

  it("renders every key metric with its value exactly as reported", () => {
    render(<ReportView report={sampleReport} />);

    const region = within(screen.getByRole("region", { name: "Key metrics" }));
    for (const metric of sampleReport.key_metrics) {
      const card = region.getByText(metric.label).closest("li")!;
      expect(within(card).getByText(metric.value)).toBeInTheDocument();
      for (const id of metric.evidence_ids) {
        expect(
          within(card).getByRole("button", { name: `Show evidence ${id}` }),
        ).toBeInTheDocument();
      }
    }
  });

  it("renders findings with significance badges and recommendations with priority", () => {
    render(<ReportView report={sampleReport} />);

    const findings = screen.getByRole("region", { name: /^Findings/ });
    for (const finding of sampleReport.findings) {
      expect(within(findings).getByRole("heading", { name: finding.title })).toBeInTheDocument();
    }
    const high = sampleReport.findings.filter((finding) => finding.significance === "high").length;
    expect(within(findings).getAllByText("high significance")).toHaveLength(high);

    const recommendations = screen.getByRole("region", { name: /^Recommendations/ });
    expect(
      within(recommendations).getByText(sampleReport.recommendations[0]!.action),
    ).toBeInTheDocument();
    expect(within(recommendations).getAllByText("high priority")).toHaveLength(
      sampleReport.recommendations.filter((item) => item.priority === "high").length,
    );
    expect(screen.getByRole("region", { name: "Limitations" })).toHaveTextContent(
      sampleReport.limitations[0]!,
    );
    expect(screen.getByRole("region", { name: "Data quality" })).toHaveTextContent(
      sampleReport.data_quality[0]!,
    );
  });

  it("renders a chart for every visualization, each linked to its evidence", () => {
    render(<ReportView report={sampleReport} />);

    const charts = screen.getByRole("region", { name: "Charts" });
    expect(within(charts).getAllByRole("figure")).toHaveLength(sampleReport.visualizations.length);
    expect(within(charts).getByRole("button", { name: "Show evidence E5" })).toBeInTheDocument();
  });

  it("opens the cited evidence record when a chip is clicked", async () => {
    const user = userEvent.setup();
    render(<ReportView report={sampleReport} />);

    const trigger = screen.getByRole("button", { name: /^E2/ });
    expect(trigger).toHaveAttribute("aria-expanded", "false");
    const e2 = sampleReport.methodology.find((record) => record.id === "E2")!;
    expect(screen.getByText(e2.summary)).not.toBeVisible();

    // The overall mean revenue per order metric cites E2.
    const metric = screen.getByText(/^Mean revenue per order . overall$/).closest("li")!;
    await user.click(within(metric).getByRole("button", { name: "Show evidence E2" }));

    expect(trigger).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText(e2.summary)).toBeVisible();
    const table = within(screen.getByRole("region", { name: "E2 data table" })).getByRole("table");
    expect(
      within(table)
        .getAllByRole("columnheader")
        .map((cell) => cell.textContent),
    ).toEqual(e2.table!.columns);
    expect(within(table).getByText("4,793.4879")).toBeInTheDocument();
    // Other records stay closed.
    expect(screen.getByRole("button", { name: /^E1/ })).toHaveAttribute("aria-expanded", "false");
  });

  it("shows the tool, its arguments and notes inside an evidence record", async () => {
    const user = userEvent.setup();
    render(<ReportView report={sampleReport} />);

    await user.click(screen.getByRole("button", { name: /^E3/ }));

    const panel = screen.getByRole("region", { name: /^E3\s*Analysing/ });
    const e3 = sampleReport.methodology.find((record) => record.id === "E3")!;
    expect(within(panel).getByText(e3.notes![0]!)).toBeVisible();
    expect(within(panel).getByText(/"date_column": "order_date"/)).toBeVisible();
    expect(within(panel).getByText("68.61")).toBeVisible();
    expect(within(panel).getAllByRole("row")).toHaveLength(e3.table!.rows.length + 1);
  });

  it("expands and collapses all evidence at once", async () => {
    const user = userEvent.setup();
    render(<ReportView report={sampleReport} />);

    await user.click(screen.getByRole("button", { name: "Expand all" }));
    for (const record of sampleReport.methodology) {
      expect(screen.getByRole("button", { name: new RegExp(`^${record.id}`) })).toHaveAttribute(
        "aria-expanded",
        "true",
      );
    }
    await user.click(screen.getByRole("button", { name: "Collapse all" }));
    expect(screen.getByRole("button", { name: /^E1/ })).toHaveAttribute("aria-expanded", "false");
  });

  it("downloads an evidence table as CSV through the provided handler", async () => {
    const user = userEvent.setup();
    const onDownloadTable = vi.fn().mockResolvedValue("table.csv");
    render(<ReportView report={sampleReport} onDownloadTable={onDownloadTable} />);

    await user.click(screen.getByRole("button", { name: /^E3/ }));
    await user.click(screen.getByRole("button", { name: "Download the E3 table as CSV" }));

    expect(onDownloadTable).toHaveBeenCalledWith("E3");
  });

  it("offers no CSV download when the report is not stored (the public example)", async () => {
    const user = userEvent.setup();
    render(<ReportView report={sampleReport} />);
    await user.click(screen.getByRole("button", { name: /^E3/ }));
    expect(screen.queryByRole("button", { name: /Download the E3 table/ })).not.toBeInTheDocument();
  });

  it("has no detectable accessibility violations", async () => {
    const { container } = render(
      <main>
        <h1>Report</h1>
        <ReportView report={sampleReport} />
      </main>,
    );
    expect(await axe(container)).toHaveNoViolations();
  });
});

describe("ReportView edge cases", () => {
  const partial: ReportContent = {
    ...sampleReport,
    verification: {
      status: "partially_verified",
      numbers_checked: 19,
      unverified_numbers: ["12.5%", "3,400"],
      notes: ["2 figures could not be matched to a computed value."],
    },
    anomalies: [
      {
        title: "Revenue spike in March",
        detail: "One week accounts for most of the month.",
        evidence_ids: ["E2", "E9"],
      },
    ],
  };

  it("flags a partially verified report and lists the unverified figures", () => {
    render(<ReportView report={partial} />);

    expect(
      screen.getByText("Partially verified: 2 of 19 figures could not be traced to a computation"),
    ).toBeInTheDocument();
    expect(screen.getByText("12.5%, 3,400")).toBeInTheDocument();
    expect(screen.queryByText(/figures verified against computed results/)).not.toBeInTheDocument();
    expect(
      screen.getByText("2 figures could not be matched to a computed value."),
    ).toBeInTheDocument();
  });

  it("renders anomalies, and shows a citation without a record as plain text rather than a dead button", () => {
    render(<ReportView report={partial} />);

    const anomalies = screen.getByRole("region", { name: /^Anomalies/ });
    expect(
      within(anomalies).getByRole("heading", { name: "Revenue spike in March" }),
    ).toBeInTheDocument();
    expect(within(anomalies).getByRole("button", { name: "Show evidence E2" })).toBeInTheDocument();
    expect(
      within(anomalies).queryByRole("button", { name: "Show evidence E9" }),
    ).not.toBeInTheDocument();
    expect(within(anomalies).getByText("E9")).toBeInTheDocument();
  });

  it("omits sections the report has no content for", () => {
    render(<ReportView report={sampleReport} />);
    expect(screen.queryByRole("region", { name: /^Anomalies/ })).not.toBeInTheDocument();
  });

  it("words the verification summary for each outcome", () => {
    expect(
      verificationSummary({
        status: "verified",
        numbers_checked: 19,
        unverified_numbers: [],
        notes: [],
      }),
    ).toBe("All 19 figures verified against computed results");
    expect(
      verificationSummary({
        status: "verified",
        numbers_checked: 0,
        unverified_numbers: [],
        notes: [],
      }),
    ).toBe("No numeric figures needed verification");
    expect(
      verificationSummary({
        status: "partially_verified",
        numbers_checked: 7,
        unverified_numbers: ["4"],
        notes: [],
      }),
    ).toBe("Partially verified: 1 of 7 figure could not be traced to a computation");
  });
});
