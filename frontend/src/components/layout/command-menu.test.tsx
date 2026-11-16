import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { analysisSummary, datasetSummary } from "@/test/fixtures";
import { router } from "@/test/next-navigation";
import { mockApi, renderWithClient } from "@/test/utils";
import { CommandMenu } from "./command-menu";

function mockLists() {
  return mockApi({
    "GET /api/v1/analyses": {
      items: [analysisSummary({ id: "a-1", title: "Revenue growth by region" })],
      total: 1,
    },
    "GET /api/v1/datasets": { items: [datasetSummary], total: 1 },
  });
}

describe("CommandMenu", () => {
  it("opens with Ctrl+K and jumps to a page", async () => {
    const user = userEvent.setup();
    mockLists();
    renderWithClient(<CommandMenu />);

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    await user.keyboard("{Control>}k{/Control}");

    const dialog = await screen.findByRole("dialog", { name: "Search and commands" });
    // A partial name ranks the page whose name starts with it first ("set" is also in "dataset").
    await user.type(within(dialog).getByRole("combobox"), "set");
    await waitFor(() =>
      expect(within(dialog).getAllByRole("option")[0]).toHaveTextContent("Settings"),
    );
    await user.keyboard("{Enter}");

    expect(router.push).toHaveBeenCalledWith("/app/settings");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("lists recent analyses and datasets once opened", async () => {
    const user = userEvent.setup();
    const api = mockLists();
    renderWithClient(<CommandMenu />);

    // Nothing is fetched until the palette is opened.
    expect(api.calls).toHaveLength(0);
    await user.click(screen.getByRole("button", { name: "Search and commands" }));

    const analysis = await screen.findByRole("option", { name: /Revenue growth by region/ });
    expect(await screen.findByRole("option", { name: /sample_sales/ })).toBeInTheDocument();

    await user.click(analysis);
    expect(router.push).toHaveBeenCalledWith("/app/analyses/a-1");
  });

  it("says when nothing matches", async () => {
    const user = userEvent.setup();
    mockLists();
    renderWithClient(<CommandMenu />);

    await user.keyboard("{Meta>}k{/Meta}");
    const dialog = await screen.findByRole("dialog");
    await user.type(within(dialog).getByRole("combobox"), "zzzz-no-match");

    expect(await within(dialog).findByText("No results.")).toBeInTheDocument();
  });
});
