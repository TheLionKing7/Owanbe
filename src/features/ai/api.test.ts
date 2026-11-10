import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AiError, fetchAiStatus, investigatePayment, reportAiInteraction } from "./api";

const TOKEN = "header.payload.signature";
const INTERACTION_ID = "6f1e9c4a-2b3d-4e5f-8a7b-1c2d3e4f5a6b";
const BOOKING_ID = "7a2e9c4a-2b3d-4e5f-8a7b-1c2d3e4f5a6b";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

beforeEach(() => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_url: string, _init?: RequestInit) => jsonResponse({})),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("reporting an AI answer", () => {
  it("sends the report with the caller's own token", async () => {
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) =>
      jsonResponse({ interaction_id: INTERACTION_ID }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await reportAiInteraction(INTERACTION_ID, "wrong_facts", TOKEN, "The city is wrong");

    const call = fetchMock.mock.calls.at(0);
    expect(call?.[0]).toBe("/api/ai/report");
    const init = call?.[1] as RequestInit;
    expect(init.headers).toMatchObject({ Authorization: `Bearer ${TOKEN}` });
    expect(JSON.parse(String(init.body))).toEqual({
      interaction_id: INTERACTION_ID,
      category: "wrong_facts",
      note: "The city is wrong",
    });
  });

  it("will not report without a token", async () => {
    await expect(reportAiInteraction(INTERACTION_ID, "wrong_facts", null)).rejects.toBeInstanceOf(
      AiError,
    );
  });

  it("turns the database's refusal into the reason it gave", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, _init?: RequestInit) =>
        jsonResponse({ error: "forbidden", message: "raw" }, 403),
      ),
    );
    await expect(reportAiInteraction(INTERACTION_ID, "wrong_facts", TOKEN)).rejects.toMatchObject({
      code: "forbidden",
    });
  });
});

describe("the OwanbeAI status", () => {
  it("reads whether the tool may be shown", async () => {
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) =>
      jsonResponse({ available: true, reason: null }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const status = await fetchAiStatus(TOKEN);
    expect(status.available).toBe(true);
    expect(status.reason).toBeNull();
    expect((fetchMock.mock.calls.at(0)?.[1] as RequestInit).headers).toMatchObject({
      Authorization: `Bearer ${TOKEN}`,
    });
  });

  it("says why the tool is closed", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, _init?: RequestInit) =>
        jsonResponse({ available: false, reason: "no_grant" }),
      ),
    );
    const status = await fetchAiStatus(TOKEN);
    expect(status.available).toBe(false);
    expect(status.reason).toBe("no_grant");
  });
});

describe("asking OwanbeAI", () => {
  it("sends the booking and the question, and returns the answer", async () => {
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) =>
      jsonResponse({
        interaction_id: INTERACTION_ID,
        disclosure: "AI investigation",
        summary: "The money is still held.",
        finding: "needs_human",
        case_id: null,
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await investigatePayment(BOOKING_ID, TOKEN, "Why is it held?");

    expect(result.summary).toBe("The money is still held.");
    expect(result.finding).toBe("needs_human");
    expect(result.case_id).toBeNull();

    const init = fetchMock.mock.calls.at(0)?.[1] as RequestInit;
    expect(JSON.parse(String(init.body))).toEqual({
      booking_id: BOOKING_ID,
      question: "Why is it held?",
    });
  });

  it("refuses an answer it cannot read", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, _init?: RequestInit) =>
        jsonResponse({ error: "locked", message: "closed" }, 503),
      ),
    );
    await expect(investigatePayment(BOOKING_ID, TOKEN)).rejects.toMatchObject({ code: "locked" });
  });
});
