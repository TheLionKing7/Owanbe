import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  PaymentRouterError,
  allocateSplitPayment,
  bookingForReference,
  sendRefund,
  startCharge,
  verifyCharge,
} from "@/lib/payments/router.server";
import {
  bookingMoneyAsCaller,
  completeBookingAsCaller,
  freezeBookingFundAsCaller,
  paymentReference,
  refundBookingAsCaller,
  startBookingPaymentAsCaller,
  verifyPaymentReferenceAsCaller,
} from "./server";

vi.mock("@/lib/payments/router.server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/payments/router.server")>();
  return {
    ...actual,
    allocateSplitPayment: vi.fn(),
    bookingForReference: vi.fn(),
    sendRefund: vi.fn(),
    startCharge: vi.fn(),
    verifyCharge: vi.fn(),
  };
});

const BOOKING_ID = "6f1e9c4a-2b3d-4e5f-8a7b-1c2d3e4f5a6b";
const TOKEN = "header.payload.signature";
const REFERENCE = "owanbe-abcd1234-efgh5678";

function request(url: string, body?: unknown, token: string | null = TOKEN): Request {
  const init: RequestInit = { method: body === undefined ? "GET" : "POST" };
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (token) headers["Authorization"] = `Bearer ${token}`;
  if (body !== undefined) init.body = JSON.stringify(body);
  return new Request(`https://owanbe.app${url}`, { ...init, headers });
}

function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

const FUND_ROW = {
  booking_id: BOOKING_ID,
  quote_id: "8a2c1d3e-4f5a-6b7c-8d9e-0f1a2b3c4d5e",
  service_date: "2026-12-12",
  total_minor: 100000,
  currency: "NGN",
  booking_status: "paid",
  pool_status: "partially_released",
  paid_minor: 100000,
  held_minor: 30000,
  released_70_minor: 70000,
  released_30_minor: 0,
  commission_minor: 1750,
  tax_minor: 0,
  vendor_net_minor: 68250,
  refunded_minor: 0,
  release_30_due_at: "2026-11-10T12:00:00.000Z",
  paid_at: "2026-11-09T12:00:00.000Z",
  completed_at: null,
  refunded_at: null,
  frozen: false,
  frozen_reason: null,
  payment_reference: REFERENCE,
  is_host_side: true,
  counterparty_house: "1b2c3d4e-5f6a-7b8c-9d0e-1f2a3b4c5d6e",
  counterparty_name: "Dave Cakes Ltd",
};

const MOVEMENT_ROW = {
  movement: "booking_hold",
  direction: "in",
  amount_minor: 100000,
  currency: "NGN",
  reference: REFERENCE,
  memo: "Payment received",
  created_at: "2026-11-09T12:00:00.000Z",
};

