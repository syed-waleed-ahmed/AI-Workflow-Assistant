import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { axe } from "@/test/axe";
import { analysis, analysisSummary, datasetSummary, usage, user as account } from "@/test/fixtures";
import { router } from "@/test/next-navigation";
import { errorResponse, jsonResponse, mockApi, renderWithClient, type Route } from "@/test/utils";
import { DashboardView } from "./dashboard-view";

const SUGGESTIONS = {
  questions: ["Which region has the highest revenue?", "How has revenue changed over time?"],
};

function mockDashboard(overrides: Record<string, Route> = {}) {
  return mockApi({
    "GET /api/v1/auth/me": account,
    "GET /api/v1/users/me/usage": usage,
    "GET /api/v1/datasets": { items: [datasetSummary], total: 1 },
    "GET /api/v1/analyses": {
      items: [
        analysisSummary({
          id: "a-running",
          title: "Revenue growth by region",
          status: "running",
          finished_at: null,
        }),
        analysisSummary({ id: "a-done", title: "Which regions are underperforming?" }),
        analysisSummary({
          id: "a-failed",
          title: "Forecast next quarter",
          status: "failed",
          error: "The model is unavailable.",
        }),
      ],
      total: 3,
    },
    [`GET /api/v1/datasets/${datasetSummary.id}/suggestions`]: SUGGESTIONS,
    ...overrides,
  });
}

describe("DashboardView for a new user", () => {
  it("shows onboarding with the uploader instead of empty lists", async () => {
    mockDashboard({
      "GET /api/v1/users/me/usage": {
        ...usage,
        analyses_today: 0,
        datasets: 0,
        storage_used_bytes: 0,
      },
      "GET /api/v1/datasets": { items: [], total: 0 },
      "GET /api/v1/analyses": { items: [], total: 0 },
    });
    renderWithClient(<DashboardView />);

    expect(await screen.findByRole("heading", { name: "Get started" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Welcome, Ada");
    expect(screen.getByText(/You have no datasets yet/)).toBeInTheDocument();
    // The next action is right there: upload or use the sample.
    expect(screen.getByRole("button", { name: "Choose file" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Try the sample dataset" })).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Recent analyses" })).not.toBeInTheDocument();
    expect(screen.queryByText("Start an analysis")).not.toBeInTheDocument();
    // Usage is still shown, at zero.
    expect(
      await screen.findByRole("progressbar", { name: "Analyses (last 24 hours): 0 of 10" }),
    ).toBeInTheDocument();
  });
});

describe("DashboardView with data", () => {
  it("shows the quick start, recent analyses with live status, datasets and usage meters", async () => {
    mockDashboard();
    renderWithClient(<DashboardView />);

    expect(await screen.findByText("Start an analysis")).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Get started" })).not.toBeInTheDocument();

    const recent = screen.getByRole("region", { name: "Recent analyses" });
    const rows = within(recent).getAllByRole("listitem");
    expect(rows).toHaveLength(3);
    expect(within(rows[0]!).getByText("Running")).toBeInTheDocument();
    expect(within(rows[1]!).getByText("Completed")).toBeInTheDocument();
    expect(within(rows[2]!).getByText("Failed")).toBeInTheDocument();
    expect(within(rows[2]!).getByText("The model is unavailable.")).toBeInTheDocument();
    expect(within(rows[0]!).getByRole("link")).toHaveAttribute("href", "/app/analyses/a-running");

    const datasets = screen.getByRole("region", { name: "Datasets" });
    expect(within(datasets).getByRole("link", { name: /sample_sales\.csv/ })).toHaveAttribute(
      "href",
      `/app/datasets/${datasetSummary.id}`,
    );
    expect(within(datasets).getByText("2,400 rows × 11 columns")).toBeInTheDocument();

    expect(
      await screen.findByRole("progressbar", { name: "Analyses (last 24 hours): 3 of 10" }),
    ).toHaveAttribute("aria-valuenow", "30");
    expect(
      screen.getByRole("progressbar", { name: "Storage: 5.0 MB of 100 MB" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("progressbar", { name: "Datasets: 2 of 25" })).toBeInTheDocument();
  });

  it("points at the analysis that is still running", async () => {
    mockDashboard();
    renderWithClient(<DashboardView />);

    const banner = await screen.findByRole("link", {
      name: /Revenue growth by region.*View progress/,
    });
    expect(banner).toHaveAttribute("href", "/app/analyses/a-running");
  });

  it("starts an analysis from a suggested question and opens its workspace", async () => {
    const user = userEvent.setup();
    const created = analysis({ id: "a-new", status: "queued", title: SUGGESTIONS.questions[0] });
    const api = mockDashboard({
      "POST /api/v1/analyses": jsonResponse({ ...created, messages: [created.messages[0]] }, 202),
      "GET /api/v1/analyses/a-new/events": { status: "queued", turn: 1, error: null, events: [] },
    });
    renderWithClient(<DashboardView />);

    await user.click(await screen.findByRole("button", { name: SUGGESTIONS.questions[0] }));

    await waitFor(() => expect(router.push).toHaveBeenCalledWith("/app/analyses/a-new"));
    const post = api.calls.find((call) => call.method === "POST");
    expect(post?.body).toEqual({
      dataset_id: datasetSummary.id,
      question: SUGGESTIONS.questions[0],
    });
  });

  it("validates a typed question before sending it", async () => {
    const user = userEvent.setup();
    const api = mockDashboard();
    renderWithClient(<DashboardView />);

    const box = await screen.findByLabelText("Question about the selected dataset");
    await user.type(box, "ab{Enter}");

    expect(await screen.findByText("Ask a question of at least 3 characters.")).toBeInTheDocument();
    expect(api.calls.some((call) => call.method === "POST")).toBe(false);
  });

  it("disables asking when the daily limit is reached and says why", async () => {
    mockDashboard({ "GET /api/v1/users/me/usage": { ...usage, analyses_today: 10 } });
    renderWithClient(<DashboardView />);

    const box = await screen.findByLabelText("Question about the selected dataset");
    await waitFor(() => expect(box).toBeDisabled());
    expect(box).toHaveAttribute(
      "placeholder",
      "You have reached the analysis limit for the last 24 hours.",
    );
    expect(screen.getByText(/Daily limit reached/)).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: SUGGESTIONS.questions[0] }),
    ).not.toBeInTheDocument();
  });

  it("shows an error with a retry when the lists cannot be loaded", async () => {
    const user = userEvent.setup();
    let fail = true;
    mockDashboard({
      "GET /api/v1/datasets": () =>
        fail
          ? errorResponse(
              500,
              "internal_error",
              "Something went wrong on our side. Please try again.",
            )
          : jsonResponse({ items: [datasetSummary], total: 1 }),
    });
    renderWithClient(<DashboardView />);

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Your dashboard could not be loaded");
    expect(alert).toHaveTextContent("Something went wrong on our side. Please try again.");
    expect(alert).toHaveTextContent("Request ID: req-test");

    fail = false;
    await user.click(within(alert).getByRole("button", { name: "Try again" }));

    expect(await screen.findByText("Start an analysis")).toBeInTheDocument();
  });

  it("has no detectable accessibility violations", async () => {
    mockDashboard();
    const { container } = renderWithClient(
      <main>
        <DashboardView />
      </main>,
    );
    await screen.findByText("Start an analysis");
    await screen.findByRole("progressbar", { name: "Datasets: 2 of 25" });
    expect(await axe(container)).toHaveNoViolations();
  });
});
