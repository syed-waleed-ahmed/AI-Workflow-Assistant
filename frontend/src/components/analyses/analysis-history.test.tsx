import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { axe } from "@/test/axe";
import { analysisSummary, REPORT_ID } from "@/test/fixtures";
import { emptyResponse, jsonResponse, mockApi, renderWithClient, type Route } from "@/test/utils";
import { AnalysisHistory } from "./analysis-history";

const done = analysisSummary({
  id: "a-done",
  title: "Which regions are underperforming?",
  latest_report_id: REPORT_ID,
});
const running = analysisSummary({
  id: "a-running",
  title: "Revenue growth by region",
  status: "running",
  finished_at: null,
  latest_report_id: null,
});

function mockHistory(overrides: Record<string, Route> = {}) {
  return mockApi({
    "GET /api/v1/analyses": { items: [running, done], total: 2 },
    ...overrides,
  });
}

describe("AnalysisHistory", () => {
  it("lists every analysis with its report's export and a delete control beside the link", async () => {
    mockHistory();
    renderWithClient(<AnalysisHistory />);

    const rows = await screen.findAllByRole("listitem");
    expect(rows).toHaveLength(2);

    // The finished analysis: link, export of its latest report, and delete.
    const finished = rows[1]!;
    expect(
      within(finished).getByRole("link", { name: "Which regions are underperforming?" }),
    ).toHaveAttribute("href", "/app/analyses/a-done");
    expect(
      within(finished).getByRole("button", {
        name: "Export report: Which regions are underperforming?",
      }),
    ).toBeInTheDocument();
    expect(
      within(finished).getByRole("button", {
        name: "Delete analysis: Which regions are underperforming?",
      }),
    ).toBeInTheDocument();

    // A running analysis has no report yet and cannot be deleted until it is cancelled.
    const active = rows[0]!;
    expect(within(active).queryByRole("button", { name: /Export report/ })).toBeNull();
    expect(within(active).queryByRole("button", { name: /Delete analysis/ })).toBeNull();
  });

  it("deletes an analysis after confirmation", async () => {
    const user = userEvent.setup();
    let deleted = false;
    const api = mockHistory({
      "DELETE /api/v1/analyses/a-done": () => {
        deleted = true;
        return emptyResponse();
      },
      "GET /api/v1/analyses": () =>
        jsonResponse(
          deleted ? { items: [running], total: 1 } : { items: [running, done], total: 2 },
        ),
    });
    renderWithClient(<AnalysisHistory />);

    await user.click(
      await screen.findByRole("button", {
        name: "Delete analysis: Which regions are underperforming?",
      }),
    );
    const dialog = await screen.findByRole("alertdialog");
    expect(dialog).toHaveTextContent("every report it produced will be permanently deleted");
    await user.click(within(dialog).getByRole("button", { name: "Delete analysis" }));

    await waitFor(() => expect(api.calls.some((call) => call.method === "DELETE")).toBe(true));
    await waitFor(() => expect(screen.getAllByRole("listitem")).toHaveLength(1));
  });

  it("has no detectable accessibility violations", async () => {
    mockHistory();
    const { container } = renderWithClient(
      <main>
        <AnalysisHistory />
      </main>,
    );
    await screen.findAllByRole("listitem");
    expect(await axe(container)).toHaveNoViolations();
  });
});
