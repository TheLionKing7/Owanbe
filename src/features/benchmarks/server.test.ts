import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readBenchmarksAsCaller } from "./server";

const TOKEN = "header.payload.signature";

const RANGE = {
  category: "Cakes",
  location: "Lagos",
  currency: "NGN",
  observation_count: 2,
  vendor_count: 2,
  min_price_minor: 30_000_000,
  median_price_minor: 40_000_000,
  max_price_minor: 50_000_000,
  oldest_observed_at: "2026-03-12T09:00:00.000Z",
  newest_observed_at: "2026-09-02T09:00:00.000Z",
  source: "vendor_quote",
  published: true,
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function request(body?: unknown): Request {
  const init: RequestInit = {
    method: "POST",
    headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" },
  };
  if (body !== undefined) init.body = JSON.stringify(body);
  return new Request("https://owanbe.app/api/benchmarks", init);
}

/** Stands in for PostgREST: the call is recorded so the test can see what was asked for. */
function stubDatabase(body: unknown = [RANGE], status = 200) {
  const calls: { url: string; headers: Record<string, string>; body: Record<string, unknown> }[] =
    [];
  const fetchMock = vi.fn(async (url: string, init: RequestInit) => {
    calls.push({
      url: String(url),
      headers: (init.headers ?? {}) as Record<string, string>,
      body: JSON.parse((init.body as string) ?? "{}") as Record<string, unknown>,
    });
    return jsonResponse(body, status);
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

describe("POST /benchmarks", () => {
  it("refuses a caller with no token", async () => {
    stubDatabase();
    const res = await readBenchmarksAsCaller(
      new Request("https://owanbe.app/api/benchmarks", { method: "POST" }),
    );
    expect(res.status).toBe(401);
  });

  it("asks the database for the categories and the city", async () => {
    const { calls } = stubDatabase();
    const res = await readBenchmarksAsCaller(request({ categories: ["Cakes"], location: "Lagos" }));

    expect(res.status).toBe(200);
    expect(calls[0]?.url).toContain("/rest/v1/rpc/read_market_benchmarks");
    expect(calls[0]?.body).toEqual({ p_categories: ["Cakes"], p_location: "Lagos" });
  });

  it("forwards the caller's own token to the database", async () => {
    const { calls } = stubDatabase();
    await readBenchmarksAsCaller(request({ categories: ["Cakes"], location: "Lagos" }));

    expect(calls.length).toBeGreaterThan(0);
    for (const call of calls) {
      expect(call.headers["Authorization"]).toBe(`Bearer ${TOKEN}`);
    }
  });

  it("returns the range with the disclosure", async () => {
    stubDatabase();
    const res = await readBenchmarksAsCaller(request({ categories: ["Cakes"], location: "Lagos" }));
    const body = (await res.json()) as {
      ranges: { category: string; published: boolean }[];
      disclosure: string;
    };

    expect(body.ranges).toHaveLength(1);
    expect(body.ranges[0]?.category).toBe("Cakes");
    expect(body.ranges[0]?.published).toBe(true);
    expect(body.disclosure).toBe("Market prices from vendor quotes");
  });

  it("refuses a body the database would refuse", async () => {
    stubDatabase();
    const res = await readBenchmarksAsCaller(request({ categories: [], location: "Lagos" }));
    expect(res.status).toBe(400);
  });

  it("refuses a body it cannot read", async () => {
    stubDatabase();
    const res = await readBenchmarksAsCaller(request());
    expect(res.status).toBe(400);
  });

  it("turns the database's refusal into a forbidden answer", async () => {
    stubDatabase({ code: "42501", message: "forbidden: market benchmarks" }, 401);
    const res = await readBenchmarksAsCaller(request({ categories: ["Cakes"], location: "Lagos" }));
    expect(res.status).toBe(403);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("forbidden");
  });

  it("turns a bad token into an unauthorized answer", async () => {
    stubDatabase({ code: "28000", message: "not_signed_in" }, 401);
    const res = await readBenchmarksAsCaller(request({ categories: ["Cakes"], location: "Lagos" }));
    expect(res.status).toBe(401);
  });

  it("keeps the market locked when sign-in is not configured", async () => {
    vi.stubEnv("EXTERNAL_SUPABASE_URL", "");
    vi.stubEnv("EXTERNAL_SUPABASE_PUBLISHABLE_KEY", "");
    stubDatabase();
    const res = await readBenchmarksAsCaller(request({ categories: ["Cakes"], location: "Lagos" }));
    expect(res.status).toBe(503);
  });
});