beforeEach(() => {
  vi.stubEnv("EXTERNAL_SUPABASE_URL", "https://project.supabase.co");
  vi.stubEnv("EXTERNAL_SUPABASE_PUBLISHABLE_KEY", "sb_publishable_example");
  vi.mocked(allocateSplitPayment).mockReset();
  vi.mocked(bookingForReference).mockReset();
  vi.mocked(sendRefund).mockReset();
  vi.mocked(startCharge).mockReset();
  vi.mocked(verifyCharge).mockReset();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("reading the money of a booking", () => {
  it("forwards the caller's own token to the database", async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url.endsWith("booking_fund")) return jsonResponse([FUND_ROW], 200);
      return jsonResponse([MOVEMENT_ROW], 200);
    });
    vi.stubGlobal("fetch", fetchMock);

    const res = await bookingMoneyAsCaller(
      request(`/api/bookings/${BOOKING_ID}/payments`),
      BOOKING_ID,
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.fund.held_minor).toBe(30000);
    expect(body.movements).toHaveLength(1);
    for (const [url, init] of fetchMock.mock.calls as unknown as [string, RequestInit][]) {
      expect((init.headers as Record<string, string>)["Authorization"]).toBe(`Bearer ${TOKEN}`);
      expect(url).toContain("https://project.supabase.co/rest/v1/rpc/");
    }
  });

  it("refuses a caller with no signed-in token without asking the database", async () => {
    const fetchMock = vi.fn(async () => jsonResponse({}, 200));
    vi.stubGlobal("fetch", fetchMock);

    const res = await bookingMoneyAsCaller(
      request(`/api/bookings/${BOOKING_ID}/payments`, undefined, null),
      BOOKING_ID,
    );

    expect(res.status).toBe(401);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("refuses a booking link that is not a booking", async () => {
    const fetchMock = vi.fn(async () => jsonResponse({}, 200));
    vi.stubGlobal("fetch", fetchMock);

    const res = await bookingMoneyAsCaller(
      request("/api/bookings/not-a-uuid/payments"),
      "not-a-uuid",
    );

    expect(res.status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("turns a refusal of the caller's access into a sentence", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse({ code: "42501", message: "forbidden" }, 403)),
    );

    const res = await bookingMoneyAsCaller(
      request(`/api/bookings/${BOOKING_ID}/payments`),
      BOOKING_ID,
    );

    expect(res.status).toBe(403);
    expect((await res.json()).message).toBe("This booking belongs to another house.");
  });

  it("turns a named refusal into the sentence the database asked for", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse({ code: "22023", message: "fund_pool_frozen" }, 400)),
    );

    const res = await bookingMoneyAsCaller(
      request(`/api/bookings/${BOOKING_ID}/payments`),
      BOOKING_ID,
    );

    expect(res.status).toBe(400);
    expect((await res.json()).message).toBe("This money is on hold while a dispute is open.");
  });

  it("does not leak the database's own words for a refusal it does not know", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse({ code: "XX000", message: "internal_pg_error" }, 500)),
    );

    const res = await bookingMoneyAsCaller(
      request(`/api/bookings/${BOOKING_ID}/payments`),
      BOOKING_ID,
    );

    expect(res.status).toBe(502);
    expect((await res.json()).message).toBe("Something went wrong. Try again in a moment.");
  });
});

describe("starting a payment", () => {
  it("asks the provider for a charge the host can pay", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        jsonResponse(
          [{ total_minor: 100000, currency: "NGN", host_email: "ada@example.test" }],
          200,
        ),
      ),
    );
    vi.mocked(startCharge).mockResolvedValue({
      reference: REFERENCE,
      authorizationUrl: "https://checkout.paystack.com/abc",
      amountMinor: 100000,
      currency: "NGN",
    });

    const res = await startBookingPaymentAsCaller(
      request(`/api/bookings/${BOOKING_ID}/payments`, {}),
      BOOKING_ID,
    );

    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.authorization_url).toBe("https://checkout.paystack.com/abc");
    expect(body.amount_minor).toBe(100000);
    expect(body.currency).toBe("NGN");

    const charge = vi.mocked(startCharge).mock.calls[0]?.[0];
    expect(charge?.email).toBe("ada@example.test");
    expect(charge?.amountMinor).toBe(100000);
    expect(charge?.bookingId).toBe(BOOKING_ID);
    expect(charge?.reference).toMatch(/^owanbe-/);
  });

  it("refuses to start a payment for a house with no email address", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        jsonResponse([{ total_minor: 100000, currency: "NGN", host_email: "" }], 200),
      ),
    );

    const res = await startBookingPaymentAsCaller(
      request(`/api/bookings/${BOOKING_ID}/payments`, {}),
      BOOKING_ID,
    );

    expect(res.status).toBe(400);
    expect(startCharge).not.toHaveBeenCalled();
  });

  it("says the payments are not set up when the router has no key", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        jsonResponse(
          [{ total_minor: 100000, currency: "NGN", host_email: "ada@example.test" }],
          200,
        ),
      ),
    );
    vi.mocked(startCharge).mockRejectedValue(
      new PaymentRouterError("unconfigured", "payment_router_not_configured"),
    );

    const res = await startBookingPaymentAsCaller(
      request(`/api/bookings/${BOOKING_ID}/payments`, {}),
      BOOKING_ID,
    );

    expect(res.status).toBe(503);
    expect((await res.json()).error).toBe("unconfigured");
  });
});

