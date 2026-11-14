import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { paystackSignature } from "@/lib/payments/paystack.server";
import { recordProviderEvent, savePaymentAuthorization } from "@/lib/payments/router.server";
import { Route } from "./webhook";

// Only the database-facing module is mocked. The signature helper is the real one, so a signature
// made here is made by the same code the route trusts.
vi.mock("@/lib/payments/router.server", () => ({
  recordProviderEvent: vi.fn(async () => "recorded"),
  savePaymentAuthorization: vi.fn(async () => "saved"),
}));

const recordProviderEventMock = vi.mocked(recordProviderEvent);
const savePaymentAuthorizationMock = vi.mocked(savePaymentAuthorization);

const SECRET = "sk_test_webhook";
const BOOKING_ID = "6f1e9c4a-2b3d-4e5f-8a7b-1c2d3e4f5a6b";
const REFERENCE = "owanbe-abcd1234";

type WebhookHandler = (ctx: { request: Request }) => Promise<Response>;

/** The route's own POST handler, taken from the route object the framework built. */
function postHandler(): WebhookHandler {
  const route = Route as unknown as {
    options: { server?: { handlers?: { POST?: WebhookHandler } } };
  };
  const handler = route.options.server?.handlers?.POST;
  if (!handler) throw new Error("the paystack webhook route has no POST handler");
  return handler;
}

function chargeSuccessBody(): string {
  return JSON.stringify({
    event: "charge.success",
    data: {
      reference: REFERENCE,
      amount: 100000,
      currency: "NGN",
      status: "success",
      channel: "card",
      paid_at: "2026-11-09T12:00:00.000Z",
      metadata: { booking_id: BOOKING_ID },
      authorization: {
        authorization_code: "AUTH_abc123",
        brand: "visa",
        last4: "4081",
        exp_month: "12",
        exp_year: "2030",
        reusable: true,
      },
    },
  });
}

function signedRequest(body: string, signature: string | null): Request {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (signature !== null) headers["x-paystack-signature"] = signature;
  return new Request("https://app.test/api/public/paystack/webhook", {
    method: "POST",
    headers,
    body,
  });
}

beforeEach(() => {
  vi.stubEnv("PAYSTACK_SECRET_KEY", SECRET);
  recordProviderEventMock.mockClear();
  savePaymentAuthorizationMock.mockClear();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("the paystack webhook route", () => {
  it("records a charge.success that carries a genuine signature", async () => {
    const body = chargeSuccessBody();
    const signature = await paystackSignature(body, SECRET);

    const response = await postHandler()({ request: signedRequest(body, signature) });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ status: "recorded", outcome: "recorded" });
    expect(recordProviderEventMock).toHaveBeenCalledTimes(1);
    expect(recordProviderEventMock).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: "charge.success",
        reference: REFERENCE,
        amountMinor: 100000,
        currency: "NGN",
        bookingId: BOOKING_ID,
      }),
    );
    expect(savePaymentAuthorizationMock).toHaveBeenCalledTimes(1);
    expect(savePaymentAuthorizationMock).toHaveBeenCalledWith(
      expect.objectContaining({
        bookingId: BOOKING_ID,
        authorizationCode: "AUTH_abc123",
        last4: "4081",
      }),
    );
  });

  it("refuses a signature that was made over a different body", async () => {
    const body = chargeSuccessBody();
    const other = JSON.stringify({ event: "charge.success", data: { amount: 1 } });
    const signature = await paystackSignature(other, SECRET);

    const response = await postHandler()({ request: signedRequest(body, signature) });

    expect(response.status).toBe(401);
    await expect(response.text()).resolves.toBe("invalid signature");
    expect(recordProviderEventMock).not.toHaveBeenCalled();
    expect(savePaymentAuthorizationMock).not.toHaveBeenCalled();
  });

  it("refuses a request that carries no signature at all", async () => {
    const body = chargeSuccessBody();

    const response = await postHandler()({ request: signedRequest(body, null) });

    expect(response.status).toBe(401);
    await expect(response.text()).resolves.toBe("invalid signature");
    expect(recordProviderEventMock).not.toHaveBeenCalled();
  });

  it("refuses a signature that was made with another secret key", async () => {
    const body = chargeSuccessBody();
    const signature = await paystackSignature(body, "sk_test_someone_else");

    const response = await postHandler()({ request: signedRequest(body, signature) });

    expect(response.status).toBe(401);
    await expect(response.text()).resolves.toBe("invalid signature");
    expect(recordProviderEventMock).not.toHaveBeenCalled();
  });

  it("accepts a signed event that is not about money, and records nothing", async () => {
    const body = JSON.stringify({
      event: "customer.updated",
      data: { customer_code: "CUS_abc", reference: REFERENCE },
    });
    const signature = await paystackSignature(body, SECRET);

    const response = await postHandler()({ request: signedRequest(body, signature) });

    expect(response.status).toBe(200);
    await expect(response.text()).resolves.toBe("ok");
    expect(recordProviderEventMock).not.toHaveBeenCalled();
    expect(savePaymentAuthorizationMock).not.toHaveBeenCalled();
  });
});
