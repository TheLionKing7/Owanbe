import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  PaystackError,
  initializeTransaction,
  paystackSecretKey,
  refundTransaction,
  verifyPaystackSignature,
  verifyTransaction,
} from "./paystack.server";

const REFERENCE = "owanbe-abcd1234";
const BOOKING_ID = "6f1e9c4a-2b3d-4e5f-8a7b-1c2d3e4f5a6b";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

beforeEach(() => {
  vi.stubEnv("PAYSTACK_SECRET_KEY", "sk_test_example");
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("the webhook signature", () => {
  it("accepts a signature the provider made", async () => {
    const body = JSON.stringify({ event: "charge.success" });
    const signature = await import("./paystack.server").then((m) =>
      m.paystackSignature(body, "sk_test_example"),
    );

    expect(await verifyPaystackSignature(body, signature, "sk_test_example")).toBe(true);
  });

  it("refuses a body that was changed after it was signed", async () => {
    const signature = await import("./paystack.server").then((m) =>
      m.paystackSignature(JSON.stringify({ event: "charge.success" }), "sk_test_example"),
    );

    expect(
      await verifyPaystackSignature(
        JSON.stringify({ event: "charge.failed" }),
        signature,
        "sk_test_example",
      ),
    ).toBe(false);
  });

  it("refuses a signature that is not there, or a key that is not", async () => {
    expect(await verifyPaystackSignature("{}", null, "sk_test_example")).toBe(false);
    expect(await verifyPaystackSignature("{}", "abc", undefined)).toBe(false);
  });
});

describe("the secret key", () => {
  it("is read at the point of use and is never a module constant", () => {
    expect(paystackSecretKey({ PAYSTACK_SECRET_KEY: " sk_test_example " })).toBe("sk_test_example");
    expect(paystackSecretKey({})).toBeUndefined();
    expect(paystackSecretKey({ PAYSTACK_SECRET_KEY: "   " })).toBeUndefined();
  });
});

describe("starting a charge", () => {
  it("sends the amount in minor units and carries the booking id", async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse({
        status: true,
        data: {
          reference: REFERENCE,
          authorization_url: "https://checkout.paystack.com/abc",
          amount: 100000,
          currency: "NGN",
        },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const started = await initializeTransaction({
      email: "ada@example.test",
      amountMinor: 100000,
      currency: "ngn",
      reference: REFERENCE,
      bookingId: BOOKING_ID,
    });

    expect(started.authorizationUrl).toBe("https://checkout.paystack.com/abc");
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.paystack.co/transaction/initialize");
    expect(JSON.parse(String(init.body))).toEqual({
      email: "ada@example.test",
      amount: 100000,
      currency: "NGN",
      reference: REFERENCE,
      metadata: { booking_id: BOOKING_ID },
    });
  });

  it("refuses to call the provider when there is no secret key", async () => {
    vi.stubEnv("PAYSTACK_SECRET_KEY", "");
    const fetchMock = vi.fn(async () => jsonResponse({}));
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      initializeTransaction({
        email: "ada@example.test",
        amountMinor: 100000,
        currency: "NGN",
        reference: REFERENCE,
        bookingId: BOOKING_ID,
      }),
    ).rejects.toMatchObject({ code: "unconfigured" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("refuses a response that carries no payment page", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse({ status: true, data: { reference: REFERENCE } })),
    );

    await expect(
      initializeTransaction({
        email: "ada@example.test",
        amountMinor: 100000,
        currency: "NGN",
        reference: REFERENCE,
        bookingId: BOOKING_ID,
      }),
    ).rejects.toMatchObject({ code: "refused" });
  });

  it("does not pass the provider's own message on", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        jsonResponse({ status: false, message: "Invalid key ada@example.test" }, 401),
      ),
    );

    await expect(
      initializeTransaction({
        email: "ada@example.test",
        amountMinor: 100000,
        currency: "NGN",
        reference: REFERENCE,
        bookingId: BOOKING_ID,
      }),
    ).rejects.toMatchObject({ code: "refused", message: "paystack_refused" });
  });

  it("says the provider could not be reached", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("network down");
      }),
    );

    await expect(
      initializeTransaction({
        email: "ada@example.test",
        amountMinor: 100000,
        currency: "NGN",
        reference: REFERENCE,
        bookingId: BOOKING_ID,
      }),
    ).rejects.toMatchObject({ code: "unavailable" });
  });
});

describe("checking what happened to a charge", () => {
  it("reads the booking id out of the provider's own metadata", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        jsonResponse({
          status: true,
          data: {
            reference: REFERENCE,
            status: "success",
            amount: 100000,
            currency: "NGN",
            paid_at: "2026-11-09T12:00:00.000Z",
            metadata: { booking_id: BOOKING_ID },
          },
        }),
      ),
    );

    const verified = await verifyTransaction(REFERENCE);

    expect(verified.status).toBe("success");
    expect(verified.amountMinor).toBe(100000);
    expect(verified.bookingId).toBe(BOOKING_ID);
  });

  it("has no booking id when the provider sent none", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        jsonResponse({ status: true, data: { reference: REFERENCE, status: "success" } }),
      ),
    );

    expect((await verifyTransaction(REFERENCE)).bookingId).toBeNull();
  });
});

describe("sending the money back", () => {
  it("asks the provider for the amount", async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse({
        status: true,
        data: { reference: "refund-1", status: "pending", amount: 30000 },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const refunded = await refundTransaction({
      reference: REFERENCE,
      amountMinor: 30000,
      reason: "Host requested a refund for a booking",
    });

    expect(refunded.amountMinor).toBe(30000);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(`https://api.paystack.co/transaction/refund/${REFERENCE}`);
    expect(JSON.parse(String(init.body))).toEqual({
      amount: 30000,
      reason: "Host requested a refund for a booking",
    });
  });

  it("raises a refusal the caller can read", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse({ status: false, message: "Transaction not found" }, 404)),
    );

    await expect(
      refundTransaction({ reference: REFERENCE, amountMinor: 30000, reason: "because" }),
    ).rejects.toBeInstanceOf(PaystackError);
  });
});