describe("coming back from the provider", () => {
  it("asks the provider what happened and records the money", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse([FUND_ROW], 200)),
    );
    vi.mocked(verifyCharge).mockResolvedValue({
      reference: REFERENCE,
      status: "success",
      amountMinor: 100000,
      currency: "NGN",
      paidAt: "2026-11-09T12:00:00.000Z",
      bookingId: BOOKING_ID,
    });
    vi.mocked(allocateSplitPayment).mockResolvedValue("allocated");

    const res = await verifyPaymentReferenceAsCaller(
      request(`/api/payments/verify?reference=${REFERENCE}`),
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.outcome).toBe("allocated");
    expect(body.booking_id).toBe(BOOKING_ID);
    expect(allocateSplitPayment).toHaveBeenCalledWith(BOOKING_ID, REFERENCE, 100000, "NGN");
  });

  it("does not claim a payment that the provider has not confirmed", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse([FUND_ROW], 200)),
    );
    vi.mocked(verifyCharge).mockResolvedValue({
      reference: REFERENCE,
      status: "pending",
      amountMinor: 0,
      currency: "NGN",
      paidAt: null,
      bookingId: null,
    });

    const res = await verifyPaymentReferenceAsCaller(
      request(`/api/payments/verify?reference=${REFERENCE}`),
    );

    expect(res.status).toBe(200);
    expect((await res.json()).outcome).toBe("pending");
    expect(allocateSplitPayment).not.toHaveBeenCalled();
  });

  it("does not name a booking the caller may not see", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse({ code: "42501", message: "forbidden" }, 403)),
    );
    vi.mocked(verifyCharge).mockResolvedValue({
      reference: REFERENCE,
      status: "success",
      amountMinor: 100000,
      currency: "NGN",
      paidAt: "2026-11-09T12:00:00.000Z",
      bookingId: BOOKING_ID,
    });
    vi.mocked(allocateSplitPayment).mockResolvedValue("allocated");

    const res = await verifyPaymentReferenceAsCaller(
      request(`/api/payments/verify?reference=${REFERENCE}`),
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.outcome).toBe("allocated");
    expect(body.booking_id).toBeUndefined();
  });

  it("refuses a reference that is not one", async () => {
    const fetchMock = vi.fn(async () => jsonResponse({}, 200));
    vi.stubGlobal("fetch", fetchMock);

    const res = await verifyPaymentReferenceAsCaller(request("/api/payments/verify?reference="));

    expect(res.status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("the host confirms the celebration happened", () => {
  it("completes the booking as the caller", async () => {
    const fetchMock = vi.fn(async () => jsonResponse("released", 200));
    vi.stubGlobal("fetch", fetchMock);

    const res = await completeBookingAsCaller(
      request(`/api/bookings/${BOOKING_ID}/complete`, {}),
      BOOKING_ID,
    );

    expect(res.status).toBe(200);
    expect((await res.json()).outcome).toBe("released");
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toContain("/rest/v1/rpc/complete_booking");
    expect((init.headers as Record<string, string>)["Authorization"]).toBe(`Bearer ${TOKEN}`);
  });

  it("says the booking has not been paid yet", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse({ code: "22023", message: "booking_not_paid" }, 400)),
    );

    const res = await completeBookingAsCaller(
      request(`/api/bookings/${BOOKING_ID}/complete`, {}),
      BOOKING_ID,
    );

    expect(res.status).toBe(400);
    expect((await res.json()).message).toBe("This booking has not been paid yet.");
  });
});

