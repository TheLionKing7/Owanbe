import { act, cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { publicAuthConfig } from "@/config/public-auth-config";
import { AuthProvider, useAuth } from "@/lib/auth/AuthProvider";
import type { AuthClient } from "@/lib/auth/types";

vi.mock("@/lib/auth/config.functions", () => ({ getPublicClientConfig: vi.fn() }));

const values = {
  AUTH0_DOMAIN: "https://tenant.example.test/",
  AUTH0_CLIENT_ID: "public-client",
  AUTH0_AUDIENCE: "https://api.example.test",
  EXTERNAL_SUPABASE_URL: "https://external.example.test",
  EXTERNAL_SUPABASE_ANON_KEY: "sb_publishable_example",
};
const settings = publicAuthConfig(values);
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe("Public runtime auth configuration", () => {
  it("returns only public identifiers and selects external settings", () => {
    const config = publicAuthConfig({ ...values, SUPABASE_URL: "https://managed.example.test", SUPABASE_PUBLISHABLE_KEY: "managed-public", EXTERNAL_SUPABASE_SERVICE_ROLE_KEY: "private-test-sentinel", PAYSTACK_SECRET_KEY: "private-payment-sentinel" });
    expect(config).toEqual({ domain: "tenant.example.test", clientId: "public-client", audience: "https://api.example.test", supabaseUrl: "https://external.example.test", supabasePublicKey: "sb_publishable_example" });
    expect(Object.keys(config ?? {})).toHaveLength(5);
  });

  it("fails closed if the Auth0 client ID is missing", () => {
    expect(publicAuthConfig({ ...values, AUTH0_CLIENT_ID: " " })).toBeNull();
  });

  it("rejects a private opaque database key", () => {
    expect(publicAuthConfig({ ...values, EXTERNAL_SUPABASE_ANON_KEY: "sb_secret_test_sentinel" })).toBeNull();
  });

  it("rejects a service-role JWT placed in a public-key setting", () => {
    const key = `eyJhbGciOiJIUzI1NiJ9.${btoa(JSON.stringify({ role: "service_role" }))}.test`;
    expect(publicAuthConfig({ ...values, EXTERNAL_SUPABASE_ANON_KEY: key })).toBeNull();
  });

  it("accepts legacy anonymous public JWTs", () => {
    const key = `eyJhbGciOiJIUzI1NiJ9.${btoa(JSON.stringify({ role: "anon" }))}.test`;
    expect(publicAuthConfig({ ...values, EXTERNAL_SUPABASE_ANON_KEY: key })?.supabasePublicKey).toBe(key);
  });
});

function client(): AuthClient {
  return {
    restoreSession: vi.fn().mockResolvedValue(false), login: vi.fn().mockResolvedValue(undefined), logout: vi.fn().mockResolvedValue(undefined),
    handleRedirectCallback: vi.fn().mockResolvedValue("/host"),
    ensureAppUser: vi.fn().mockResolvedValue({ id: "user", auth0_sub: "auth0|test", status: "active", email: null, display_name: null }),
    listHouses: vi.fn().mockResolvedValue([]),
  };
}

describe("Runtime sign-in startup", () => {
  it("waits for saved settings before restoring the session", async () => {
    const authClient = client();
    const loader = vi.fn().mockResolvedValue(authClient);
    const configLoader = vi.fn().mockResolvedValue(settings);
    let status = "";
    function Probe() { status = useAuth().status; return null; }
    render(<AuthProvider loader={loader} configLoader={configLoader}><Probe /></AuthProvider>);
    await waitFor(() => expect(status).toBe("signedOut"));
    expect(loader).toHaveBeenCalledWith(settings);
    expect(configLoader).toHaveBeenCalledTimes(1);
  });

  it("callback waits for configuration and exchanges a single-use code only once", async () => {
    const authClient = client();
    let auth: ReturnType<typeof useAuth> | undefined;
    function Probe() { auth = useAuth(); return null; }
    render(<AuthProvider loader={vi.fn().mockResolvedValue(authClient)} configLoader={vi.fn().mockResolvedValue(settings)}><Probe /></AuthProvider>);
    await act(async () => {
      if (!auth) throw new Error("Missing test context");
      const results = await Promise.all([auth.completeLogin("https://app.example.test/auth/callback?code=test"), auth.completeLogin("https://app.example.test/auth/callback?code=test")]);
      expect(results).toEqual(["/host", "/host"]);
    });
    expect(authClient.handleRedirectCallback).toHaveBeenCalledTimes(1);
    expect(authClient.ensureAppUser).toHaveBeenCalledTimes(1);
  });

  it("retries failed settings requests rather than caching rejection forever", async () => {
    const configLoader = vi.fn().mockRejectedValueOnce(new Error("network")).mockResolvedValue(settings);
    let auth: ReturnType<typeof useAuth> | undefined;
    function Probe() { auth = useAuth(); return null; }
    render(<AuthProvider loader={vi.fn().mockResolvedValue(client())} configLoader={configLoader}><Probe /></AuthProvider>);
    await waitFor(() => expect(auth?.status).toBe("error"));
    act(() => auth?.retry());
    await waitFor(() => expect(auth?.status).toBe("signedOut"));
    expect(configLoader).toHaveBeenCalledTimes(2);
  });
});