import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readObservabilityAsCaller } from "./server";

const TOKEN = "header.payload.signature";

const SIGNALS = [
  {
    signal_key: "payment_ambiguity",
    signal_label: "Provider events with no outcome",
    signal_value: 1,
    detail: "A payment event nobody has decided yet.",
    severity: "critical",
  },
  {
    signal_key: "unread_alerts",
    signal_label: "Unread house alerts",
    signal_value: 4,
    detail: "Alerts written to a house that nobody has read.",
    severity: "info",
  },
];

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function request(): Request {
  return new Request("https://owanbe.app/api/observability", {
    method: "GET",
    headers: { Authorization: `Bearer ${TOKEN}` },
  });
}

/** Stands in for PostgREST and for Sentry: the call is recorded so the test can see what was asked. */
function stubNetwork(dashboard: unknown = SIGNALS, dashboardStatus = 200, sentry: unknown = null) {
  const calls: { url: string; headers: Record<string, string>; body: string }[] = [];
  const fetchMock = vi.fn(async (url: string, init: RequestInit) => {
    calls.push({
      url: String(url),
      headers: (init.headers ?? {}) as Record<string, string>,
      body: (init.body as string) ?? "",
    });
    if (String(url).includes("sentry.io")) return jsonResponse(sentry ?? []);
    return jsonResponse(dashboard, dashboardStatus);
  });
  vi.stubGlobal("fetch", fetchMock);
  return { calls, fetchMock };
}

beforeEach(() => {
  vi.stubEnv("EXTERNAL_SUPABASE_URL", "https://project.supabase.co");
  vi.stubEnv("EXTERNAL_SUPABASE_PUBLISHABLE_KEY", "sb_publishable_example");
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("GET /api/observability", () => {
  it("refuses a caller with no token", async () => {
    stubNetwork();
    const res = await readObservabilityAsCaller(
      new Request("https://owanbe.app/api/observability", { method: "GET" }),
    );
    expect(res.status).toBe(401);
  });

  it("asks the database for the dashboard", async () => {
    const { calls } = stubNetwork();
    const res = await readObservabilityAsCaller(request());

    expect(res.status).toBe(200);
    expect(calls[0]?.url).toContain("/rest/v1/rpc/observability_dashboard");
  });

  it("forwards the caller's own token to the database", async () => {
    const { calls } = stubNetwork();
    await readObservabilityAsCaller(request());

    expect(calls.length).toBeGreaterThan(0);
    for (const call of calls) {
      expect(call.headers["Authorization"]).toBe(`Bearer ${TOKEN}`);
    }
  });

  it("returns the signals with the disclosure", async () => {
    stubNetwork();
    const res = await readObservabilityAsCaller(request());
    const body = (await res.json()) as {
      signals: { signal_key: string; value: number; severity: string }[];
      disclosure: string;
      read_at: string;
    };

    expect(body.signals).toHaveLength(2);
    expect(body.signals[0]?.signal_key).toBe("payment_ambiguity");
    expect(body.signals[0]?.value).toBe(1);
    expect(body.signals[0]?.severity).toBe("critical");
    expect(body.disclosure).toBe("Counters from the platform's own operational records");
    expect(body.read_at).not.toBe("");
  });

  it("turns the database's refusal into a forbidden answer", async () => {
    stubNetwork({ code: "42501", message: "forbidden: operations grant required" }, 401);
    const res = await readObservabilityAsCaller(request());

    expect(res.status).toBe(403);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("forbidden");
  });

  it("turns a bad token into an unauthorized answer", async () => {
    stubNetwork({ code: "28000", message: "not_signed_in" }, 401);
    const res = await readObservabilityAsCaller(request());

    expect(res.status).toBe(401);
  });

  it("keeps the dashboard locked when sign-in is not configured", async () => {
    vi.stubEnv("EXTERNAL_SUPABASE_URL", "");
    vi.stubEnv("EXTERNAL_SUPABASE_PUBLISHABLE_KEY", "");
    stubNetwork();
    const res = await readObservabilityAsCaller(request());

    expect(res.status).toBe(503);
  });

  it("adds the error counts when the observability tool answers", async () => {
    vi.stubEnv("SENTRY_AUTH_TOKEN", "sntrys_example");
    vi.stubEnv("SENTRY_ORG", "owanbe");
    vi.stubEnv("SENTRY_PROJECT", "app");
    const { calls } = stubNetwork(SIGNALS, 200, [{ id: "1" }, { id: "2" }, { id: "3" }]);

    const res = await readObservabilityAsCaller(request());
    const body = (await res.json()) as {
      error_tracking: { unresolved_issues: number; capped_at: number; window_hours: number } | null;
    };

    expect(body.error_tracking?.unresolved_issues).toBe(3);
    expect(body.error_tracking?.capped_at).toBe(100);
    expect(body.error_tracking?.window_hours).toBe(24);
    const sentryCall = calls.find((call) => call.url.includes("sentry.io"));
    expect(sentryCall?.headers["Authorization"]).toBe("Bearer sntrys_example");
  });

  it("shows the platform's counters even when the observability tool does not answer", async () => {
    vi.stubEnv("SENTRY_AUTH_TOKEN", "sntrys_example");
    vi.stubEnv("SENTRY_ORG", "owanbe");
    vi.stubEnv("SENTRY_PROJECT", "app");
    stubNetwork(SIGNALS, 200, { detail: "not found" });

    const res = await readObservabilityAsCaller(request());
    const body = (await res.json()) as {
      signals: unknown[];
      error_tracking: unknown;
    };

    expect(res.status).toBe(200);
    expect(body.signals).toHaveLength(2);
    expect(body.error_tracking).toBeNull();
  });
});
