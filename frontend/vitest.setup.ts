import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { createElement, type AnchorHTMLAttributes, type ReactNode } from "react";
import { afterEach, beforeEach, expect, vi } from "vitest";
import * as axeMatchers from "vitest-axe/matchers";
import { resetRequestActivity } from "@/lib/api/activity";
import { setUnauthorizedHandler } from "@/lib/api/client";
import { router } from "@/test/next-navigation";

expect.extend(axeMatchers);

// The app router is not mounted in unit tests; navigation is observed through this stub.
vi.mock("next/navigation", () => ({
  useRouter: () => router,
  usePathname: () => "/app",
  useSearchParams: () => new URLSearchParams(),
  useParams: () => ({}),
}));

vi.mock("next/link", () => ({
  default: ({
    href,
    children,
    ...props
  }: AnchorHTMLAttributes<HTMLAnchorElement> & { href: string; children?: ReactNode }) =>
    createElement("a", { href, ...props }, children),
}));

/**
 * jsdom has no layout. This stand-in reports a fixed size as soon as an element is observed,
 * which is enough for charts to draw and for Radix popovers to position themselves.
 */
class ResizeObserverStub implements ResizeObserver {
  constructor(private readonly callback: ResizeObserverCallback) {}

  observe(target: Element): void {
    const size = { inlineSize: 640, blockSize: 320 };
    const entry = {
      target,
      contentRect: {
        width: 640,
        height: 320,
        top: 0,
        left: 0,
        bottom: 320,
        right: 640,
        x: 0,
        y: 0,
      },
      borderBoxSize: [size],
      contentBoxSize: [size],
      devicePixelContentBoxSize: [size],
    } as unknown as ResizeObserverEntry;
    this.callback([entry], this);
  }

  unobserve(): void {}

  disconnect(): void {}
}

vi.stubGlobal("ResizeObserver", ResizeObserverStub);

if (!window.matchMedia) {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: (query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      addListener: () => undefined,
      removeListener: () => undefined,
      dispatchEvent: () => false,
    }),
  });
}

// jsdom has no canvas; libraries that probe for one get "unsupported" instead of a console error.
HTMLCanvasElement.prototype.getContext = (() =>
  null) as typeof HTMLCanvasElement.prototype.getContext;

// Radix menus and dialogs call these, and jsdom does not implement them.
Element.prototype.scrollIntoView = vi.fn();
Element.prototype.hasPointerCapture = vi.fn(() => false);
Element.prototype.setPointerCapture = vi.fn();
Element.prototype.releasePointerCapture = vi.fn();

beforeEach(() => {
  // Every test declares the requests it expects; anything else is a failure, not a hang.
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      throw new Error(`fetch was not mocked for ${String(input)}`);
    }),
  );
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllEnvs();
  for (const cookie of document.cookie.split(";")) {
    const name = cookie.split("=")[0]?.trim();
    if (name) document.cookie = `${name}=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/`;
  }
  for (const mock of Object.values(router)) mock.mockReset();
  setUnauthorizedHandler(null);
  resetRequestActivity();
});
