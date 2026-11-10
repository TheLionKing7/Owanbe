import { afterEach, describe, expect, it, vi } from "vitest";
import {
  PlannerError,
  createPlannerApi,
  generatePlan,
  plannerErrorMessage,
  reportPlan,
} from "./api";
import { PLANNER_DISCLOSURE, type PlannerInput } from "./contracts";

const TOKEN = "header.payload.signature";
const INTERACTION_ID = "6f1e9c4a-2b3d-4e5f-8a7b-1c2d3e4f5a6b";

const INPUT: PlannerInput = {
  event_type: "Wedding",
  city: "Lagos",
  guest_count: 150,
  budget_minor: 5_000_000_00,
  budget_currency: "NGN",
  brief: "A traditional wedding with a small band.",
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("planner api", () => {
  it("posts the request with the caller's token", async () => {
    const fetchMock = vi.fn(async (_url: string, _init: RequestInit) =>
      jsonResponse({
        interaction_id: INTERACTION_ID,
        disclosure: PLANNER_DISCLOSURE,
        plan: { summary: "A plan.", options: [], removed_vendors: 0, unknown_prices: 0 },
        grounding: { removed_vendors: 0, unknown_prices: 0 },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await generatePlan(INPUT, TOKEN);

    expect(result.interaction_id).toBe(INTERACTION_ID);
    expect(result.disclosure).toBe(PLANNER_DISCLOSURE);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/planner/generate");
    expect(init.method).toBe("POST");
    expect((init.headers as Record<string, string>)["Authorization"]).toBe(`Bearer ${TOKEN}`);
    expect(JSON.parse(init.body as string)).toEqual(INPUT);
  });

  it("refuses to call without a token", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    await expect(generatePlan(INPUT, null)).rejects.toBeInstanceOf(PlannerError);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("explains a refusal in plain language", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse({ error: "forbidden", message: "raw text" }, 403)),
    );
    await expect(generatePlan(INPUT, TOKEN)).rejects.toMatchObject({ code: "forbidden" });
    await generatePlan(INPUT, TOKEN).catch((error: unknown) => {
      expect(plannerErrorMessage(error)).toBe(
        "The planner is a Host house tool, and you are not in one.",
      );
    });
  });

  it("keeps the field's own words for a validation refusal", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse({ error: "validation", message: "Tell us the city." }, 400)),
    );
    await generatePlan(INPUT, TOKEN).catch((error: unknown) => {
      expect(plannerErrorMessage(error)).toBe("Tell us the city.");
    });
  });

  it("reads a rate limit as a rate limit", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        jsonResponse({ error: "rate_limited", message: "Give it 12 seconds." }, 429),
      ),
    );
    await expect(generatePlan(INPUT, TOKEN)).rejects.toMatchObject({ code: "rate_limited" });
  });

  it("sends a report for one answer", async () => {
    const fetchMock = vi.fn(async (_url: string, _init: RequestInit) =>
      jsonResponse({ interaction_id: INTERACTION_ID }, 200),
    );
    vi.stubGlobal("fetch", fetchMock);

    await reportPlan(INTERACTION_ID, "wrong_facts", TOKEN, "The hall is in Lagos, not Abuja");

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/planner/report");
    expect(JSON.parse(init.body as string)).toEqual({
      interaction_id: INTERACTION_ID,
      category: "wrong_facts",
      note: "The hall is in Lagos, not Abuja",
    });
  });
});

describe("createPlannerApi", () => {
  it("uses the token reader for every call", async () => {
    const fetchMock = vi.fn(async (_url: string, _init: RequestInit) =>
      jsonResponse({
        interaction_id: INTERACTION_ID,
        disclosure: PLANNER_DISCLOSURE,
        plan: { summary: "A plan.", options: [], removed_vendors: 0, unknown_prices: 0 },
        grounding: { removed_vendors: 0, unknown_prices: 0 },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const getAccessToken = vi.fn(async () => TOKEN);

    const api = createPlannerApi(getAccessToken);
    await api.generate(INPUT);

    expect(getAccessToken).toHaveBeenCalled();
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect((init.headers as Record<string, string>)["Authorization"]).toBe(`Bearer ${TOKEN}`);
  });
});
