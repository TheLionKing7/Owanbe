import { afterEach, describe, expect, it, vi } from "vitest";
import {
  BenchmarkError,
  benchmarkErrorMessage,
  createBenchmarkApi,
  fetchBenchmarkRanges,
} from "./api";
import type { BenchmarkRequest } from "./contracts";

const TOKEN = "header.payload.signature";

const REQUEST: BenchmarkRequest = { categories: ["Cakes"], location: "Lagos" };

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("benchmark api", () => {
  it("posts the request with the caller's token", async () => {
    const fetchMock = vi.fn(async (_url: string, _init: RequestInit) =>
      jsonResponse({
        ranges: [
          {
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
          },
        ],
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await fetchBenchmarkRanges(REQUEST, TOKEN);

    expect(result.ranges).toHaveLength(1);
    expect(result.ranges[0]?.category).toBe("Cakes");
    expect(result.ranges[0]?.published).toBe(true);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/benchmarks");
    expect(init.method).toBe("POST");
    expect((init.headers as Record<string, string>)["Authorization"]).toBe(`Bearer ${TOKEN}`);
    expect(JSON.parse(init.body as string)).toEqual(REQUEST);
  });

  it("refuses to call without a token", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    await expect(fetchBenchmarkRanges(REQUEST, null)).rejects.toBeInstanceOf(BenchmarkError);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("explains a refusal in plain language", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse({ error: "forbidden", message: "raw text" }, 403)),
    );
    await expect(fetchBenchmarkRanges(REQUEST, TOKEN)).rejects.toMatchObject({ code: "forbidden" });
    await fetchBenchmarkRanges(REQUEST, TOKEN).catch((error: unknown) => {
      expect(benchmarkErrorMessage(error)).toBe(
        "Market prices are only shown to hosts in a house and to the analytics team.",
      );
    });
  });

  it("keeps the field's own words for a validation refusal", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse({ error: "validation", message: "Tell us the city." }, 400)),
    );
    await fetchBenchmarkRanges(REQUEST, TOKEN).catch((error: unknown) => {
      expect(benchmarkErrorMessage(error)).toBe("Tell us the city.");
    });
  });

  it("reads an unreadable answer as an unknown failure", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("not json", { status: 502 })),
    );
    await expect(fetchBenchmarkRanges(REQUEST, TOKEN)).rejects.toMatchObject({ code: "unknown" });
  });
});

describe("createBenchmarkApi", () => {
  it("uses the token reader for every call", async () => {
    const fetchMock = vi.fn(async (_url: string, _init: RequestInit) =>
      jsonResponse({ ranges: [] }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const getAccessToken = vi.fn(async () => TOKEN);

    const api = createBenchmarkApi(getAccessToken);
    await api.read(REQUEST);

    expect(getAccessToken).toHaveBeenCalled();
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect((init.headers as Record<string, string>)["Authorization"]).toBe(`Bearer ${TOKEN}`);
  });
});
