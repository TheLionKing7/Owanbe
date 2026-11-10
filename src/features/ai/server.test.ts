import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { generateStructured } = vi.hoisted(() => ({ generateStructured: vi.fn() }));
vi.mock("@/lib/ai/provider.server", () => ({
  AI_MODELS: {
    planner: "openai/gpt-6-astra",
    vendorCopy: "openai/gpt-6-astra",
    investigation: "openai/gpt-6-astra",
  },
  generateStructured,
}));

import { aiStatusAsCaller, investigatePaymentAsCaller, reportInteractionAsCaller } from "./server";

const TOKEN = "header.payload.signature";
const BOOKING_ID = "7a2e9c4a-2b3d-4e5f-8a7b-1c2d3e4f5a6b";
const INTERACTION_ID = "6f1e9c4a-2b3d-4e5f-8a7b-1c2d3e4f5a6b";
const CASE_ID = "8b3f0d5b-3c4d-5f6a-9b8c-2d3e4f5a6b7c";

const LOG_ROW = {
  booking_id: BOOKING_ID,
  booking_status: "paid",
  pool_status: "held",
  currency: "NGN",
  total_minor: 5_000_000,
  paid_minor: 2_500_000,
  held_minor: 2_500_000,
  released_minor: 0,
  refunded_minor: 0,
  frozen: false,
  release_30_due_at: "2026-11-20T10:00:00.000Z",
  paid_at: "2026-11-09T10:00:00.000Z",
  completed_at: null,
  refunded_at: null,
  movement_count: 3,
  event_count: 2,
  failed_event_count: 1,
  hours_since_paid: 26,
};

const EVENT_ROW = {
  event_id: "9c4a1e6c-4d5e-6f7a-8b9c-3e4f5a6b7c8d",
  event_type: "charge.failed",
  outcome: "declined",
  amount_minor: 2_500_000,
  currency: "NGN",
  occurred_at: "2026-11-09T09:59:00.000Z",
};

interface RpcFailure {
  status: number;
  body: { code: string; message: string };
}

interface RpcCalls {
  log?: unknown;
  logFailure?: RpcFailure;
  events?: unknown;
  eventsFailure?: RpcFailure;
  interact?: unknown;
  case?: unknown;
  report?: unknown;
  reportFailure?: RpcFailure;
  status?: unknown;
}

