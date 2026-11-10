import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PaymentsError, createPaymentsApi, paymentsErrorMessage, startBookingPayment } from "./api";

const BOOKING_ID = "6f1e9c4a-2b3d-4e5f-8a7b-1c2d3e4f5a6b";
const TOKEN = "header.payload.signature";

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

describe("paymentsErrorMessage", () => {
  it("gives every kind of refusal a sentence", () => {
    expect(paymentsErrorMessage(new PaymentsError("forbidden", "x"))).toBe(
      "This booking belongs to another house.",
    );
    expect(paymentsErrorMessage(new PaymentsError("paused", "x"))).toBe(
      "Payments are paused at the moment. Nothing you have done is wrong.",
    );
  });

  it("passes the server's own sentence through for a validation problem", () => {
    expect(
      paymentsErrorMessage(
        new PaymentsError("validation", "The amount paid is less than the agreed total."),
      ),
    ).toBe("The amount paid is less than the agreed total.");
  });

  it("does not show the raw text of an unknown error", () => {
    expect(paymentsErrorMessage(new Error("secret internal detail"))).toBe(
      "Something went wrong. Try again in a moment.",
    );
  });
});

describe("reading the house's bookings", () => {
  it("reads them through the database's own projection, as the signed-in person", async () => {
    rpc.mockResolvedValue({ data: [{ booking_id: BOOKING_ID }], error: null });
    const api = createPaymentsApi(async () => TOKEN);

    const bookings = await api.bookings("house-1");

    expect(bookings).toHaveLength(1);
    expect(rpc).toHaveBeenCalledWith("my_bookings", { p_house: "house-1" });
  });

  it("turns the database's refusal into a refusal the panel can explain", async () => {
    rpc.mockResolvedValue({ data: null, error: { message: "forbidden: not a member" } });
    const api = createPaymentsApi(async () => TOKEN);

    await expect(api.bookings("house-1")).rejects.toMatchObject({ code: "forbidden" });
  });
});

describe("starting a payment", () => {
  it("asks the app's own route with the caller's token", async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse(
        {
          reference: "owanbe-abcd1234",
          authorization_url: "https://checkout.paystack.com/abc",
          amount_minor: 100000,
          currency: "NGN",
        },
        201,
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const started = await startBookingPayment(BOOKING_ID, TOKEN);

    expect(started.authorization_url).toBe("https://checkout.paystack.com/abc");
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(`/api/bookings/${BOOKING_ID}/payments`);
    expect((init.headers as Record<string, string>)["Authorization"]).toBe(`Bearer ${TOKEN}`);
    expect(init.method).toBe("POST");
  });

  it("refuses to call the route with no signed-in caller", async () => {
    const fetchMock = vi.fn(async () => jsonResponse({}));
    vi.stubGlobal("fetch", fetchMock);

    await expect(startBookingPayment(BOOKING_ID, null)).rejects.toMatchObject({
      code: "unauthorized",
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("refuses a response that is not a payment", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse({ reference: "owanbe-abcd1234" })),
    );

    await expect(startBookingPayment(BOOKING_ID, TOKEN)).rejects.toMatchObject({
      code: "unknown",
    });
  });

  it("reads the app's refusal as a code", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        jsonResponse(
          { error: "forbidden", message: "This booking belongs to another house." },
          403,
        ),
      ),
    );

    await expect(startBookingPayment(BOOKING_ID, TOKEN)).rejects.toMatchObject({
      code: "forbidden",
    });
  });
});

describe("the money of one booking", () => {
  it("reads the fund and the trail of what moved", async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse({
        fund: { booking_id: BOOKING_ID, held_minor: 30000 },
        movements: [{ movement: "booking_hold", amount_minor: 100000 }],
      }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const api = createPaymentsApi(async () => TOKEN);

    const money = await api.money(BOOKING_ID);

    expect(money.fund.held_minor).toBe(30000);
    expect(money.movements).toHaveLength(1);
  });

  it("refuses a response that carries no fund", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse({ movements: [] })),
    );

    const api = createPaymentsApi(async () => TOKEN);
    await expect(api.money(BOOKING_ID)).rejects.toMatchObject({ code: "unknown" });
  });
});

describe("the actions on the money", () => {
  it("confirms the celebration through the app's own route", async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ outcome: "released" }));
    vi.stubGlobal("fetch", fetchMock);
    const api = createPaymentsApi(async () => TOKEN);

    await api.complete(BOOKING_ID);

    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(`/api/bookings/${BOOKING_ID}/complete`);
    expect(init.method).toBe("POST");
  });

  it("asks for a refund with the reason the host wrote", async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ outcome: "refund_pending" }));
    vi.stubGlobal("fetch", fetchMock);
    const api = createPaymentsApi(async () => TOKEN);

    await api.refund(BOOKING_ID, "The date changed");

    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(JSON.parse(String(init.body))).toEqual({ reason: "The date changed" });
  });

  it("asks the server what happened when the host comes back from paying", async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ outcome: "allocated" }));
    vi.stubGlobal("fetch", fetchMock);
    const api = createPaymentsApi(async () => TOKEN);

    const outcome = await api.verifyPayment("owanbe-abcd1234");

    expect(outcome.outcome).toBe("allocated");
    const [url] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("/api/payments/verify?reference=owanbe-abcd1234");
  });

  it("refuses a verify response that says nothing", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse({})),
    );

    const api = createPaymentsApi(async () => TOKEN);
    await expect(api.verifyPayment("owanbe-abcd1234")).rejects.toMatchObject({ code: "unknown" });
  });
});
