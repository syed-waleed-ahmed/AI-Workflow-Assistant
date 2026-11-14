import type { AnalysisEvent, AnalysisEvents, AnalysisStatus } from "@/lib/api/types";
import { isActiveStatus } from "@/lib/api/types";

export type StepState = "running" | "done" | "stopped";
export type StepKind = "status" | "plan" | "tool" | "verification";

/** One row of the activity timeline, derived only from events the API reported. */
export interface TimelineStep {
  key: string;
  kind: StepKind;
  label: string;
  state: StepState;
  startedAt: string;
  /** Tool steps: the evidence record (E1, E2…) this computation produced. */
  evidenceId?: string;
  tool?: string;
  /** Status steps reporting a model rate-limit wait. */
  waitSeconds?: number;
  /** Plan steps. */
  objective?: string;
  planSteps?: string[];
}

function detailString(detail: AnalysisEvent["detail"], key: string): string | undefined {
  const value = detail?.[key];
  return typeof value === "string" ? value : undefined;
}

function detailNumber(detail: AnalysisEvent["detail"], key: string): number | undefined {
  const value = detail?.[key];
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function stepKind(kind: string): StepKind {
  return kind === "plan" || kind === "tool" || kind === "verification" ? kind : "status";
}

/**
 * Turns the polled event stream into timeline steps.
 *
 * Tool events arrive in pairs ("running" then "done" or "failed") sharing an evidence id and
 * collapse into one step; a failed computation is shown as stopped with no result. A step left
 * running when something else happens (an older API that did not report failures) is treated
 * the same way.
 * A status step describes what the backend is doing right now, so it stays "running" until a
 * later event shows the work has moved on. Nothing is invented: every step corresponds to at
 * least one event.
 */
export function buildTimeline(
  events: readonly AnalysisEvent[],
  status: AnalysisStatus,
): TimelineStep[] {
  const steps: TimelineStep[] = [];
  const toolSteps = new Map<string, TimelineStep>();
  const ordered = [...events].sort((a, b) => a.id - b.id);

  const finishStatusSteps = (onlyWaits: boolean) => {
    for (const step of steps) {
      if (step.kind !== "status" || step.state !== "running") continue;
      if (onlyWaits && step.waitSeconds === undefined) continue;
      step.state = "done";
    }
  };

  // Computations run one at a time, and only those that return a result report "done". One
  // that is still "running" when anything else happens has therefore ended without a result
  // (the model usually retries it under a new evidence id).
  const endAbandonedTools = (except?: TimelineStep) => {
    for (const step of steps) {
      if (step.kind === "tool" && step.state === "running" && step !== except)
        step.state = "stopped";
    }
  };

  for (const event of ordered) {
    const kind = stepKind(event.kind);
    const detail = event.detail;

    if (kind === "tool") {
      const evidenceId = detailString(detail, "evidence_id");
      const reported = detailString(detail, "state");
      const ended: StepState | null =
        reported === "done" ? "done" : reported === "failed" ? "stopped" : null;
      const existing = evidenceId ? toolSteps.get(evidenceId) : undefined;
      endAbandonedTools(existing);
      if (existing) {
        existing.label = event.label;
        if (ended) existing.state = ended;
        continue;
      }
      finishStatusSteps(false);
      const step: TimelineStep = {
        key: evidenceId ? `tool-${evidenceId}` : `event-${event.id}`,
        kind,
        label: event.label,
        state: ended ?? "running",
        startedAt: event.created_at,
        evidenceId,
        tool: detailString(detail, "tool"),
      };
      if (evidenceId) toolSteps.set(evidenceId, step);
      steps.push(step);
      continue;
    }

    const waitSeconds = kind === "status" ? detailNumber(detail, "wait_seconds") : undefined;
    endAbandonedTools();
    // A capacity wait interrupts the current stage without ending it.
    finishStatusSteps(waitSeconds !== undefined);

    const step: TimelineStep = {
      key: `event-${event.id}`,
      kind,
      label: event.label,
      state: kind === "status" ? "running" : "done",
      startedAt: event.created_at,
      waitSeconds,
    };
    if (kind === "plan") {
      step.objective = detailString(detail, "objective");
      const planSteps = detail?.["steps"];
      if (Array.isArray(planSteps)) {
        step.planSteps = planSteps.filter((item): item is string => typeof item === "string");
      }
    }
    steps.push(step);
  }

  if (!isActiveStatus(status)) {
    const finalState: StepState = status === "completed" ? "done" : "stopped";
    for (const step of steps) {
      if (step.state !== "running") continue;
      step.state = step.kind === "tool" ? "stopped" : finalState;
    }
  }
  return steps;
}

/** Events accumulated across polls for the analysis' current turn. */
export interface EventsState {
  status: AnalysisStatus;
  turn: number;
  error: string | null;
  events: AnalysisEvent[];
  /** Highest event id seen; sent as `after` on the next poll. */
  lastId: number;
}

/** Folds one poll response into the accumulated state. The API only reports the current turn. */
export function mergeEvents(
  previous: EventsState | undefined,
  response: AnalysisEvents,
): EventsState {
  const sameTurn = previous !== undefined && previous.turn === response.turn;
  const known = sameTurn ? previous.events : [];
  const seen = new Set(known.map((event) => event.id));
  const fresh = response.events.filter(
    (event) => event.turn === response.turn && !seen.has(event.id),
  );
  const events = fresh.length > 0 ? [...known, ...fresh] : known;
  let lastId = previous?.lastId ?? 0;
  for (const event of response.events) lastId = Math.max(lastId, event.id);
  return { status: response.status, turn: response.turn, error: response.error, events, lastId };
}
