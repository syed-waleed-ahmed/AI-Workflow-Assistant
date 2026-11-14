import { beforeEach, describe, expect, it } from "vitest";
import { event, resetEventIds } from "@/test/fixtures";
import { buildTimeline, mergeEvents, type EventsState } from "./timeline";

beforeEach(() => {
  resetEventIds();
});

const tool = (label: string, evidenceId: string, state: "running" | "done" | "failed") =>
  event("tool", label, { tool: "aggregate", evidence_id: evidenceId, state });

describe("buildTimeline", () => {
  it("ends a computation the API reports as failed, without waiting for anything else", () => {
    const steps = buildTimeline(
      [
        tool("Calculating sum of region", "E1", "running"),
        tool("Calculating sum of region", "E1", "failed"),
      ],
      "running",
    );
    expect(steps).toHaveLength(1);
    expect(steps[0]).toMatchObject({ evidenceId: "E1", state: "stopped" });
  });

  it("collapses a running/done pair of tool events into one finished step", () => {
    const steps = buildTimeline(
      [
        event("status", "Loading the dataset"),
        tool("Calculating sum of revenue by region", "E1", "running"),
        tool("Calculating sum of revenue by region", "E1", "done"),
      ],
      "running",
    );

    expect(steps).toHaveLength(2);
    expect(steps[1]).toMatchObject({
      kind: "tool",
      label: "Calculating sum of revenue by region",
      evidenceId: "E1",
      tool: "aggregate",
      state: "done",
    });
  });

  it("keeps a tool step spinning until its done event arrives", () => {
    const steps = buildTimeline(
      [
        tool("Analysing revenue over time", "E1", "done"),
        tool("Comparing regions", "E2", "running"),
      ],
      "running",
    );
    expect(steps.map((step) => [step.evidenceId, step.state])).toEqual([
      ["E1", "done"],
      ["E2", "running"],
    ]);
  });

  it("stops a computation that never reports done once the run has moved on", () => {
    // Event sequence observed from the real backend: E1 failed, and the model retried it as E4.
    const steps = buildTimeline(
      [
        tool("Calculating sum of revenue, mean of unit_price by region", "E1", "running"),
        tool("Analysing revenue over time by region", "E2", "running"),
        tool("Analysing revenue over time by region", "E2", "done"),
        tool("Comparing revenue between two periods", "E3", "running"),
        tool("Comparing revenue between two periods", "E3", "done"),
        tool("Calculating sum of revenue, mean of unit_price by region", "E4", "running"),
        tool("Calculating sum of revenue, mean of unit_price by region", "E4", "done"),
        event("status", "Checking the evidence"),
      ],
      "running",
    );
    expect(steps.map((step) => [step.evidenceId ?? step.label, step.state])).toEqual([
      ["E1", "stopped"],
      ["E2", "done"],
      ["E3", "done"],
      ["E4", "done"],
      ["Checking the evidence", "running"],
    ]);
  });

  it("does not present an unfinished computation as done when the analysis completes", () => {
    const steps = buildTimeline(
      [
        tool("Finding outliers", "E1", "running"),
        event("verification", "All 4 figures traced to computed results"),
      ],
      "completed",
    );
    expect(steps.map((step) => step.state)).toEqual(["stopped", "done"]);
  });

  it("treats the latest status as in progress and earlier ones as finished", () => {
    const steps = buildTimeline(
      [event("status", "Loading the dataset"), event("status", "Planning the analysis")],
      "running",
    );
    expect(steps.map((step) => step.state)).toEqual(["done", "running"]);
  });

  it("carries the plan objective and steps", () => {
    const steps = buildTimeline(
      [
        event("status", "Planning the analysis"),
        event("plan", "Analysis plan ready", {
          objective: "Compare regional revenue",
          steps: ["Aggregate revenue by region", "Measure growth"],
        }),
      ],
      "running",
    );
    expect(steps[0]?.state).toBe("done");
    expect(steps[1]).toMatchObject({
      kind: "plan",
      state: "done",
      objective: "Compare regional revenue",
      planSteps: ["Aggregate revenue by region", "Measure growth"],
    });
  });

  it("shows a model capacity wait without ending the stage it interrupts", () => {
    const steps = buildTimeline(
      [
        event("status", "Writing the report"),
        event("status", "Waiting about 12s for AI model capacity", { wait_seconds: 12 }),
      ],
      "running",
    );
    expect(steps[0]).toMatchObject({ label: "Writing the report", state: "running" });
    expect(steps[1]).toMatchObject({ waitSeconds: 12, state: "running" });

    const after = buildTimeline(
      [
        event("status", "Writing the report"),
        event("status", "Waiting about 12s for AI model capacity", { wait_seconds: 12 }),
        event("status", "Verifying figures against computed results"),
      ],
      "running",
    );
    expect(after.map((step) => step.state)).toEqual(["done", "done", "running"]);
  });

  it("marks everything done once the analysis completed", () => {
    const steps = buildTimeline(
      [
        event("status", "Verifying figures against computed results"),
        event("verification", "All 19 figures traced to computed results"),
      ],
      "completed",
    );
    expect(steps.every((step) => step.state === "done")).toBe(true);
    expect(steps[1]?.kind).toBe("verification");
  });

  it.each(["failed", "cancelled"] as const)(
    "stops unfinished steps when the analysis %s",
    (status) => {
      const steps = buildTimeline(
        [tool("Calculating totals", "E1", "done"), tool("Finding outliers", "E2", "running")],
        status,
      );
      expect(steps.map((step) => step.state)).toEqual(["done", "stopped"]);
    },
  );

  it("orders by event id and produces no steps without events", () => {
    const first = event("status", "Loading the dataset");
    const second = event("status", "Planning the analysis");
    expect(buildTimeline([second, first], "running").map((step) => step.label)).toEqual([
      "Loading the dataset",
      "Planning the analysis",
    ]);
    expect(buildTimeline([], "queued")).toEqual([]);
  });
});