/** A PostgREST refusal: an HTTP status and the SQLSTATE the database raised. */
function refusal(status: number, code: string, message: string): RpcFailure {
  return { status, body: { code, message } };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

/** Stands in for PostgREST: each function answers with what the case needs. */
function stubDatabase(overrides: RpcCalls = {}) {
  const calls: { rpc: string; body: Record<string, unknown>; headers: Record<string, string> }[] =
    [];
  const fetchMock = vi.fn(async (url: string, init: RequestInit) => {
    const rpc = String(url).split("/").pop() ?? "";
    const body = JSON.parse((init.body as string) ?? "{}") as Record<string, unknown>;
    const headers = (init.headers ?? {}) as Record<string, string>;
    calls.push({ rpc, body, headers });

    if (rpc === "ai_payment_log") {
      return overrides.logFailure
        ? jsonResponse(overrides.logFailure.body, overrides.logFailure.status)
        : jsonResponse(overrides.log ?? [LOG_ROW]);
    }
    if (rpc === "ai_payment_event_log") {
      return overrides.eventsFailure
        ? jsonResponse(overrides.eventsFailure.body, overrides.eventsFailure.status)
        : jsonResponse(overrides.events ?? [EVENT_ROW]);
    }
    if (rpc === "log_ai_interaction") return jsonResponse(overrides.interact ?? INTERACTION_ID);
    if (rpc === "open_ai_case") return jsonResponse(overrides.case ?? CASE_ID);
    if (rpc === "report_ai_interaction") {
      return overrides.reportFailure
        ? jsonResponse(overrides.reportFailure.body, overrides.reportFailure.status)
        : jsonResponse(overrides.report ?? null);
    }
    if (rpc === "ai_investigation_status") {
      return jsonResponse(
        overrides.status ?? [{ zdr_confirmed: true, has_grant: true, can_investigate: true }],
      );
    }
    return jsonResponse({ code: "42883", message: "unexpected rpc" }, 404);
  });
  vi.stubGlobal("fetch", fetchMock);
  return { calls, fetchMock };
}

function request(path: string, body?: unknown): Request {
  const init: RequestInit = {
    method: "POST",
    headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" },
  };
  if (body !== undefined) init.body = JSON.stringify(body);
  return new Request(`https://owanbe.app${path}`, init);
}

beforeEach(() => {
  vi.stubEnv("EXTERNAL_SUPABASE_URL", "https://project.supabase.co");
  vi.stubEnv("EXTERNAL_SUPABASE_PUBLISHABLE_KEY", "sb_publishable_example");
  generateStructured.mockReset();
  generateStructured.mockResolvedValue({
    ok: true,
    value: {
      summary: "The trail looks normal.",
      finding: "no_issue",
      subject: "",
      reason: "",
      priority: "normal",
    },
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("POST /ai/report", () => {
  it("refuses a caller with no token", async () => {
    stubDatabase();
    const res = await reportInteractionAsCaller(
      new Request("https://owanbe.app/api/ai/report", { method: "POST" }),
    );
    expect(res.status).toBe(401);
    expect(generateStructured).not.toHaveBeenCalled();
  });

  it("refuses a report the database would refuse", async () => {
    stubDatabase();
    const res = await reportInteractionAsCaller(
      request("/api/ai/report", { interaction_id: "not-a-uuid", category: "other" }),
    );
    expect(res.status).toBe(400);
  });

  it("sends the report as the caller", async () => {
    const { calls } = stubDatabase();
    const res = await reportInteractionAsCaller(
      request("/api/ai/report", {
        interaction_id: INTERACTION_ID,
        category: "wrong_facts",
        note: "Wrong city",
      }),
    );
    expect(res.status).toBe(200);

    const reported = calls.find((call) => call.rpc === "report_ai_interaction");
    expect(reported?.body["p_interaction"]).toBe(INTERACTION_ID);
    expect(reported?.body["p_category"]).toBe("wrong_facts");
    expect(reported?.body["p_note"]).toBe("Wrong city");
    expect(reported?.headers["Authorization"]).toBe(`Bearer ${TOKEN}`);
  });

  it("says an answer cannot be reported twice", async () => {
    stubDatabase({
      reportFailure: refusal(400, "22023", "already_reported"),
    });
    const res = await reportInteractionAsCaller(
      request("/api/ai/report", { interaction_id: INTERACTION_ID, category: "other" }),
    );
    expect(res.status).toBe(400);
    expect((await res.json()).message).toContain("already been reported");
  });
});

describe("GET /ai/status", () => {
  it("refuses a caller with no token", async () => {
    stubDatabase();
    const res = await aiStatusAsCaller(
      new Request("https://owanbe.app/api/ai/status", { method: "GET" }),
    );
    expect(res.status).toBe(401);
  });

  it("says the tool is open when the grant and the contract are both in place", async () => {
    stubDatabase();
    const res = await aiStatusAsCaller(
      new Request("https://owanbe.app/api/ai/status", {
        headers: { Authorization: `Bearer ${TOKEN}` },
      }),
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ available: true, reason: null });
  });

  it("says the tool is closed while the zero-retention contract is unconfirmed", async () => {
    stubDatabase({
      status: [{ zdr_confirmed: false, has_grant: true, can_investigate: false }],
    });
    const res = await aiStatusAsCaller(
      new Request("https://owanbe.app/api/ai/status", {
        headers: { Authorization: `Bearer ${TOKEN}` },
      }),
    );
    expect(await res.json()).toEqual({ available: false, reason: "zdr_pending" });
  });

  it("says the tool is closed when the caller holds no grant", async () => {
    stubDatabase({
      status: [{ zdr_confirmed: true, has_grant: false, can_investigate: false }],
    });
    const res = await aiStatusAsCaller(
      new Request("https://owanbe.app/api/ai/status", {
        headers: { Authorization: `Bearer ${TOKEN}` },
      }),
    );
    expect(await res.json()).toEqual({ available: false, reason: "no_grant" });
  });
});

describe("POST /ai/investigate", () => {
  it("refuses a caller with no token", async () => {
    stubDatabase();
    const res = await investigatePaymentAsCaller(
      new Request("https://owanbe.app/api/ai/investigate", { method: "POST" }),
    );
    expect(res.status).toBe(401);
    expect(generateStructured).not.toHaveBeenCalled();
  });

  it("refuses a booking link the database would refuse", async () => {
    stubDatabase();
    const res = await investigatePaymentAsCaller(
      request("/api/ai/investigate", { booking_id: "nope" }),
    );
    expect(res.status).toBe(400);
    expect(generateStructured).not.toHaveBeenCalled();
  });

  it("refuses a caller who holds no grant", async () => {
    stubDatabase({
      logFailure: refusal(403, "42501", "forbidden: ai_investigation grant required"),
    });
    const res = await investigatePaymentAsCaller(
      request("/api/ai/investigate", { booking_id: BOOKING_ID }),
    );
    expect(res.status).toBe(403);
    expect(generateStructured).not.toHaveBeenCalled();
  });

  it("stays closed while the zero-retention contract is unconfirmed", async () => {
    stubDatabase({
      logFailure: refusal(400, "22023", "zdr_contract_required"),
    });
    const res = await investigatePaymentAsCaller(
      request("/api/ai/investigate", { booking_id: BOOKING_ID }),
    );
    expect(res.status).toBe(503);
    expect((await res.json()).error).toBe("locked");
    expect(generateStructured).not.toHaveBeenCalled();
  });

  it("forwards the caller's own token to the database", async () => {
    const { calls } = stubDatabase();
    await investigatePaymentAsCaller(request("/api/ai/investigate", { booking_id: BOOKING_ID }));
    expect(calls.length).toBeGreaterThan(0);
    for (const call of calls) {
      expect(call.headers["Authorization"]).toBe(`Bearer ${TOKEN}`);
    }
  });

  it("gives the model only the minimised trail and no name of a person", async () => {
    stubDatabase();
    await investigatePaymentAsCaller(
      request("/api/ai/investigate", {
        booking_id: BOOKING_ID,
        question: "Why is the money still held?",
      }),
    );

    const call = generateStructured.mock.calls.at(0);
    expect(call).toBeDefined();
    const prompt = call?.[0] as { prompt: string; sensitive?: boolean; zdrConfirmed?: boolean };
    expect(prompt.sensitive).toBe(true);
    expect(prompt.zdrConfirmed).toBe(true);
    expect(prompt.prompt).toContain("held 2500000");
    expect(prompt.prompt).toContain("NGN");
    expect(prompt.prompt).toContain("Why is the money still held?");
    expect(prompt.prompt).not.toContain("Adeola");
    expect(prompt.prompt).not.toContain("@");
  });

  it("logs the answer so it can be reported", async () => {
    const { calls } = stubDatabase();
    const res = await investigatePaymentAsCaller(
      request("/api/ai/investigate", { booking_id: BOOKING_ID }),
    );
    expect(res.status).toBe(200);

    const body = (await res.json()) as {
      interaction_id: string;
      disclosure: string;
      finding: string;
      case_id: string | null;
    };
    expect(body.interaction_id).toBe(INTERACTION_ID);
    expect(body.disclosure).toBe("AI investigation");
    expect(body.finding).toBe("no_issue");
    expect(body.case_id).toBeNull();

    const logged = calls.find((call) => call.rpc === "log_ai_interaction");
    expect(logged?.body["p_surface"]).toBe("payment_investigation");
    expect(logged?.body["p_booking"]).toBe(BOOKING_ID);
    expect(logged?.body["p_outcome"]).toBe("no_issue");
  });

  it("opens a case when the investigation asks for one", async () => {
    generateStructured.mockResolvedValue({
      ok: true,
      value: {
        summary: "A failed charge is still counted as paid.",
        finding: "case_opened",
        subject: "Payment trail mismatch",
        reason: "The failed charge is counted as a paid movement in the ledger.",
        priority: "high",
      },
    });
    const { calls } = stubDatabase();
    const res = await investigatePaymentAsCaller(
      request("/api/ai/investigate", { booking_id: BOOKING_ID }),
    );

    const body = (await res.json()) as { finding: string; case_id: string | null };
    expect(body.finding).toBe("case_opened");
    expect(body.case_id).toBe(CASE_ID);

    const opened = calls.find((call) => call.rpc === "open_ai_case");
    expect(opened?.body["p_interaction"]).toBe(INTERACTION_ID);
    expect(opened?.body["p_subject"]).toBe("Payment trail mismatch");
    expect(opened?.body["p_priority"]).toBe("high");
  });

  it("does not open a case when the answer has no usable subject", async () => {
    generateStructured.mockResolvedValue({
      ok: true,
      value: {
        summary: "Something looks wrong.",
        finding: "case_opened",
        subject: "",
        reason: "",
        priority: "normal",
      },
    });
    const { calls } = stubDatabase();
    const res = await investigatePaymentAsCaller(
      request("/api/ai/investigate", { booking_id: BOOKING_ID }),
    );

    const body = (await res.json()) as { finding: string; case_id: string | null };
    expect(body.finding).toBe("needs_human");
    expect(body.case_id).toBeNull();
    expect(calls.some((call) => call.rpc === "open_ai_case")).toBe(false);
  });

  it("never calls a function that can move money", async () => {
    const { calls } = stubDatabase();
    await investigatePaymentAsCaller(request("/api/ai/investigate", { booking_id: BOOKING_ID }));

    const money = /refund|release|settle|freeze|unfreeze|complete|allocate|transfer|payout/i;
    for (const call of calls) {
      expect(call.rpc).not.toMatch(money);
    }
  });

  it("says the model is not set up when the gateway key is missing", async () => {
    generateStructured.mockResolvedValue({
      ok: false,
      failure: { code: "unconfigured", retryable: false },
    });
    stubDatabase();
    const res = await investigatePaymentAsCaller(
      request("/api/ai/investigate", { booking_id: BOOKING_ID }),
    );
    expect(res.status).toBe(503);
    expect((await res.json()).error).toBe("unconfigured");
  });

  it("reports a rate limit as something the caller can retry", async () => {
    generateStructured.mockResolvedValue({
      ok: false,
      failure: { code: "rate_limited", retryable: true },
    });
    stubDatabase();
    const res = await investigatePaymentAsCaller(
      request("/api/ai/investigate", { booking_id: BOOKING_ID }),
    );
    expect(res.status).toBe(429);
  });
});
