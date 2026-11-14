import { act, fireEvent, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { dataset, usage } from "@/test/fixtures";
import { FakeXhr, mockApi, renderWithClient } from "@/test/utils";
import { DatasetUploader } from "./dataset-uploader";

const csvFile = () => new File(["region,revenue\nEurope,10\n"], "sales.csv", { type: "text/csv" });
const workbook = () =>
  new File(["PK-fake-workbook"], "quarterly.xlsx", {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });

const apiError = (code: string, message: string, details?: unknown) => ({
  error: { code, message, request_id: "req-1", details },
});

async function setup() {
  // applyAccept is off so tests can also offer a file type the picker would normally hide.
  const user = userEvent.setup({ applyAccept: false });
  const onUploaded = vi.fn();
  const api = mockApi({ "GET /api/v1/users/me/usage": usage });
  const view = renderWithClient(<DatasetUploader onUploaded={onUploaded} />);
  // Limits come from the API and are shown before a file is chosen.
  await screen.findByText(/up to 20\.0 MB/);
  return { user, onUploaded, api, ...view };
}

const fileInput = () => screen.getByLabelText("Choose a dataset file");

beforeEach(() => {
  FakeXhr.install();
});

describe("DatasetUploader", () => {
  it("uploads a chosen file, shows real progress, then hands the dataset to the caller", async () => {
    const { user, onUploaded } = await setup();
    const file = csvFile();

    await user.upload(fileInput(), file);

    const xhr = FakeXhr.last;
    expect(xhr.url).toBe("/api/v1/datasets");
    expect(xhr.body?.get("file")).toBe(file);
    expect(screen.getByText("sales.csv")).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("Uploading… 0%");

    act(() => xhr.progress(42, 100));
    expect(screen.getByRole("status")).toHaveTextContent("Uploading… 42%");
    expect(screen.getByRole("progressbar", { name: "Upload progress" })).toHaveAttribute(
      "aria-valuenow",
      "42",
    );

    // All bytes sent: the server is now parsing, which has no measurable progress.
    act(() => xhr.progress(100, 100));
    expect(screen.getByRole("status")).toHaveTextContent(
      "Upload complete. Validating and profiling the data…",
    );
    expect(screen.getByRole("progressbar", { name: "Upload progress" })).not.toHaveAttribute(
      "aria-valuenow",
    );
    expect(onUploaded).not.toHaveBeenCalled();

    act(() => xhr.respond(201, dataset));
    await waitFor(() => expect(onUploaded).toHaveBeenCalledWith(dataset));
  });

  it("asks which sheet to import when the workbook has several, then resends the same file", async () => {
    const { user, onUploaded } = await setup();
    const file = workbook();

    await user.upload(fileInput(), file);
    act(() =>
      FakeXhr.last.respond(
        409,
        apiError(
          "sheet_selection_required",
          "This workbook has several sheets. Choose the one to import.",
          {
            sheets: ["Summary", "Raw data", "Notes"],
          },
        ),
      ),
    );

    const group = await screen.findByRole("group", { name: "Choose a sheet to import" });
    expect(group).toHaveTextContent("quarterly.xlsx has 3 sheets");
    expect(screen.getByRole("radio", { name: "Summary" })).toBeChecked();
    expect(FakeXhr.instances).toHaveLength(1);

    await user.click(screen.getByRole("radio", { name: "Raw data" }));
    await user.click(screen.getByRole("button", { name: "Import sheet" }));

    expect(FakeXhr.instances).toHaveLength(2);
    const second = FakeXhr.last;
    expect(second.body?.get("file")).toBe(file);
    expect(second.body?.get("sheet")).toBe("Raw data");

    act(() => second.respond(201, { ...dataset, sheet_name: "Raw data" }));
    await waitFor(() =>
      expect(onUploaded).toHaveBeenCalledWith(expect.objectContaining({ sheet_name: "Raw data" })),
    );
  });

  it("shows the API's message when a file is rejected and returns to the picker", async () => {
    const { user, onUploaded } = await setup();

    await user.upload(fileInput(), csvFile());
    act(() =>
      FakeXhr.last.respond(
        422,
        apiError(
          "malformed_file",
          "This file could not be read as CSV. Check the delimiter and encoding.",
        ),
      ),
    );

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "This file could not be read as CSV. Check the delimiter and encoding.",
    );
    expect(onUploaded).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Choose file" })).toBeEnabled();
  });

  it.each([
    [413, "too_many_rows", "This file has more rows than the 250,000 allowed."],
    [
      429,
      "storage_quota_exceeded",
      "You have reached your storage quota. Delete a dataset to free space.",
    ],
  ])("surfaces a %i %s error", async (status, code, message) => {
    const { user } = await setup();

    await user.upload(fileInput(), csvFile());
    act(() => FakeXhr.last.respond(status, apiError(code, message)));

    expect(await screen.findByRole("alert")).toHaveTextContent(message);
  });

  it("rejects an unsupported file type without sending anything", async () => {
    const { user } = await setup();

    await user.upload(fileInput(), new File(["%PDF"], "report.pdf", { type: "application/pdf" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "This file type is not supported. Upload a CSV, TSV, XLSX or XLS file.",
    );
    expect(FakeXhr.instances).toHaveLength(0);
  });

  it("rejects a file over the account's upload limit without sending anything", async () => {
    const { user } = await setup();
    const big = new File([new Uint8Array(usage.max_upload_bytes + 1)], "huge.csv", {
      type: "text/csv",
    });

    await user.upload(fileInput(), big);

    expect(await screen.findByRole("alert")).toHaveTextContent("The limit is 20 MB.");
    expect(FakeXhr.instances).toHaveLength(0);
  });

  it("cancels an upload in flight", async () => {
    const { user, onUploaded } = await setup();

    await user.upload(fileInput(), csvFile());
    await user.click(screen.getByRole("button", { name: "Cancel" }));

    expect(FakeXhr.last.aborted).toBe(true);
    expect(await screen.findByRole("button", { name: "Choose file" })).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(onUploaded).not.toHaveBeenCalled();
  });

  it("uploads the bundled sample through the same upload path", async () => {
    const user = userEvent.setup();
    const onUploaded = vi.fn();
    const api = mockApi({
      "GET /api/v1/users/me/usage": usage,
      "GET /samples/sample_sales.csv": new Response("order_id,revenue\nORD-1,10\n", {
        headers: { "Content-Type": "text/csv" },
      }),
    });
    renderWithClient(<DatasetUploader onUploaded={onUploaded} />);

    await user.click(screen.getByRole("button", { name: "Try the sample dataset" }));

    await waitFor(() => expect(FakeXhr.instances).toHaveLength(1));
    expect(api.calls.some((call) => call.path === "/samples/sample_sales.csv")).toBe(true);
    const sent = FakeXhr.last.body?.get("file") as File;
    expect(sent.name).toBe("sample_sales.csv");
    expect(await sent.text()).toBe("order_id,revenue\nORD-1,10\n");

    act(() => FakeXhr.last.respond(201, dataset));
    await waitFor(() => expect(onUploaded).toHaveBeenCalledWith(dataset));
  });

  it("accepts a dropped file", async () => {
    const { onUploaded } = await setup();
    const file = csvFile();
    const zone = screen.getByText("Drag a file here, or choose one").closest("div[data-dragging]")!;

    fireEvent.dragOver(zone, { dataTransfer: { files: [file] } });
    expect(zone).toHaveAttribute("data-dragging", "true");
    fireEvent.drop(zone, { dataTransfer: { files: [file] } });

    await waitFor(() => expect(FakeXhr.instances).toHaveLength(1));
    expect(FakeXhr.last.body?.get("file")).toBe(file);
    act(() => FakeXhr.last.respond(201, dataset));
    await waitFor(() => expect(onUploaded).toHaveBeenCalled());
  });
});
