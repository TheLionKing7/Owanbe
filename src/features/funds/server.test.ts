import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  allocateSplitAsCaller,
  decideRecoveryAsCaller,
  reconcileLedgerAsCaller,
  releaseTrancheAsCaller,
  requestRecoveryAsCaller,
  settleRecoveryAsCaller,
} from "./server";

const callAsCaller = vi.fn();

vi.mock("@/lib/db/caller.server", () => ({
  callAsCaller: (...args: unknown[]) => callAsCaller(...args),
  callerToken: (request: Request) => {
    const header = request.headers.get("authorization");
    const token = header?.startsWith("Bearer ") ? header.slice(7).trim() : "";
    return token.split(".").length === 3 ? token : null;
  },
}));

const reconcileLedger = vi.fn();
const sendRefund = vi.fn();
const settleRecoveryAction = vi.fn();

vi.mock("@/lib/payments/router.server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/payments/router.server")>();
  return {
    ...actual,
    reconcileLedger: (...args: unknown[]) => reconcileLedger(...args),
    sendRefund: (...args: unknown[]) => sendRefund(...args),
    settleRecoveryAction: (...args: unknown[]) => settleRecoveryAction(...args),
  };
});

const TOKEN = "header.payload.signature";
const ACTION_ID = "6f1e9c4a-2b3d-4e5f-8a7b-1c2d3e4f5a6b";
const CASE_ID = "2a5b8c1d-4e6f-4a8b-9c0d-1e2f3a4b5c6d";
const BOOKING_ID = "8d3c2b1a-9e0f-4a7b-8c6d-5e4f3a2b1c0d";

function request(url: string, body?: unknown, token: string | null = TOKEN): Request {
  const init: RequestInit = { method: body === undefined ? "GET" : "POST" };
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (token) headers["Authorization"] = `Bearer ${token}`;
  if (body !== undefined) init.body = JSON.stringify(body);
  return new Request(`https://owanbe.app${url}`, { ...init, headers });
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

/** The database's own refusal, as PostgREST sends it. */
function refusal(code: string, message: string, status = 400): Response {
  return jsonResponse({ code, message, details: null, hint: null }, status);
}

beforeEach(() => {
  callAsCaller.mockReset();
  reconcileLedger.mockReset();
  sendRefund.mockReset();
  settleRecoveryAction.mockReset();
  process.env["FUND_POOL_WALLET_ID"] = "platform-fund-wallet";
});

afterEach(() => {
  delete process.env["FUND_POOL_WALLET_ID"];
});

describe("the split of a booking total", () => {
  it("asks the database as the caller and returns what it says", async () => {
    callAsCaller.mockResolvedValue(
      jsonResponse([
        {
          release_70: 70000,
          release_30: 30000,
          commission_70: 1750,
          tax_70: 0,
          vendor_net_70: 68250,
          commission_30: 750,
          tax_30: 0,
          vendor_net_30: 29250,
        },
      ]),
    );

    const res = await allocateSplitAsCaller(
      request("/api/funds/allocate", { total_minor: 100000, currency: "ngn" }),
    );

    expect(res.status).toBe(200);
    const body = (await res.json()) as { release_70: number };
    expect(body.release_70).toBe(70000);
    expect(callAsCaller).toHaveBeenCalledWith("calculate_split_allocation", TOKEN, {
      p_total_minor: 100000,
      p_currency: "NGN",
    });
  });

  it("refuses a signed-out caller", async () => {
    const res = await allocateSplitAsCaller(
      request("/api/funds/allocate", { total_minor: 100000, currency: "NGN" }, null),
    );

    expect(res.status).toBe(401);
    expect(callAsCaller).not.toHaveBeenCalled();
  });

  it("refuses an amount that is not a whole number of minor units", async () => {
    const res = await allocateSplitAsCaller(
      request("/api/funds/allocate", { total_minor: 10.5, currency: "NGN" }),
    );

    expect(res.status).toBe(400);
    expect(callAsCaller).not.toHaveBeenCalled();
  });

  it("passes the database's own refusal on as a sentence", async () => {
    callAsCaller.mockResolvedValue(refusal("22023", "invalid_total"));

    const res = await allocateSplitAsCaller(
      request("/api/funds/allocate", { total_minor: 100000, currency: "NGN" }),
    );

    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string; message: string };
    expect(body.error).toBe("validation");
    expect(body.message).toBe("That amount cannot be split.");
  });

  it("keeps a caller without a staff grant out", async () => {
    callAsCaller.mockResolvedValue(refusal("42501", "forbidden: staff grant required", 403));

    const res = await allocateSplitAsCaller(
      request("/api/funds/allocate", { total_minor: 100000, currency: "NGN" }),
    );

    expect(res.status).toBe(403);
  });
});

