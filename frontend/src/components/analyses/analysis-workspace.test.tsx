import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { analysis, datasetSummary, report, REPORT_ID, sampleReport } from "@/test/fixtures";
import { errorResponse, jsonResponse, mockApi, renderWithClient, type Route } from "@/test/utils";
import { AnalysisWorkspace, groupTurns } from "./analysis-workspace";

const ID = "22222222-2222-4222-8222-222222222222";
const SUGGESTIONS = {
  questions: ["Which regions are underperforming?", "Which channel performs best?"],
};

function mockWorkspace(routes: Record<string, Route>) {
  return mockApi({
    [`GET /api/v1/datasets/${datasetSummary.id}/suggestions`]: SUGGESTIONS,
    ...routes,
  });
}

describe("AnalysisWorkspace", () => {
  it("renders the conversation: the question, then the stored report inline", async () => {
    mockWorkspace({
      [`GET /api/v1/analyses/${ID}`]: analysis(),
      [`GET /api/v1/analyses/${ID}/events`]: {
        status: "completed",
        turn: 1,
        error: null,
        events: [],
      },
      [`GET /api/v1/reports/${REPORT_ID}`]: report,
    });
    renderWithClient(<AnalysisWorkspace analysisId={ID} />);

    expect(
      await screen.findByRole("heading", { level: 1, name: "Which regions are underperforming?" }),
    ).toBeInTheDocument();
    const turn = screen.getByRole("region", { name: "Question 1" });
    expect(within(turn).getByText("You asked")).toBeInTheDocument();
    expect(
      await within(turn).findByRole("heading", { level: 2, name: sampleReport.title }),
    ).toBeInTheDocument();
    expect(
      within(turn).getByText("All 16 figures verified against computed results"),
    ).toBeInTheDocument();
    expect(within(turn).getByRole("link", { name: "Open report" })).toHaveAttribute(
      "href",
      `/app/reports/${REPORT_ID}`,
    );

    // Finished: follow-ups are offered, minus the question already asked.
    expect(screen.getByLabelText("Ask a follow-up question")).toBeEnabled();
    expect(
      await screen.findByRole("button", { name: "Which channel performs best?" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Which regions are underperforming?" }),
    ).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Cancel analysis" })).not.toBeInTheDocument();
  });

  it("shows why a run failed and retries by asking the same question again", async () => {
    const user = userEvent.setup();
    const failed = analysis({ status: "failed", error: "The AI model did not respond in time." });
    const failedDetail = { ...failed, messages: [failed.messages[0]!] };
    const requeued = { ...failedDetail, status: "queued", turn: 2, error: null };
    const api = mockWorkspace({
      [`GET /api/v1/analyses/${ID}`]: failedDetail,
      [`GET /api/v1/analyses/${ID}/events`]: {
        status: "failed",
        turn: 1,
        error: "The AI model did not respond in time.",
        events: [],
      },
      [`POST /api/v1/analyses/${ID}/messages`]: jsonResponse(requeued, 202),
      "GET /api/v1/analyses": { items: [], total: 0 },
      "GET /api/v1/users/me/usage": errorResponse(500, "internal_error", "unused"),
    });
    renderWithClient(<AnalysisWorkspace analysisId={ID} />);

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("The analysis failed");
    expect(alert).toHaveTextContent("The AI model did not respond in time.");

    await user.click(within(alert).getByRole("button", { name: "Ask again" }));

    await waitFor(() => {
      const post = api.calls.find((call) => call.method === "POST");
      expect(post?.body).toEqual({ question: "Which regions are underperforming?" });
    });
  });

  it("shows live progress with a cancel button while running, and blocks follow-ups", async () => {
    const user = userEvent.setup();
    const running = analysis({ status: "running", finished_at: null });
    const api = mockWorkspace({
      [`GET /api/v1/analyses/${ID}`]: { ...running, messages: [running.messages[0]!] },
      [`GET /api/v1/analyses/${ID}/events`]: {
        status: "running",
        turn: 1,
        error: null,
        events: [
          {
            id: 1,
            turn: 1,
            kind: "status",
            label: "Loading the dataset",
            detail: null,
            created_at: "2026-11-13T11:00:03Z",
          },
          {
            id: 2,
            turn: 1,
            kind: "tool",
            label: "Calculating sum of revenue by region",
            detail: { tool: "aggregate", evidence_id: "E1", state: "running" },
            created_at: "2026-11-13T11:00:09Z",
          },
        ],
      },
      [`POST /api/v1/analyses/${ID}/cancel`]: { ...running, status: "running" },
      "GET /api/v1/analyses": { items: [], total: 0 },
    });
    renderWithClient(<AnalysisWorkspace analysisId={ID} />);

    const activity = await screen.findByRole("list", { name: "Analysis activity" });
    expect(within(activity).getByText("Calculating sum of revenue by region")).toBeInTheDocument();
    expect(within(activity).getByText("E1")).toBeInTheDocument();
    expect(screen.getByText("Analysing your data")).toBeInTheDocument();
    const box = screen.getByLabelText("Ask a follow-up question");
    expect(box).toBeDisabled();
    expect(box).toHaveAttribute(
      "placeholder",
      "You can ask a follow-up when this analysis finishes.",
    );

    await user.click(screen.getByRole("button", { name: "Cancel analysis" }));

    await waitFor(() =>
      expect(
        api.calls.some((call) => call.path.endsWith("/cancel") && call.method === "POST"),
      ).toBe(true),
    );
  });

  it("explains a missing analysis instead of offering a pointless retry", async () => {
    mockWorkspace({
      [`GET /api/v1/analyses/${ID}`]: errorResponse(404, "not_found", "Analysis not found."),
    });
    renderWithClient(<AnalysisWorkspace analysisId={ID} />);

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Analysis not found");
    expect(within(alert).queryByRole("button", { name: "Try again" })).not.toBeInTheDocument();
    expect(within(alert).getByRole("link", { name: "Back to analyses" })).toHaveAttribute(
      "href",
      "/app/analyses",
    );
  });
});

describe("groupTurns", () => {
  it("pairs each question with its answer and keeps unanswered turns", () => {
    const base = analysis();
    const followUp = { ...base.messages[0]!, id: "m3", turn: 2, content: "And by channel?" };
    const turns = groupTurns([...base.messages, followUp]);

    expect(turns.map((turn) => [turn.turn, turn.question?.content, Boolean(turn.answer)])).toEqual([
      [1, "Which regions are underperforming?", true],
      [2, "And by channel?", false],
    ]);
  });
});
