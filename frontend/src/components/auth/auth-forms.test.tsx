import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { hardNavigate } from "@/lib/navigation";
import { axe } from "@/test/axe";
import { user as account } from "@/test/fixtures";
import { errorResponse, jsonResponse, mockApi, renderWithClient } from "@/test/utils";
import { LoginForm } from "./login-form";
import { RegisterForm } from "./register-form";

vi.mock("@/lib/navigation", () => ({ hardNavigate: vi.fn() }));

beforeEach(() => {
  vi.mocked(hardNavigate).mockReset();
});

describe("LoginForm", () => {
  it("shows validation errors and sends nothing when the form is empty", async () => {
    const user = userEvent.setup();
    const api = mockApi({});
    renderWithClient(<LoginForm />);

    await user.click(screen.getByRole("button", { name: "Sign in" }));

    expect(await screen.findByText("Enter your email address.")).toBeInTheDocument();
    expect(screen.getByText("Enter your password.")).toBeInTheDocument();
    expect(screen.getByLabelText("Email")).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByLabelText("Email")).toHaveAccessibleDescription("Enter your email address.");
    expect(api.calls).toHaveLength(0);
  });

  it("rejects a malformed email address before submitting", async () => {
    const user = userEvent.setup();
    const api = mockApi({});
    renderWithClient(<LoginForm />);

    await user.type(screen.getByLabelText("Email"), "ada@example");
    await user.type(screen.getByLabelText("Password"), "correct horse 42");
    await user.click(screen.getByRole("button", { name: "Sign in" }));

    expect(await screen.findByText("Enter a valid email address.")).toBeInTheDocument();
    expect(api.calls).toHaveLength(0);
  });

  it("signs in and continues to the page the person was trying to reach", async () => {
    const user = userEvent.setup();
    const api = mockApi({ "POST /api/v1/auth/login": account });
    renderWithClient(<LoginForm nextPath="/app/reports/42" />);

    await user.type(screen.getByLabelText("Email"), "ada@example.com");
    await user.type(screen.getByLabelText("Password"), "correct horse 42");
    await user.click(screen.getByRole("button", { name: "Sign in" }));

    await waitFor(() => expect(hardNavigate).toHaveBeenCalledWith("/app/reports/42"));
    expect(api.calls[0]?.body).toEqual({ email: "ada@example.com", password: "correct horse 42" });
    expect(api.calls[0]?.init.credentials).toBe("same-origin");
    // The button stays busy until the browser has navigated away.
    expect(screen.getByRole("button", { name: "Sign in" })).toBeDisabled();
  });

  it("ignores a next parameter that points outside the app", async () => {
    const user = userEvent.setup();
    mockApi({ "POST /api/v1/auth/login": account });
    renderWithClient(<LoginForm nextPath="https://evil.example/app" />);

    await user.type(screen.getByLabelText("Email"), "ada@example.com");
    await user.type(screen.getByLabelText("Password"), "correct horse 42");
    await user.click(screen.getByRole("button", { name: "Sign in" }));

    await waitFor(() => expect(hardNavigate).toHaveBeenCalledWith("/app"));
  });

  it("shows the server's message when the credentials are wrong and lets the person retry", async () => {
    const user = userEvent.setup();
    mockApi({
      "POST /api/v1/auth/login": errorResponse(
        401,
        "invalid_credentials",
        "Incorrect email or password.",
      ),
    });
    renderWithClient(<LoginForm />);

    await user.type(screen.getByLabelText("Email"), "ada@example.com");
    await user.type(screen.getByLabelText("Password"), "wrong password 1");
    await user.click(screen.getByRole("button", { name: "Sign in" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Incorrect email or password.");
    expect(hardNavigate).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Sign in" })).toBeEnabled();
  });

  it("surfaces rate limiting", async () => {
    const user = userEvent.setup();
    mockApi({
      "POST /api/v1/auth/login": errorResponse(
        429,
        "rate_limited",
        "Too many attempts. Try again in a minute.",
      ),
    });
    renderWithClient(<LoginForm />);

    await user.type(screen.getByLabelText("Email"), "ada@example.com");
    await user.type(screen.getByLabelText("Password"), "correct horse 42");
    await user.click(screen.getByRole("button", { name: "Sign in" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Too many attempts. Try again in a minute.",
    );
  });

  it("toggles password visibility", async () => {
    const user = userEvent.setup();
    renderWithClient(<LoginForm />);
    const password = screen.getByLabelText("Password");

    expect(password).toHaveAttribute("type", "password");
    await user.click(screen.getByRole("button", { name: "Show password" }));
    expect(password).toHaveAttribute("type", "text");
    await user.click(screen.getByRole("button", { name: "Hide password" }));
    expect(password).toHaveAttribute("type", "password");
  });

  it("explains an expired session and keeps the destination in the register link", () => {
    renderWithClient(<LoginForm nextPath="/app/datasets" expired />);
    expect(screen.getByRole("status")).toHaveTextContent(
      "Your session has expired. Sign in again to continue.",
    );
    expect(screen.getByRole("link", { name: "Create an account" })).toHaveAttribute(
      "href",
      "/register?next=%2Fapp%2Fdatasets",
    );
  });

  it("has no detectable accessibility violations, including in the error state", async () => {
    const user = userEvent.setup();
    const { container } = renderWithClient(
      <main>
        <h1>Sign in</h1>
        <LoginForm />
      </main>,
    );
    expect(await axe(container)).toHaveNoViolations();

    await user.click(screen.getByRole("button", { name: "Sign in" }));
    await screen.findByText("Enter your password.");
    expect(await axe(container)).toHaveNoViolations();
  });
});

describe("RegisterForm", () => {
  async function fill(user: ReturnType<typeof userEvent.setup>, password: string) {
    await user.type(screen.getByLabelText("Name"), "Ada Lovelace");
    await user.type(screen.getByLabelText("Email"), "ada@example.com");
    await user.type(screen.getByLabelText("Password"), password);
    await user.click(screen.getByRole("button", { name: "Create account" }));
  }

  it("requires every field", async () => {
    const user = userEvent.setup();
    const api = mockApi({});
    renderWithClient(<RegisterForm />);

    await user.click(screen.getByRole("button", { name: "Create account" }));

    expect(await screen.findByText("Enter your name.")).toBeInTheDocument();
    expect(screen.getByText("Enter your email address.")).toBeInTheDocument();
    expect(screen.getByText("Password must be at least 10 characters long.")).toBeInTheDocument();
    expect(api.calls).toHaveLength(0);
  });

  it.each([
    ["short1!", "Password must be at least 10 characters long."],
    ["12345678901234", "Password is too simple. Mix letters, numbers or symbols."],
    ["aaaaaaaaaaaab", "Password is too simple. Mix letters, numbers or symbols."],
  ])("applies the API's password rules before submitting (%s)", async (password, message) => {
    const user = userEvent.setup();
    const api = mockApi({});
    renderWithClient(<RegisterForm />);

    await fill(user, password);

    expect(await screen.findByText(message)).toBeInTheDocument();
    expect(screen.getByLabelText("Password")).toHaveAttribute("aria-invalid", "true");
    expect(api.calls).toHaveLength(0);
  });

  it("creates the account and opens the app", async () => {
    const user = userEvent.setup();
    const api = mockApi({ "POST /api/v1/auth/register": jsonResponse(account, 201) });
    renderWithClient(<RegisterForm />);

    await fill(user, "correct horse 42");

    await waitFor(() => expect(hardNavigate).toHaveBeenCalledWith("/app"));
    expect(api.calls[0]?.body).toEqual({
      name: "Ada Lovelace",
      email: "ada@example.com",
      password: "correct horse 42",
    });
  });

  it("shows the server's message when the email is already registered", async () => {
    const user = userEvent.setup();
    mockApi({
      "POST /api/v1/auth/register": errorResponse(
        409,
        "email_taken",
        "An account with this email already exists.",
      ),
    });
    renderWithClient(<RegisterForm />);

    await fill(user, "correct horse 42");

    expect(
      await screen.findByText("An account with this email already exists."),
    ).toBeInTheDocument();
    expect(hardNavigate).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Create account" })).toBeEnabled();
  });

  it("attaches field-level messages from a 422 to the matching field", async () => {
    const user = userEvent.setup();
    mockApi({
      "POST /api/v1/auth/register": errorResponse(
        422,
        "validation_error",
        "Enter a valid email address.",
        [{ field: "email", message: "Enter a valid email address." }],
      ),
    });
    renderWithClient(<RegisterForm />);

    await fill(user, "correct horse 42");

    await waitFor(() =>
      expect(screen.getByLabelText("Email")).toHaveAttribute("aria-invalid", "true"),
    );
    expect(screen.getByLabelText("Email")).toHaveAccessibleDescription(
      "Enter a valid email address.",
    );
  });

  it("describes the password rules to assistive technology", () => {
    renderWithClient(<RegisterForm />);
    expect(screen.getByLabelText("Password")).toHaveAccessibleDescription(
      "At least 10 characters. Mix letters, numbers or symbols.",
    );
  });
});