describe("releasing the last tranche", () => {
  it("asks the database as the caller", async () => {
    callAsCaller.mockResolvedValue(jsonResponse("released"));

    const res = await releaseTrancheAsCaller(
      request("/api/funds/release", { booking_id: BOOKING_ID }),
    );

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ outcome: "released" });
    expect(callAsCaller).toHaveBeenCalledWith("release_due_tranche", TOKEN, {
      p_booking: BOOKING_ID,
    });
  });

  it("says what the rules decided when the money may not go out", async () => {
    callAsCaller.mockResolvedValue(jsonResponse("frozen"));

    const res = await releaseTrancheAsCaller(
      request("/api/funds/release", { booking_id: BOOKING_ID }),
    );

    expect(await res.json()).toEqual({ outcome: "frozen" });
  });
});

describe("asking for money to move", () => {
  it("takes the amount back from the vendor, with the platform's own wallet", async () => {
    callAsCaller.mockResolvedValue(jsonResponse(ACTION_ID));

    const res = await requestRecoveryAsCaller(
      request("/api/funds/recovery", {
        kind: "clawback",
        case_id: CASE_ID,
        amount_minor: 5000,
        reason: "The vendor did not deliver",
      }),
    );

    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ action_id: ACTION_ID });
    expect(callAsCaller).toHaveBeenCalledWith("request_recovery_clawback", TOKEN, {
      p_case: CASE_ID,
      p_amount_minor: 5000,
      p_reason: "The vendor did not deliver",
      p_fund_wallet: "platform-fund-wallet",
    });
  });

  it("takes the cost of the replacement for an advance", async () => {
    callAsCaller.mockResolvedValue(jsonResponse(ACTION_ID));

    await requestRecoveryAsCaller(
      request("/api/funds/recovery", {
        kind: "advance",
        case_id: CASE_ID,
        replacement_cost_minor: 8000,
        reason: "The vendor did not deliver",
      }),
    );

    expect(callAsCaller).toHaveBeenCalledWith("request_recovery_advance", TOKEN, {
      p_case: CASE_ID,
      p_replacement_cost_minor: 8000,
      p_reason: "The vendor did not deliver",
      p_fund_wallet: "platform-fund-wallet",
    });
  });

  it("will not ask for money with no wallet to hold it", async () => {
    delete process.env["FUND_POOL_WALLET_ID"];

    const res = await requestRecoveryAsCaller(
      request("/api/funds/recovery", {
        kind: "clawback",
        case_id: CASE_ID,
        amount_minor: 5000,
        reason: "The vendor did not deliver",
      }),
    );

    expect(res.status).toBe(503);
    expect(callAsCaller).not.toHaveBeenCalled();
  });

  it("passes the database's refusal on: there is nothing left to take back", async () => {
    callAsCaller.mockResolvedValue(refusal("22023", "nothing_to_recover"));

    const res = await requestRecoveryAsCaller(
      request("/api/funds/recovery", {
        kind: "clawback",
        case_id: CASE_ID,
        amount_minor: 5000,
        reason: "The vendor did not deliver",
      }),
    );

    expect(res.status).toBe(400);
    const body = (await res.json()) as { message: string };
    expect(body.message).toBe("There is nothing left to take back from this vendor.");
  });
});

describe("a decision about a request", () => {
  it("records an approval", async () => {
    callAsCaller.mockResolvedValue(jsonResponse("awaiting_approval"));

    const res = await decideRecoveryAsCaller(
      request("/api/funds/approvals", { action_id: ACTION_ID, decision: "approved" }),
    );

    expect(res.status).toBe(200);
    expect(callAsCaller).toHaveBeenCalledWith("approve_recovery_action", TOKEN, {
      p_action: ACTION_ID,
      p_decision: "approved",
      p_note: null,
    });
  });

  it("withdraws a request with a reason", async () => {
    callAsCaller.mockResolvedValue(jsonResponse("void"));

    const res = await decideRecoveryAsCaller(
      request("/api/funds/approvals", {
        action_id: ACTION_ID,
        decision: "void",
        reason: "The case was reopened",
      }),
    );

    expect(res.status).toBe(200);
    expect(callAsCaller).toHaveBeenCalledWith("void_recovery_action", TOKEN, {
      p_action: ACTION_ID,
      p_reason: "The case was reopened",
    });
  });

  it("keeps the requester out of their own approval", async () => {
    callAsCaller.mockResolvedValue(
      refusal("42501", "forbidden: the requester may not approve", 403),
    );

    const res = await decideRecoveryAsCaller(
      request("/api/funds/approvals", { action_id: ACTION_ID, decision: "approved" }),
    );

    expect(res.status).toBe(403);
  });
});

