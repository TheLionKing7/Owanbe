import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FundsError, calculateSplitAllocation, createFundsApi, fundsErrorMessage } from "./api";

const TOKEN = "header.payload.signature";
const ACTION_ID = "6f1e9c4a-2b3d-4e5f-8a7b-1c2d3e4f5a6b";
const CASE_ID = "2a5b8c1d-4e6f-4a8b-9c0d-1e2f3a4b5c6d";

const rpc = vi.fn();

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    rpc: (...args: unknown[]) => rpc(...args),
  },
}));

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

beforeEach(() => {
  rpc.mockReset();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("fundsErrorMessage", () => {
  it("gives every kind of refusal a sentence", () => {
    expect(fundsErrorMessage(new FundsError("forbidden", "x"))).toBe(
      "This console is for platform staff.",
    );
    expect(fundsErrorMessage(new FundsError("unauthorized", "x"))).toBe(
      "Sign in to open the recovery console.",
    );
  });

  it("passes the server's own sentence through for a validation problem", () => {
    expect(
      fundsErrorMessage(new FundsError("validation", "There is nothing left to take back.")),
    ).toBe("There is nothing left to take back.");
  });

  it("does not show the raw text of an unknown error", () => {
    expect(fundsErrorMessage(new Error("secret internal detail"))).toBe(
      "Something went wrong. Try again in a moment.",
    );
  });
});

describe("reading the recovery fund", () => {
  it("reads the balances through the database's own projection", async () => {
    rpc.mockResolvedValue({ data: [{ currency: "NGN", balance_minor: 1000 }], error: null });
    const api = createFundsApi(async () => TOKEN);

    const balances = await api.balances();

    expect(balances[0]?.balance_minor).toBe(1000);
    expect(rpc).toHaveBeenCalledWith("recovery_fund_balances", {});
  });

  it("reads the requests, the pools and the case behind them", async () => {
    rpc.mockImplementation(async (name: string) => {
      if (name === "recovery_case_context") {
        return { data: [{ case_id: CASE_ID, currency: "NGN" }], error: null };
      }
      return { data: [], error: null };
    });
    const api = createFundsApi(async () => TOKEN);

    await api.actions();
    await api.duePools();
    const context = await api.caseContext(CASE_ID);

    expect(context.case_id).toBe(CASE_ID);
    expect(rpc).toHaveBeenCalledWith("list_recovery_actions", {});
    expect(rpc).toHaveBeenCalledWith("due_fund_pools", {});
    expect(rpc).toHaveBeenCalledWith("recovery_case_context", { p_case: CASE_ID });
  });

  it("refuses a case the database does not have", async () => {
    rpc.mockResolvedValue({ data: [], error: null });
    const api = createFundsApi(async () => TOKEN);

    await expect(api.caseContext(CASE_ID)).rejects.toMatchObject({ code: "not_found" });
  });

  it("turns the database's refusal into a refusal the console can explain", async () => {
    rpc.mockResolvedValue({ data: null, error: { message: "forbidden: staff grant required" } });
    const api = createFundsApi(async () => TOKEN);

    await expect(api.balances()).rejects.toMatchObject({ code: "forbidden" });
  });
});

describe("the split of a booking total", () => {
  it("asks the app's own route, so the database does the arithmetic", async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse({ release_70: 70000, release_30: 30000, vendor_net_70: 68250 }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const split = await calculateSplitAllocation(100000, "NGN", TOKEN);

    expect(split.release_70).toBe(70000);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("/api/funds/allocate");
    expect(init.method).toBe("POST");
    expect((init.headers as Record<string, string>)["Authorization"]).toBe(`Bearer ${TOKEN}`);
    expect(JSON.parse(String(init.body))).toEqual({ total_minor: 100000, currency: "NGN" });
  });

  it("refuses to call the route with no signed-in caller", async () => {
    const fetchMock = vi.fn(async () => jsonResponse({}));
    vi.stubGlobal("fetch", fetchMock);

    await expect(calculateSplitAllocation(100000, "NGN", null)).rejects.toMatchObject({
      code: "unauthorized",
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("refuses a response that is not a split", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse({})),
    );
    await expect(calculateSplitAllocation(100000, "NGN", TOKEN)).rejects.toMatchObject({
      code: "unknown",
    });
  });
});

describe("the actions on the recovery money", () => {
  it("asks for money with the case, the amount and the reason", async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ action_id: ACTION_ID }, 201));
    vi.stubGlobal("fetch", fetchMock);
    const api = createFundsApi(async () => TOKEN);

    await api.requestRecovery({
      kind: "clawback",
      case_id: CASE_ID,
      amount_minor: 5000,
      reason: "The vendor did not deliver",
    });

    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("/api/funds/recovery");
    expect(JSON.parse(String(init.body))).toEqual({
      kind: "clawback",
      case_id: CASE_ID,
      amount_minor: 5000,
      reason: "The vendor did not deliver",
    });
  });

  it("records a decision through the app's own route", async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ outcome: "awaiting_approval" }));
    vi.stubGlobal("fetch", fetchMock);
    const api = createFundsApi(async () => TOKEN);

    const outcome = await api.decide({ action_id: ACTION_ID, decision: "approved" });

    expect(outcome).toBe("awaiting_approval");
    const [url] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("/api/funds/approvals");
  });

  it("moves the money only through the settlement route", async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse({ outcome: "settled", provider_reference: "RB-1" }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const api = createFundsApi(async () => TOKEN);

    const result = await api.settle(ACTION_ID);

    expect(result.outcome).toBe("settled");
    expect(result.provider_reference).toBe("RB-1");
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("/api/funds/settle");
    expect(JSON.parse(String(init.body))).toEqual({ action_id: ACTION_ID });
  });

  it("runs the reconciliation through the app's own route", async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse({
        events_checked: 3,
        pools_checked: 2,
        matched: 5,
        exception_count: 0,
        exceptions: [],
      }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const api = createFundsApi(async () => TOKEN);

    const report = await api.reconcile();

    expect(report.events_checked).toBe(3);
    const [url] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("/api/funds/reconcile");
  });

  it("reads the app's refusal as a code", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        jsonResponse({ error: "forbidden", message: "This console is for platform staff." }, 403),
      ),
    );
    const api = createFundsApi(async () => TOKEN);

    await expect(api.release("6f1e9c4a-2b3d-4e5f-8a7b-1c2d3e4f5a6b")).rejects.toMatchObject({
      code: "forbidden",
    });
  });
});
