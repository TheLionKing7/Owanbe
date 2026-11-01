import { afterEach, describe, expect, it, vi } from "vitest";

describe("APP_ORIGIN", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it("uses the configured APP_ORIGIN without a trailing slash", async () => {
    vi.stubEnv("APP_ORIGIN", "https://owanbe.example/");
    const { APP_ORIGIN, absoluteUrl } = await import("@/config/env");
    expect(APP_ORIGIN).toBe("https://owanbe.example");
    expect(absoluteUrl("host/plan")).toBe("https://owanbe.example/host/plan");
  });

  it("falls back to the browser origin when unset", async () => {
    vi.stubEnv("APP_ORIGIN", "");
    const { APP_ORIGIN } = await import("@/config/env");
    expect(APP_ORIGIN).toBe(window.location.origin);
  });
});