describe("the host asks for the money back", () => {
  it("records the obligation and then asks the provider", async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url.endsWith("booking_fund")) return jsonResponse([FUND_ROW], 200);
      return jsonResponse("refund_pending", 200);
    });
    vi.stubGlobal("fetch", fetchMock);
    vi.mocked(sendRefund).mockResolvedValue({
      reference: "refund-1",
      status: "pending",
      amountMinor: 30000,
    });

    const res = await refundBookingAsCaller(
      request(`/api/bookings/${BOOKING_ID}/refund`, { reason: "The date changed" }),
      BOOKING_ID,
    );

    expect(res.status).toBe(200);
    expect((await res.json()).outcome).toBe("refund_pending");
    expect(sendRefund).toHaveBeenCalledWith({
      reference: REFERENCE,
      amountMinor: 30000,
      reason: expect.any(String),
    });
  });

  it("keeps the obligation when the provider will not move the money yet", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (url.endsWith("booking_fund")) return jsonResponse([FUND_ROW], 200);
        return jsonResponse("refund_pending", 200);
      }),
    );
    vi.mocked(sendRefund).mockRejectedValue(new PaymentRouterError("refused", "paystack_refused"));

    const res = await refundBookingAsCaller(
      request(`/api/bookings/${BOOKING_ID}/refund`, { reason: "The date changed" }),
      BOOKING_ID,
    );

    expect(res.status).toBe(202);
    const body = await res.json();
    expect(body.pending).toBe(true);
    expect(body.outcome).toBe("refund_pending");
  });

  it("refuses a refund with no reason before it reaches the database", async () => {
    const fetchMock = vi.fn(async () => jsonResponse({}, 200));
    vi.stubGlobal("fetch", fetchMock);

    const res = await refundBookingAsCaller(
      request(`/api/bookings/${BOOKING_ID}/refund`, { reason: "" }),
      BOOKING_ID,
    );

    expect(res.status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("says the money is on hold when a dispute is open", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (url.endsWith("booking_fund")) return jsonResponse([FUND_ROW], 200);
        return jsonResponse({ code: "22023", message: "fund_pool_frozen" }, 400);
      }),
    );

    const res = await refundBookingAsCaller(
      request(`/api/bookings/${BOOKING_ID}/refund`, { reason: "The date changed" }),
      BOOKING_ID,
    );

    expect(res.status).toBe(400);
    expect((await res.json()).message).toBe("This money is on hold while a dispute is open.");
    expect(sendRefund).not.toHaveBeenCalled();
  });
});

describe("the dispute freeze", () => {
  it("freezes the pool through the database", async () => {
    const fetchMock = vi.fn(async () => jsonResponse(null, 200));
    vi.stubGlobal("fetch", fetchMock);

    const res = await freezeBookingFundAsCaller(
      request(`/api/bookings/${BOOKING_ID}/freeze`, { reason: "A dispute is open" }),
      BOOKING_ID,
    );

    expect(res.status).toBe(200);
    expect((await res.json()).outcome).toBe("frozen");
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toContain("/rest/v1/rpc/freeze_fund_pool");
    expect(JSON.parse(String(init.body))).toEqual({
      p_booking: BOOKING_ID,
      p_reason: "A dispute is open",
    });
  });

  it("refuses a caller who is not an arbitrator", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        jsonResponse({ code: "42501", message: "forbidden: arbitrator grant required" }, 403),
      ),
    );

    const res = await freezeBookingFundAsCaller(
      request(`/api/bookings/${BOOKING_ID}/freeze`, { reason: "A dispute is open" }),
      BOOKING_ID,
    );

    expect(res.status).toBe(403);
    expect((await res.json()).message).toBe("This booking belongs to another house.");
  });

  it("refuses a freeze with no reason", async () => {
    const fetchMock = vi.fn(async () => jsonResponse({}, 200));
    vi.stubGlobal("fetch", fetchMock);

    const res = await freezeBookingFundAsCaller(
      request(`/api/bookings/${BOOKING_ID}/freeze`, { reason: "" }),
      BOOKING_ID,
    );

    expect(res.status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("paymentReference", () => {
  it("gives the provider a reference it can keep", () => {
    const reference = paymentReference();
    expect(reference).toMatch(/^owanbe-[a-z][0-9a-f]{6}(-[a-z][0-9a-f]{6}){3}$/);
  });

  it("never puts a long run of digits in the reference", () => {
    for (let index = 0; index < 50; index++) {
      expect(paymentReference()).not.toMatch(/\d{12}/);
    }
  });

  it("gives a different reference every time", () => {
    const references = new Set(Array.from({ length: 50 }, () => paymentReference()));
    expect(references.size).toBe(50);
  });
});
