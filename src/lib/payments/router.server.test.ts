import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  PaymentRouterError,
  allocateSplitPayment,
  bookingForReference,
  paymentRouterKey,
  recordProviderEvent,
  releaseDueTranches,
  settleRefund,
  startCharge,
} from "./router.server";

const BOOKING_ID = "6f1e9c4a-2b3d-4e5f-8a7b-1c2d3e4f5a6b";
const REFERENCE = "owanbe-abcd1234";

function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

beforeEach(() => {
  vi.stubEnv("PAYMENT_ROUTER_KEY", "router-key");
  vi.stubEnv("SUPABASE_URL", "https://project.supabase.co");
  vi.stubEnv("EXTERNAL_SUPABASE_SERVICE_ROLE_KEY", "service-role-key");
  vi.stubEnv("PAYSTACK_SECRET_KEY", "sk_test_example");
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("the platform's own gate", () => {
  it("reads the key from the environment", () => {
    expect(paymentRouterKey({ PAYMENT_ROUTER_KEY: "  key  " })).toBe("key");
    expect(paymentRouterKey({})).toBeUndefined();
    expect(paymentRouterKey({ PAYMENT_ROUTER_KEY: "   " })).toBeUndefined();
  });

  it("refuses to move money when the gate is not set", async () => {
    vi.stubEnv("PAYMENT_ROUTER_KEY", "");

    await expect(allocateSplitPayment(BOOKING_ID, REFERENCE, 100000, "NGN")).rejects.toBeInstanceOf(
      PaymentRouterError,
    );
  });

  it("refuses to start a charge when the gate is not set", async () => {
    vi.stubEnv("PAYMENT_ROUTER_KEY", "");

    await expect(
      startCharge({
        email: "ada@example.test",
        amountMinor: 100000,
        currency: "NGN",
        reference: REFERENCE,
        bookingId: BOOKING_ID,
      }),
    ).rejects.toMatchObject({ code: "unconfigured" });
  });
});

describe("recording a paid booking", () => {
  it("calls the database as the platform, with the provider's evidence", async () => {
    const fetchMock = vi.fn(async () => jsonResponse("allocated", 200));
    vi.stubGlobal("fetch", fetchMock);

    const outcome = await allocateSplitPayment(BOOKING_ID, REFERENCE, 100000, "NGN");

    expect(outcome).toBe("allocated");
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://project.supabase.co/rest/v1/rpc/allocate_split_payment");
    expect(JSON.parse(String(init.body))).toEqual({
      p_booking: BOOKING_ID,
      p_reference: REFERENCE,
      p_amount_minor: 100000,
      p_currency: "NGN",
    });
  });

  it("reads the database's refusal as a code and keeps the raw text out of the way", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse({ code: "22023", message: "payment_already_recorded" }, 400)),
    );

    await expect(allocateSplitPayment(BOOKING_ID, REFERENCE, 100000, "NGN")).rejects.toMatchObject({
      code: "validation",
      message: "payment_already_recorded",
      sqlstate: "22023",
    });
  });

  it("reads a refusal of access as a refusal, not as a crash", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse({ code: "42501", message: "forbidden" }, 403)),
    );

    await expect(allocateSplitPayment(BOOKING_ID, REFERENCE, 100000, "NGN")).rejects.toMatchObject({
      code: "refused",
    });
  });

  it("reads a missing booking as not found", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse({ code: "P0002", message: "booking_not_found" }, 404)),
    );

    await expect(allocateSplitPayment(BOOKING_ID, REFERENCE, 100000, "NGN")).rejects.toMatchObject({
      code: "not_found",
    });
  });

  it("does not leak the provider's own refusal into the error", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse({ code: "XX000", message: "internal_error" }, 500)),
    );

    await expect(allocateSplitPayment(BOOKING_ID, REFERENCE, 100000, "NGN")).rejects.toMatchObject({
      code: "unknown",
    });
  });
});

describe("the provider's own events", () => {
  it("records an event once", async () => {
    const fetchMock = vi.fn(async () => jsonResponse("allocated", 200));
    vi.stubGlobal("fetch", fetchMock);

    const outcome = await recordProviderEvent({
      eventType: "charge.success",
      reference: REFERENCE,
      amountMinor: 100000,
      currency: "NGN",
      payload: { provider: "paystack", status: "success" },
      bookingId: BOOKING_ID,
    });

    expect(outcome).toBe("allocated");
    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(JSON.parse(String(init.body))).toMatchObject({
      p_event_type: "charge.success",
      p_reference: REFERENCE,
      p_booking: BOOKING_ID,
    });
  });

  it("settles a refund the provider has sent", async () => {
    const fetchMock = vi.fn(async () => jsonResponse("settled", 200));
    vi.stubGlobal("fetch", fetchMock);

    expect(await settleRefund(BOOKING_ID, REFERENCE)).toBe("settled");
  });

  it("counts the pools it released", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse(3, 200)),
    );
    expect(await releaseDueTranches()).toBe(3);
  });

  it("has no booking for a reference that was never paid", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse(null, 200)),
    );
    expect(await bookingForReference(REFERENCE)).toBeNull();
  });
});
