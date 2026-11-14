import { act, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AnalysisEvents } from "@/lib/api/types";
import { EVENTS_POLL_MS, useAnalysisEvents } from "@/lib/query/hooks";
import { event, resetEventIds } from "@/test/fixtures";
import { jsonResponse, mockApi, renderWithClient } from "@/test/utils";
import { ActivityTimeline } from "./activity-timeline";

const ANALYSIS_ID = "22222222-2222-4222-8222-222222222222";

beforeEach(() => {
  resetEventIds();
});

const tool = (label: string, evidenceId: string, state: "running" | "done") =>
  event("tool", label, { tool: "aggregate", evidence_id: evidenceId, state });

function stepTexts(): string[] {
  const list = screen.getByRole("list", { name: "Analysis activity" });
  return within(list)
    .getAllByRole("listitem")
    .filter((item) => item.hasAttribute("data-state"))
    .map(
      (item) => `${item.getAttribute("data-state")}: ${item.querySelector("p")?.textContent ?? ""}`,
    );
}

/** Advances the clock, then lets the query library deliver the result to React. */
async function advance(ms: number) {
  await act(() => vi.advanceTimersByTimeAsync(ms));
  await act(() => vi.advanceTimersByTimeAsync(1));
}

/** The timeline wired to the real polling hook, as on the analysis page. */
function LiveTimeline() {
  const events = useAnalysisEvents(ANALYSIS_ID);
  if (!events.data) return <p>Connecting…</p>;
  return <ActivityTimeline events={events.data.events} status={events.data.status} since={null} />;
}

describe("ActivityTimeline fed by polling", () => {
  it("turns successive poll responses into steps and stops polling when the run completes", async () => {
    vi.useFakeTimers();
    const responses: AnalysisEvents[] = [
      {
        status: "running",
        turn: 1,
        error: null,
        events: [event("status", "Loading the dataset"), event("status", "Planning the analysis")],
      },
      {
        status: "running",
        turn: 1,
        error: null,
        events: [
          event("plan", "Analysis plan ready", {
            objective: "Compare revenue across regions",
            steps: ["Total revenue by region", "Growth by region"],
          }),
          tool("Calculating sum of revenue by region", "E1", "running"),
        ],
      },
      {
        status: "running",
        turn: 1,
        error: null,
        events: [
          tool("Calculating sum of revenue by region", "E1", "done"),
          event("status", "Waiting about 12s for AI model capacity", { wait_seconds: 12 }),
        ],
      },
      {
        status: "completed",
        turn: 1,
        error: null,
        events: [
          event("status", "Verifying figures against computed results"),
          event("verification", "All 19 figures traced to computed results"),
        ],
      },
    ];
    let poll = 0;
    const api = mockApi({
      [`GET /api/v1/analyses/${ANALYSIS_ID}/events`]: () =>
        jsonResponse(responses[Math.min(poll++, responses.length - 1)]),
    });
    renderWithClient(<LiveTimeline />);

    // First poll: asks for everything (after=0).
    await advance(0);
    expect(api.calls[0]?.query.get("after")).toBe("0");
    expect(stepTexts()).toEqual([
      "done: Loading the dataset(done)",
      "running: Planning the analysis(in progress)",
    ]);

    // Second poll: only events after the last id seen; the plan and a running computation arrive.
    await advance(EVENTS_POLL_MS);
    expect(api.calls[1]?.query.get("after")).toBe("2");
    expect(stepTexts()).toEqual([
      "done: Loading the dataset(done)",
      "done: Planning the analysis(done)",
      "done: Analysis plan ready(done)",
      "running: Calculating sum of revenue by regionE1(in progress)",
    ]);
    expect(screen.getByText("Compare revenue across regions")).toBeInTheDocument();
    expect(screen.getByText("Growth by region")).toBeInTheDocument();

    // Third poll: the computation's "done" event completes the existing step instead of adding one.
    await advance(EVENTS_POLL_MS);
    expect(api.calls[2]?.query.get("after")).toBe("4");
    expect(stepTexts()).toEqual([
      "done: Loading the dataset(done)",
      "done: Planning the analysis(done)",
      "done: Analysis plan ready(done)",
      "done: Calculating sum of revenue by regionE1(done)",
      "running: Waiting about 12s for AI model capacity(in progress)",
    ]);
    // Screen readers hear the newest step only.
    expect(screen.getByRole("status")).toHaveTextContent("Waiting about 12s for AI model capacity");

    // Final poll: completed. The list collapses to a summary and polling stops.
    await advance(EVENTS_POLL_MS);
    expect(api.calls[3]?.query.get("after")).toBe("6");
    expect(screen.getByRole("button", { name: "Activity · 7 steps" })).toHaveAttribute(
      "aria-expanded",
      "false",
    );
    expect(screen.queryByRole("list", { name: "Analysis activity" })).not.toBeInTheDocument();

    await advance(EVENTS_POLL_MS * 4);
    expect(api.calls).toHaveLength(4);
  });
});

describe("ActivityTimeline", () => {
  it("says the analysis is waiting for a worker while queued with no events", () => {
    render(<ActivityTimeline events={[]} status="queued" />);
    expect(screen.getByText("Queued")).toBeInTheDocument();
    expect(screen.getByText("Waiting for a worker to pick this up…")).toBeInTheDocument();
    expect(screen.getByText(/usually take 40–120 seconds/)).toBeInTheDocument();
  });

  it("shows elapsed time measured from the real start time", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-11-13T11:01:15Z"));
    render(
      <ActivityTimeline
        events={[event("status", "Loading the dataset")]}
        status="running"
        since="2026-11-13T11:00:00Z"
      />,
    );
    expect(screen.getByText("1m 15s elapsed")).toBeInTheDocument();

    act(() => {
      vi.advanceTimersByTime(5000);
    });
    expect(screen.getByText("1m 20s elapsed")).toBeInTheDocument();
  });

  it("keeps the steps of a finished run available behind a toggle", async () => {
    const user = userEvent.setup();
    render(
      <ActivityTimeline
        events={[
          tool("Calculating totals", "E1", "done"),
          event("verification", "All 4 figures traced to computed results"),
        ]}
        status="completed"
      />,
    );

    const toggle = screen.getByRole("button", { name: "Activity · 2 steps" });
    await user.click(toggle);

    expect(toggle).toHaveAttribute("aria-expanded", "true");
    expect(stepTexts()).toEqual([
      "done: Calculating totalsE1(done)",
      "done: All 4 figures traced to computed results(done)",
    ]);
  });

  it("marks an interrupted step as stopped when the run failed", async () => {
    const user = userEvent.setup();
    render(
      <ActivityTimeline
        events={[
          tool("Calculating totals", "E1", "done"),
          tool("Finding outliers", "E2", "running"),
        ]}
        status="failed"
      />,
    );
    await user.click(screen.getByRole("button", { name: "Activity · 2 steps" }));
    expect(stepTexts()).toEqual([
      "done: Calculating totalsE1(done)",
      "stopped: Finding outliersE2(no result)",
    ]);
  });

  it("renders nothing for a finished run that reported no events", () => {
    const { container } = render(<ActivityTimeline events={[]} status="completed" />);
    expect(container).toBeEmptyDOMElement();
  });
});
