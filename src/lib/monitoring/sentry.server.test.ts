import { afterEach, describe, expect, it, vi } from "vitest";
import { readSentryIssueSummary, sentryConfigured } from "./sentry.server";

const ENV = {
  SENTRY_AUTH_TOKEN: "sntrys_example",
  SENTRY_ORG: "owanbe",
  SENTRY_PROJECT: "app",
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("F-126 Sentry summary", () => {
  it("knows when the environment cannot ask Sentry", () => {
    expect(sentryConfigured(ENV)).toBe(true);
    expect(sentryConfigured({})).toBe(false);
    expect(sentryConfigured({ ...ENV, SENTRY_AUTH_TOKEN: "  " })).toBe(false);
  });

  it("counts the issues and keeps the token in the header", async () => {
    const fetchMock = vi.fn(
      async (_url: string, _init: RequestInit) =>
        new Response(JSON.stringify([{ id: "1" }, { id: "2" }])),
    );
    vi.stubGlobal("fetch", fetchMock);

    const summary = await readSentryIssueSummary(ENV);

    expect(summary?.unresolved_issues).toBe(2);
    expect(summary?.capped_at).toBe(100);
    expect(summary?.window_hours).toBe(24);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toContain("sentry.io/api/0/projects/owanbe/app/issues/");
    expect((init.headers as Record<string, string>)["Authorization"]).toBe("Bearer sntrys_example");
  });

  it("asks for nothing when the environment is not configured", async () => {
    const fetchMock = vi.fn(async () => new Response("[]"));
    vi.stubGlobal("fetch", fetchMock);

    expect(await readSentryIssueSummary({})).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("answers nothing when Sentry cannot be reached", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("network down");
      }),
    );
    expect(await readSentryIssueSummary(ENV)).toBeNull();
  });

  it("answers nothing when Sentry says no", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("{}", { status: 403 })),
    );
    expect(await readSentryIssueSummary(ENV)).toBeNull();
  });

  it("answers nothing when the answer is not a list of issues", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ detail: "nope" }))),
    );
    expect(await readSentryIssueSummary(ENV)).toBeNull();
  });
});
