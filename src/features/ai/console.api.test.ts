import { afterEach, describe, expect, it, vi } from "vitest";
import {
  AiConsoleError,
  createAiConsoleApi,
  fetchAiAnswers,
  fetchAiCases,
  fetchMyAiAnswers,
  updateAiCase,
} from "./console.api";

const TOKEN = "header.payload.signature";
const CASE_ID = "11111111-1111-4111-8111-111111111111";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function stubFetch(handler: (url: string) => { body: unknown; status?: number }) {
  const calls: { url: string; init: RequestInit }[] = [];
  const fetchMock = vi.fn(async (url: string, init: RequestInit) => {
    calls.push({ url: String(url), init });
    const answer = handler(String(url));
    return jsonResponse(answer.body, answer.status ?? 200);
  });
  vi.stubGlobal("fetch", fetchMock);
  return { calls, fetchMock };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("the OwanbeAI console's browser boundary", () => {
  it("asks the app's own route for the case queue", async () => {
    const { calls } = stubFetch(() => ({ body: { cases: [] } }));
    await fetchAiCases(TOKEN);

    expect(calls[0]?.url).toBe("/api/ai/cases");
    expect((calls[0]?.init.headers as Record<string, string>)["Authorization"]).toBe(
      `Bearer ${TOKEN}`,
    );
  });

  it("narrows the queue by status", async () => {
    const { calls } = stubFetch(() => ({ body: { cases: [] } }));
    await fetchAiCases(TOKEN, "open");

    expect(calls[0]?.url).toBe("/api/ai/cases?status=open");
  });

  it("asks the app's own route for the answers", async () => {
    const { calls } = stubFetch(() => ({ body: { answers: [] } }));
    await fetchAiAnswers(TOKEN);

    expect(calls[0]?.url).toBe("/api/ai/answers");
  });

  it("asks the app's own route for the caller's own answers", async () => {
    const { calls } = stubFetch(() => ({ body: { answers: [] } }));
    await fetchMyAiAnswers(TOKEN);

    expect(calls[0]?.url).toBe("/api/ai/mine");
  });

  it("refuses to call the app without a token", async () => {
    stubFetch(() => ({ body: { cases: [] } }));

    await expect(fetchAiCases(null)).rejects.toBeInstanceOf(AiConsoleError);
  });

  it("turns the route's refusal into a forbidden error", async () => {
    stubFetch(() => ({
      body: { error: "forbidden", message: "This console is for platform staff." },
      status: 403,
    }));

    await expect(fetchAiCases(TOKEN)).rejects.toMatchObject({ code: "forbidden" });
  });

  it("works a case through the app's own route", async () => {
    const { calls } = stubFetch(() => ({ body: { case_id: CASE_ID } }));
    await updateAiCase(TOKEN, { case_id: CASE_ID, status: "investigating", note: "Looking." });

    expect(calls[0]?.url).toBe("/api/ai/case");
    expect(calls[0]?.init.method).toBe("POST");
    expect(String(calls[0]?.init.body)).toContain('"status":"investigating"');
  });

  it("injects the token reader so the panel can be rendered without an auth provider", async () => {
    const { calls } = stubFetch(() => ({ body: { answers: [] } }));
    const api = createAiConsoleApi(async () => TOKEN);
    await api.mine();

    expect(calls[0]?.url).toBe("/api/ai/mine");
  });
});
