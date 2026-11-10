/**
 * F-102 browser boundary. The browser reads the list of bookings through the database's
 * authorized projection, and every action on the money goes through the app's own routes, which
 * forward the caller's token so the database decides what the caller may do. The browser never
 * writes a table and never holds a provider key.
 */
import {
  PAYMENT_REFUSAL_COPY,
  classifyPaymentsError,
  type BookingFund,
  type BookingSummary,
  type FundMovement,
  type PaymentStart,
  type PaymentsErrorCode,
} from "./contracts";

export const PAYMENTS_ERROR_COPY: Record<PaymentsErrorCode, string> = {
  forbidden: "This booking belongs to another house.",
  not_found: "We could not find that booking.",
  validation: "Check the details and try again.",
  unauthorized: "Sign in to manage payments.",
  unconfigured: "Payments are not set up in this environment yet.",
  paused: "Payments are paused at the moment. Nothing you have done is wrong.",
  unknown: "Something went wrong. Try again in a moment.",
};

/** Raised for every refusal so the panel can explain it in plain language. */
export class PaymentsError extends Error {
  constructor(
    readonly code: PaymentsErrorCode,
    message: string,
    readonly retryable = false,
  ) {
    super(message);
    this.name = "PaymentsError";
  }
}

/** Validation carries the sentence the server chose; every other refusal uses the copy map. */
export function paymentsErrorMessage(error: unknown): string {
  if (error instanceof PaymentsError) {
    return error.code === "validation" ? error.message : PAYMENTS_ERROR_COPY[error.code];
  }
  return PAYMENTS_ERROR_COPY.unknown;
}

/** The money of one booking, and the trail of what moved. */
export interface BookingMoney {
  fund: BookingFund;
  movements: FundMovement[];
}

interface RpcResult {
  data: unknown;
  error: { message: string } | null;
}

type RpcClient = (name: string, args?: Record<string, unknown>) => PromiseLike<RpcResult>;

/** A read through the database's own projection, run as the signed-in person. */
async function rpc<T>(name: string, args: Record<string, unknown>): Promise<T> {
  const { supabase } = await import("@/integrations/supabase/client");
  const call = supabase.rpc as unknown as RpcClient;
  const { data, error } = await call(name, args);
  if (error) {
    const code = classifyPaymentsError(error.message ?? "");
    throw new PaymentsError(code, PAYMENT_REFUSAL_COPY[error.message ?? ""] ?? error.message ?? "");
  }
  return data as T;
}

/** A call to the app's own route. The caller's token decides what happens. */
async function call(
  path: string,
  accessToken: string | null,
  init: { method: string; body?: unknown } = { method: "GET" },
): Promise<unknown> {
  if (!accessToken) throw new PaymentsError("unauthorized", "no_token");
  let res: Response;
  try {
    res = await fetch(path, {
      method: init.method,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${accessToken}`,
      },
      ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
    });
  } catch {
    throw new PaymentsError("unknown", "request_failed");
  }
  const body = (await res.json().catch(() => null)) as {
    error?: unknown;
    message?: unknown;
  } | null;
  if (!res.ok) {
    const code = ERROR_CODES.find((candidate) => candidate === body?.error) ?? "unknown";
    throw new PaymentsError(
      code,
      typeof body?.message === "string" ? body.message : PAYMENTS_ERROR_COPY.unknown,
    );
  }
  return body;
}

const ERROR_CODES: readonly PaymentsErrorCode[] = [
  "forbidden",
  "not_found",
  "validation",
  "unauthorized",
  "unconfigured",
  "paused",
  "unknown",
];

export interface PaymentsApi {
  bookings(houseId: string): Promise<BookingSummary[]>;
  money(bookingId: string): Promise<BookingMoney>;
  startPayment(bookingId: string): Promise<PaymentStart>;
  verifyPayment(reference: string): Promise<VerifyOutcome>;
  complete(bookingId: string): Promise<void>;
  refund(bookingId: string, reason: string): Promise<void>;
}

/** What the provider says about a charge the host came back from. */
export interface VerifyOutcome {
  outcome: "allocated" | "refund_required" | "pending" | "unknown" | string;
  booking_id?: string;
}

/** F-102 wiring: the browser half of POST /api/bookings/:id/payments. */
export async function startBookingPayment(
  bookingId: string,
  accessToken: string | null,
): Promise<PaymentStart> {
  const body = (await call(`/api/bookings/${encodeURIComponent(bookingId)}/payments`, accessToken, {
    method: "POST",
  })) as {
    reference?: unknown;
    authorization_url?: unknown;
    amount_minor?: unknown;
    currency?: unknown;
  } | null;
  if (
    !body ||
    typeof body.reference !== "string" ||
    typeof body.authorization_url !== "string" ||
    typeof body.amount_minor !== "number" ||
    typeof body.currency !== "string"
  ) {
    throw new PaymentsError("unknown", "invalid_payment_response");
  }
  return {
    reference: body.reference,
    authorization_url: body.authorization_url,
    amount_minor: body.amount_minor,
    currency: body.currency,
  };
}

/** The token reader is injected so the panel can be rendered in tests without an auth provider. */
export function createPaymentsApi(getAccessToken: () => Promise<string | null>): PaymentsApi {
  return {
    bookings: (houseId) => rpc<BookingSummary[]>("my_bookings", { p_house: houseId }),
    money: async (bookingId) => {
      const body = (await call(
        `/api/bookings/${encodeURIComponent(bookingId)}/payments`,
        await getAccessToken(),
      )) as BookingMoney | null;
      if (!body || !body.fund) throw new PaymentsError("unknown", "invalid_fund_response");
      return { fund: body.fund, movements: body.movements ?? [] };
    },
    startPayment: async (bookingId) => startBookingPayment(bookingId, await getAccessToken()),
    verifyPayment: async (reference) => {
      const body = (await call(
        `/api/payments/verify?reference=${encodeURIComponent(reference)}`,
        await getAccessToken(),
      )) as VerifyOutcome | null;
      if (!body || typeof body.outcome !== "string") {
        throw new PaymentsError("unknown", "invalid_verify_response");
      }
      return body;
    },
    complete: async (bookingId) => {
      await call(
        `/api/bookings/${encodeURIComponent(bookingId)}/complete`,
        await getAccessToken(),
        {
          method: "POST",
        },
      );
    },
    refund: async (bookingId, reason) => {
      await call(`/api/bookings/${encodeURIComponent(bookingId)}/refund`, await getAccessToken(), {
        method: "POST",
        body: { reason },
      });
    },
  };
}
