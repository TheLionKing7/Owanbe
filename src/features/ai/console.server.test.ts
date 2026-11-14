import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  readAiAnswersAsCaller,
  readAiCasesAsCaller,
  readMyAiAnswersAsCaller,
  updateAiCaseAsCaller,
} from "./console.server";

const TOKEN = "header.payload.signature";
const CASE_ID = "11111111-1111-4111-8111-111111111111";

const CASE_ROW = {
  case_id: CASE_ID,
  case_reference: "CASE-0123456789AB",
  subject: "The last tranche is still held after the window opened",
  reason: "The host paid in full and the completion window has opened.",
  status: "open",
  priority: "high",
  source: "ai_investigation",
  opened_by: "22222222-2222-4222-8222-222222222222",
  ai_interaction_id: "33333333-3333-4333-8333-333333333333",
  booking_id: null,
  created_at: "2026-11-13T09:00:00.000Z",
  updated_at: "2026-11-13T09:00:00.000Z",
  notes: [
    {
      id: "44444444-4444-4444-8444-444444444444",
      author: "55555555-5555-4555-8555-555555555555",
      body: "Looking at the window.",
      at: "2026-11-13T09:05:00.000Z",
    },
  ],
};

const ANSWER_ROW = {
  interaction_id: "33333333-3333-4333-8333-333333333333",
  created_at: "2026-11-13T09:00:00.000Z",
  surface: "payment_investigation",
  request_summary: "Why has the last tranche not been released?",
  response_text: "The first tranche went out and the last one is still held.",
  reason: "The payment arrived and the window has not closed.",
  outcome: "opened_case",
  model: "openai/gpt-6-astra",
  booking_id: null,
  case_id: CASE_ID,
  case_reference: "CASE-0123456789AB",
  reported_at: null,
  report_category: null,
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

/** Stands in for PostgREST: the call is recorded so the test can see what was asked. */
function stubNetwork(
  handler: (rpc: string, payload: unknown) => { body: unknown; status?: number },
) {
  const calls: { rpc: string; url: string; headers: Record<string, string>; body: string }[] = [];
  const fetchMock = vi.fn(async (url: string, init: RequestInit) => {
    const rpc = String(url).split("/rpc/")[1] ?? "";
    const body = (init.body as string) ?? "";
    calls.push({
      rpc,
      url: String(url),
      headers: (init.headers ?? {}) as Record<string, string>,
      body,
    });
    const answer = handler(rpc, body ? JSON.parse(body) : null);
    return jsonResponse(answer.body, answer.status ?? 200);
  });
  vi.stubGlobal("fetch", fetchMock);
  return { calls, fetchMock };
}

function request(path: string): Request {
  return new Request(`https://owanbe.app${path}`, {
    method: "GET",
    headers: { Authorization: `Bearer ${TOKEN}` },
  });
}

beforeEach(() => {
  vi.stubEnv("EXTERNAL_SUPABASE_URL", "https://project.supabase.co");
  vi.stubEnv("EXTERNAL_SUPABASE_PUBLISHABLE_KEY", "sb_publishable_example");
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("GET /api/ai/cases", () => {
  it("refuses a caller with no token", async () => {
    stubNetwork(() => ({ body: [] }));
    const res = await readAiCasesAsCaller(
      new Request("https://owanbe.app/api/ai/cases", { method: "GET" }),
    );
    expect(res.status).toBe(401);
  });

  it("asks the database for the queue and forwards the caller's own token", async () => {
    const { calls } = stubNetwork(() => ({ body: [CASE_ROW] }));
    const res = await readAiCasesAsCaller(request("/api/ai/cases"));

    expect(res.status).toBe(200);
    expect(calls[0]?.rpc).toBe("read_ai_cases");
    expect(calls[0]?.headers["Authorization"]).toBe(`Bearer ${TOKEN}`);
  });

  it("passes the status filter to the database", async () => {
    const { calls } = stubNetwork(() => ({ body: [] }));
    await readAiCasesAsCaller(request("/api/ai/cases?status=open"));

    expect(calls[0]?.body).toContain('"p_status":"open"');
  });

  it("returns the cases with their notes", async () => {
    stubNetwork(() => ({ body: [CASE_ROW] }));
    const res = await readAiCasesAsCaller(request("/api/ai/cases"));
    const body = (await res.json()) as { cases: { case_id: string; notes: unknown[] }[] };

    expect(body.cases).toHaveLength(1);
    expect(body.cases[0]?.case_id).toBe(CASE_ID);
    expect(body.cases[0]?.notes).toHaveLength(1);
  });

  it("turns the database's refusal into a forbidden answer", async () => {
    stubNetwork(() => ({
      body: { code: "42501", message: "forbidden: ai_investigation grant required" },
      status: 401,
    }));
    const res = await readAiCasesAsCaller(request("/api/ai/cases"));

    expect(res.status).toBe(403);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("forbidden");
  });

  it("keeps the console locked when sign-in is not configured", async () => {
    vi.stubEnv("EXTERNAL_SUPABASE_URL", "");
    vi.stubEnv("EXTERNAL_SUPABASE_PUBLISHABLE_KEY", "");
    stubNetwork(() => ({ body: [] }));
    const res = await readAiCasesAsCaller(request("/api/ai/cases"));

    expect(res.status).toBe(503);
  });
});

describe("GET /api/ai/answers", () => {
  it("asks the database for every answer", async () => {
    const { calls } = stubNetwork(() => ({ body: [ANSWER_ROW] }));
    const res = await readAiAnswersAsCaller(request("/api/ai/answers"));

    expect(res.status).toBe(200);
    expect(calls[0]?.rpc).toBe("read_ai_interactions");
  });

  it("returns the answers as they were shown", async () => {
    stubNetwork(() => ({ body: [ANSWER_ROW] }));
    const res = await readAiAnswersAsCaller(request("/api/ai/answers"));
    const body = (await res.json()) as { answers: { model: string; response_text: string }[] };

    expect(body.answers).toHaveLength(1);
    expect(body.answers[0]?.model).toBe("openai/gpt-6-astra");
    expect(body.answers[0]?.response_text).toContain("still held");
  });

  it("turns the database's refusal into a forbidden answer", async () => {
    stubNetwork(() => ({
      body: { code: "42501", message: "forbidden: ai_investigation grant required" },
      status: 401,
    }));
    const res = await readAiAnswersAsCaller(request("/api/ai/answers"));

    expect(res.status).toBe(403);
  });
});

describe("GET /api/ai/mine", () => {
  it("asks the database for the caller's own answers", async () => {
    const { calls } = stubNetwork(() => ({ body: [ANSWER_ROW] }));
    const res = await readMyAiAnswersAsCaller(request("/api/ai/mine"));

    expect(res.status).toBe(200);
    expect(calls[0]?.rpc).toBe("my_ai_interactions");
    expect(calls[0]?.headers["Authorization"]).toBe(`Bearer ${TOKEN}`);
  });

  it("turns a caller who is not signed in into an unauthorized answer", async () => {
    stubNetwork(() => ({ body: { code: "28000", message: "not_signed_in" }, status: 401 }));
    const res = await readMyAiAnswersAsCaller(request("/api/ai/mine"));

    expect(res.status).toBe(401);
  });
});

describe("POST /api/ai/case", () => {
  function post(body: unknown): Request {
    return new Request("https://owanbe.app/api/ai/case", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${TOKEN}` },
      body: JSON.stringify(body),
    });
  }

  it("refuses a caller with no token", async () => {
    stubNetwork(() => ({ body: CASE_ID }));
    const res = await updateAiCaseAsCaller(
      new Request("https://owanbe.app/api/ai/case", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ case_id: CASE_ID, status: "investigating" }),
      }),
    );
    expect(res.status).toBe(401);
  });

  it("asks the database to move the case", async () => {
    const { calls } = stubNetwork(() => ({ body: CASE_ID }));
    const res = await updateAiCaseAsCaller(
      post({ case_id: CASE_ID, status: "investigating", note: "Looking at the window." }),
    );

    expect(res.status).toBe(200);
    expect(calls[0]?.rpc).toBe("update_ai_case");
    expect(calls[0]?.body).toContain('"p_status":"investigating"');
    expect(calls[0]?.body).toContain("Looking at the window.");
  });

  it("refuses a move that is not a status a case can hold", async () => {
    stubNetwork(() => ({ body: [] }));
    const res = await updateAiCaseAsCaller(post({ case_id: CASE_ID, status: "done" }));

    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("validation");
  });

  it("says what the database said when the move was refused", async () => {
    stubNetwork(() => ({
      body: { code: "22023", message: "invalid_case_transition" },
      status: 400,
    }));
    const res = await updateAiCaseAsCaller(post({ case_id: CASE_ID, status: "closed" }));
    const body = (await res.json()) as { message: string };

    expect(res.status).toBe(400);
    expect(body.message).toContain("cannot go from where it is");
  });

  it("says a case that is not there was not found", async () => {
    stubNetwork(() => ({ body: { code: "P0002", message: "case_not_found" }, status: 404 }));
    const res = await updateAiCaseAsCaller(post({ case_id: CASE_ID, status: "closed" }));

    expect(res.status).toBe(404);
  });

  it("refuses a caller without the grant", async () => {
    stubNetwork(() => ({
      body: { code: "42501", message: "forbidden: ai_investigation grant required" },
      status: 401,
    }));
    const res = await updateAiCaseAsCaller(post({ case_id: CASE_ID, status: "closed" }));

    expect(res.status).toBe(403);
  });
});
