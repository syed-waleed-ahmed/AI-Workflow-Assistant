import { vi } from "vitest";

/** The router stub returned by the mocked `useRouter`; tests assert on these calls. */
export const router = {
  push: vi.fn(),
  replace: vi.fn(),
  refresh: vi.fn(),
  back: vi.fn(),
  forward: vi.fn(),
  prefetch: vi.fn(),
};
