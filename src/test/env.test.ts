import { afterEach, describe, expect, it, vi } from "vitest";

describe("APP_ORIGIN", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it("uses the configured APP_ORIGIN without a trailing slash", async () => {
    vi.stubEnv("VITE_APP_ORIGIN", "https://owanbe.example/");
    const { APP_ORIGIN, absoluteUrl } = await import("@/config/env");
    expect(APP_ORIGIN).toBe("https://owanbe.example");
    expect(absoluteUrl("host/plan")).toBe("https://owanbe.example/host/plan");
  });

  it("falls back to the browser origin when unset", async () => {
    vi.stubEnv("VITE_APP_ORIGIN", "");
    const { APP_ORIGIN } = await import("@/config/env");
    expect(APP_ORIGIN).toBe(window.location.origin);
  });

  it("accepts the managed publishable key while preserving Auth0 authority", async () => {
    vi.stubEnv("VITE_AUTH0_DOMAIN", "tenant.auth0.com");
    vi.stubEnv("VITE_AUTH0_CLIENT_ID", "client");
    vi.stubEnv("VITE_AUTH0_AUDIENCE", "https://api.example.test");
    vi.stubEnv("VITE_SUPABASE_URL", "https://database.example.test");
    vi.stubEnv("VITE_SUPABASE_PUBLISHABLE_KEY", "sb_publishable_test");
    const { readAuthEnv } = await import("@/config/env");
    expect(readAuthEnv()?.supabasePublicKey).toBe("sb_publishable_test");
    expect(readAuthEnv()?.domain).toBe("tenant.auth0.com");
  });
});