describe("moving the money", () => {
  const TARGET = {
    action_id: ACTION_ID,
    kind: "advance",
    status: "approved",
    amount_minor: 4000,
    currency: "NGN",
    available_minor: 1000,
    payment_reference: "owanbe-abcd1234",
    ready: false,
  };

  it("sends nothing when the fund cannot cover it", async () => {
    callAsCaller.mockResolvedValue(jsonResponse([TARGET]));

    const res = await settleRecoveryAsCaller(
      request("/api/funds/settle", { action_id: ACTION_ID }),
    );

    expect(res.status).toBe(400);
    expect(sendRefund).not.toHaveBeenCalled();
    expect(settleRecoveryAction).not.toHaveBeenCalled();
  });

  it("sends nothing when the request has not been approved", async () => {
    callAsCaller.mockResolvedValue(
      jsonResponse([{ ...TARGET, status: "requested", ready: false }]),
    );

    const res = await settleRecoveryAsCaller(
      request("/api/funds/settle", { action_id: ACTION_ID }),
    );

    expect(res.status).toBe(400);
    expect(sendRefund).not.toHaveBeenCalled();
  });

  it("sends the host their advance and records the provider's reference", async () => {
    callAsCaller.mockResolvedValue(jsonResponse([{ ...TARGET, ready: true }]));
    sendRefund.mockResolvedValue({ reference: "RB-109-1", status: "success", amountMinor: 4000 });
    settleRecoveryAction.mockResolvedValue("settled");

    const res = await settleRecoveryAsCaller(
      request("/api/funds/settle", { action_id: ACTION_ID }),
    );

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ outcome: "settled", provider_reference: "RB-109-1" });
    expect(sendRefund).toHaveBeenCalledWith({
      reference: "owanbe-abcd1234",
      amountMinor: 4000,
      reason: "Recovery advance for a replacement booking",
    });
    expect(settleRecoveryAction).toHaveBeenCalledWith(ACTION_ID, "RB-109-1");
  });

  it("takes money back from the vendor without asking the provider", async () => {
    callAsCaller.mockResolvedValue(
      jsonResponse([{ ...TARGET, kind: "clawback", amount_minor: 5000, ready: true }]),
    );
    settleRecoveryAction.mockResolvedValue("settled");

    const res = await settleRecoveryAsCaller(
      request("/api/funds/settle", { action_id: ACTION_ID }),
    );

    expect(res.status).toBe(200);
    expect(sendRefund).not.toHaveBeenCalled();
    expect(settleRecoveryAction).toHaveBeenCalledWith(ACTION_ID, null);
  });

  it("hands back the provider's reference when the ledger refuses it", async () => {
    callAsCaller.mockResolvedValue(jsonResponse([{ ...TARGET, ready: true }]));
    sendRefund.mockResolvedValue({ reference: "RB-109-2", status: "success", amountMinor: 4000 });
    settleRecoveryAction.mockRejectedValue(new Error("database_unreachable"));

    const res = await settleRecoveryAsCaller(
      request("/api/funds/settle", { action_id: ACTION_ID }),
    );

    expect(res.status).toBe(502);
    const body = (await res.json()) as { provider_reference: string };
    expect(body.provider_reference).toBe("RB-109-2");
  });

  it("keeps a caller without a finance grant out", async () => {
    callAsCaller.mockResolvedValue(refusal("42501", "forbidden: finance grant required", 403));

    const res = await settleRecoveryAsCaller(
      request("/api/funds/settle", { action_id: ACTION_ID }),
    );

    expect(res.status).toBe(403);
    expect(sendRefund).not.toHaveBeenCalled();
  });
});

describe("the reconciliation", () => {
  it("runs as the platform once the database says the caller may", async () => {
    callAsCaller.mockResolvedValue(jsonResponse(true));
    reconcileLedger.mockResolvedValue({
      events_checked: 3,
      pools_checked: 2,
      matched: 5,
      exception_count: 0,
      exceptions: [],
    });

    const res = await reconcileLedgerAsCaller(request("/api/funds/reconcile", {}));

    expect(res.status).toBe(200);
    const body = (await res.json()) as { events_checked: number; exceptions: unknown[] };
    expect(body.events_checked).toBe(3);
    expect(body.exceptions).toEqual([]);
    expect(reconcileLedger).toHaveBeenCalled();
  });

  it("does not run for a caller the database says no to", async () => {
    callAsCaller.mockResolvedValue(jsonResponse(false));

    const res = await reconcileLedgerAsCaller(request("/api/funds/reconcile", {}));

    expect(res.status).toBe(403);
    expect(reconcileLedger).not.toHaveBeenCalled();
  });

  it("keeps the exceptions it found", async () => {
    callAsCaller.mockResolvedValue(jsonResponse(true));
    reconcileLedger.mockResolvedValue({
      events_checked: 1,
      pools_checked: 1,
      matched: 0,
      exception_count: 1,
      exceptions: [{ code: "amount_mismatch", reference: "owanbe-ref" }],
    });

    const res = await reconcileLedgerAsCaller(request("/api/funds/reconcile", {}));

    const body = (await res.json()) as { exception_count: number; exceptions: { code: string }[] };
    expect(body.exception_count).toBe(1);
    expect(body.exceptions[0]?.code).toBe("amount_mismatch");
  });
});