describe("mergeEvents", () => {
  it("appends new events, ignores repeats and tracks the cursor for the next poll", () => {
    const a = event("status", "Loading the dataset");
    const b = event("status", "Planning the analysis");
    const c = event("plan", "Analysis plan ready", { objective: "x", steps: [] });

    const first = mergeEvents(undefined, {
      status: "running",
      turn: 1,
      error: null,
      events: [a, b],
    });
    expect(first.lastId).toBe(2);

    const second = mergeEvents(first, { status: "running", turn: 1, error: null, events: [b, c] });
    expect(second.events.map((item) => item.id)).toEqual([1, 2, 3]);
    expect(second.lastId).toBe(3);
  });

  it("keeps the event list stable when a poll brings nothing new", () => {
    const state: EventsState = {
      status: "running",
      turn: 1,
      error: null,
      events: [event("status", "x")],
      lastId: 1,
    };
    const next = mergeEvents(state, { status: "completed", turn: 1, error: null, events: [] });
    expect(next.events).toBe(state.events);
    expect(next.status).toBe("completed");
  });

  it("starts a fresh list when a follow-up begins a new turn", () => {
    const old = event("status", "Loading the dataset", null, 1);
    const state: EventsState = {
      status: "completed",
      turn: 1,
      error: null,
      events: [old],
      lastId: old.id,
    };
    const fresh = event("status", "Loading the dataset", null, 2);

    const next = mergeEvents(state, { status: "running", turn: 2, error: null, events: [fresh] });

    expect(next.turn).toBe(2);
    expect(next.events).toEqual([fresh]);
    expect(next.lastId).toBe(fresh.id);
  });

  it("carries the failure message", () => {
    const next = mergeEvents(undefined, {
      status: "failed",
      turn: 1,
      error: "The model is unavailable.",
      events: [],
    });
    expect(next.error).toBe("The model is unavailable.");
  });
});
