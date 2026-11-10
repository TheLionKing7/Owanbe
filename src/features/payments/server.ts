/**
 * F-102 server-only boundary for the booking payment routes.
 *
 * Every read and every rule about who may do what runs as the caller: the caller's own token is
 * forwarded to the database, which decides. The service-role path is used only for the provider's
 * own record of a charge, which no caller may write and which no browser can forge.
 *
 * The database is the authority. This file translates: a refusal becomes a sentence, and money
 * never becomes a number the caller supplied.
 */
import {
  PaymentRouterError,
  allocateSplitPayment,
  bookingForReference,
  sendRefund,
  startCharge,
  verifyCharge,
} from "@/lib/payments/router.server";
import {
  PAYMENT_REFUSAL_COPY,
  classifyPaymentsError,
  freezeRequestSchema,
  paymentReferenceSchema,
  refusalCopyFor,
  refundRequestSchema,
  type BookingFund,
  type FundMovement,
} from "./contracts";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

function callerToken(request: Request): string | null {
  const header = request.headers.get("authorization");
  const token = header?.startsWith("Bearer ") ? header.slice(7).trim() : "";
  return token.split(".").length === 3 ? token : null;
}

/** The publishable key only: a secret key would answer as the server, not as the caller. */
function callerCredentials(): { url: string; key: string } | null {
  const url = process.env["EXTERNAL_SUPABASE_URL"] ?? process.env["SUPABASE_URL"];
  const key =
    process.env["EXTERNAL_SUPABASE_PUBLISHABLE_KEY"] ?? process.env["SUPABASE_PUBLISHABLE_KEY"];
  if (!url || !key || key.startsWith("sb_secret_")) return null;
  return { url: url.replace(/\/+$/, ""), key };
}

async function callAsCaller(
  rpc: string,
  token: string,
  payload: Record<string, unknown>,
): Promise<Response> {
  const credentials = callerCredentials();
  if (!credentials) throw new Error("unconfigured");
  return fetch(`${credentials.url}/rest/v1/rpc/${rpc}`, {
    method: "POST",
    headers: {
      apikey: credentials.key,
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });
}

const UNCONFIGURED = {
  error: "unconfigured",
  message: "Sign-in is not configured in this environment, so payments stay locked.",
};

const PAYMENTS_FORBIDDEN = "This booking belongs to another house.";

/** The database's own refusal, turned into what the browser is told. Raw text is not returned. */
async function failure(res: Response): Promise<Response> {
  let code = "";
  let message = "";
  try {
    const body = (await res.json()) as { code?: unknown; message?: unknown };
    code = String(body.code ?? "");
    message = String(body.message ?? "");
  } catch {
    code = "";
  }
  const errorCode = classifyPaymentsError(message);
  const copy = refusalCopyFor(message);
  if (errorCode === "unauthorized") {
    return json({ error: "unauthorized", message: "Sign in to manage payments." }, 401);
  }
  if (errorCode === "forbidden") {
    return json({ error: "forbidden", message: PAYMENTS_FORBIDDEN }, 403);
  }
  if (errorCode === "not_found") {
    return json({ error: "not_found", message: "We could not find that booking." }, 404);
  }
  if (errorCode === "paused") {
    return json(
      {
        error: "paused",
        message: PAYMENT_REFUSAL_COPY["payments_paused"] ?? "Payments are paused at the moment.",
      },
      503,
    );
  }
  if (errorCode === "validation") {
    return json({ error: "validation", message: copy ?? "Check the details and try again." }, 400);
  }
  console.error("payment rpc failed", res.status, code);
  return json({ error: "unknown", message: "Something went wrong. Try again in a moment." }, 502);
}

/** The platform's own refusal, turned into what the browser is told. */
function routerFailure(error: unknown): Response {
  if (error instanceof PaymentRouterError) {
    if (error.code === "unconfigured") {
      return json(
        { error: "unconfigured", message: "Payments are not set up in this environment yet." },
        503,
      );
    }
    if (error.code === "not_found") {
      return json({ error: "not_found", message: "We could not find that booking." }, 404);
    }
    if (error.code === "validation") {
      return json(
        {
          error: "validation",
          message: refusalCopyFor(error.message) ?? "Check the details and try again.",
        },
        400,
      );
    }
    if (error.code === "refused") {
      return json({ error: "forbidden", message: PAYMENTS_FORBIDDEN }, 403);
    }
  }
  console.error("payment router failed", error instanceof Error ? error.message : "unknown");
  return json({ error: "unknown", message: "Something went wrong. Try again in a moment." }, 502);
}

/**
 * A payment reference the platform made. Every group carries a letter, so no run of digits in it
 * can be mistaken for a card number by the credential guard.
 */
export function paymentReference(): string {
  const hex = crypto.randomUUID().replace(/-/g, "").toLowerCase();
  const letters = "abcdefghijkmnpqrstuvwxyz";
  const groups: string[] = [];
  for (let index = 0; index < 4; index++) {
    const chunk = hex.slice(index * 8, index * 8 + 8);
    const letter = letters[Number.parseInt(chunk.slice(0, 2), 16) % letters.length] ?? "a";
    groups.push(`${letter}${chunk.slice(2)}`);
  }
  return `owanbe-${groups.join("-")}`;
}

// ---------------------------------------------------------------------------
// GET /api/bookings/:id/payments — the money of one booking
// ---------------------------------------------------------------------------
export async function bookingMoneyAsCaller(request: Request, bookingId: string): Promise<Response> {
  if (!UUID_PATTERN.test(bookingId)) {
    return json({ error: "validation", message: "That booking link is not valid." }, 400);
  }
  const token = callerToken(request);
  if (!token) {
    return json({ error: "unauthorized", message: "Sign in to manage payments." }, 401);
  }

  let fundRes: Response;
  let movementsRes: Response;
  try {
    [fundRes, movementsRes] = await Promise.all([
      callAsCaller("booking_fund", token, { p_booking: bookingId }),
      callAsCaller("booking_movements", token, { p_booking: bookingId }),
    ]);
  } catch {
    return json(UNCONFIGURED, 503);
  }
  if (!fundRes.ok) return failure(fundRes);
  if (!movementsRes.ok) return failure(movementsRes);

  const rows = (await fundRes.json()) as BookingFund[];
  const fund = rows[0];
  if (!fund) {
    return json({ error: "not_found", message: "We could not find that booking." }, 404);
  }
  const movements = (await movementsRes.json()) as FundMovement[];

  return json({ fund, movements }, 200);
}

// ---------------------------------------------------------------------------
// POST /api/bookings/:id/payments — start a payment
// ---------------------------------------------------------------------------
export async function startBookingPaymentAsCaller(
  request: Request,
  bookingId: string,
): Promise<Response> {
  if (!UUID_PATTERN.test(bookingId)) {
    return json({ error: "validation", message: "That booking link is not valid." }, 400);
  }
  const token = callerToken(request);
  if (!token) {
    return json({ error: "unauthorized", message: "Sign in to manage payments." }, 401);
  }

  let res: Response;
  try {
    res = await callAsCaller("booking_payment_request", token, { p_booking: bookingId });
  } catch {
    return json(UNCONFIGURED, 503);
  }
  if (!res.ok) return failure(res);

  const rows = (await res.json()) as {
    total_minor: number;
    currency: string;
    host_email: string;
  }[];
  const needed = rows[0];
  if (!needed) {
    return json({ error: "not_found", message: "We could not find that booking." }, 404);
  }
  if (!needed.host_email) {
    return json(
      {
        error: "validation",
        message: "Your house has no email address, so we cannot take a payment yet.",
      },
      400,
    );
  }
  if (!Number.isInteger(needed.total_minor) || needed.total_minor < 1) {
    return json({ error: "validation", message: "There is nothing to pay on this booking." }, 400);
  }

  const reference = paymentReference();
  let started;
  try {
    started = await startCharge({
      email: needed.host_email,
      amountMinor: needed.total_minor,
      currency: needed.currency,
      reference,
      bookingId,
    });
  } catch (error) {
    return routerFailure(error);
  }

  return json(
    {
      reference: started.reference,
      authorization_url: started.authorizationUrl,
      amount_minor: needed.total_minor,
      currency: needed.currency,
    },
    201,
  );
}

// ---------------------------------------------------------------------------
// GET /api/payments/verify — a payment the host came back from
// ---------------------------------------------------------------------------
/**
 * The provider redirects the host back with the reference of the charge. The server asks the
 * provider what happened, and only a confirmed charge is recorded. A browser redirect is never
 * evidence on its own.
 */
export async function verifyPaymentReferenceAsCaller(request: Request): Promise<Response> {
  const token = callerToken(request);
  if (!token) {
    return json({ error: "unauthorized", message: "Sign in to manage payments." }, 401);
  }
  const raw = new URL(request.url).searchParams.get("reference") ?? "";
  const parsed = paymentReferenceSchema.safeParse(raw);
  if (!parsed.success) {
    return json({ error: "validation", message: "That payment reference is not valid." }, 400);
  }

  let verified;
  try {
    verified = await verifyCharge(parsed.data);
  } catch (error) {
    return routerFailure(error);
  }
  if (verified.status !== "success") {
    return json({ outcome: "pending" }, 200);
  }

  let bookingId = verified.bookingId;
  if (!bookingId) {
    try {
      bookingId = await bookingForReference(verified.reference);
    } catch (error) {
      return routerFailure(error);
    }
  }
  if (!bookingId) {
    return json({ outcome: "unknown" }, 200);
  }

  let outcome: string;
  try {
    outcome = await allocateSplitPayment(
      bookingId,
      verified.reference,
      verified.amountMinor,
      verified.currency,
    );
  } catch (error) {
    return routerFailure(error);
  }

  // The booking id is only returned to a caller who may see that booking at all.
  let visible = false;
  try {
    const res = await callAsCaller("booking_fund", token, { p_booking: bookingId });
    visible = res.ok;
  } catch {
    visible = false;
  }

  return json(visible ? { outcome, booking_id: bookingId } : { outcome }, 200);
}

// ---------------------------------------------------------------------------
// POST /api/bookings/:id/complete — the host confirms the celebration happened
// ---------------------------------------------------------------------------
export async function completeBookingAsCaller(
  request: Request,
  bookingId: string,
): Promise<Response> {
  if (!UUID_PATTERN.test(bookingId)) {
    return json({ error: "validation", message: "That booking link is not valid." }, 400);
  }
  const token = callerToken(request);
  if (!token) {
    return json({ error: "unauthorized", message: "Sign in to manage payments." }, 401);
  }

  let res: Response;
  try {
    res = await callAsCaller("complete_booking", token, { p_booking: bookingId });
  } catch {
    return json(UNCONFIGURED, 503);
  }
  if (!res.ok) return failure(res);
  const outcome = (await res.json()) as string;
  return json({ outcome }, 200);
}

// ---------------------------------------------------------------------------
// POST /api/bookings/:id/refund — the host asks for the money back
// ---------------------------------------------------------------------------
/**
 * The database records the obligation first, and the provider is asked afterwards. If the
 * provider refuses, the obligation still stands: the money is still owed to the host, and
 * settle_refund records it when the provider sends it.
 */
export async function refundBookingAsCaller(
  request: Request,
  bookingId: string,
): Promise<Response> {
  if (!UUID_PATTERN.test(bookingId)) {
    return json({ error: "validation", message: "That booking link is not valid." }, 400);
  }
  const token = callerToken(request);
  if (!token) {
    return json({ error: "unauthorized", message: "Sign in to manage payments." }, 401);
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return json({ error: "validation", message: "Tell us why you want the money back." }, 400);
  }
  const parsed = refundRequestSchema.safeParse(body);
  if (!parsed.success) {
    return json(
      {
        error: "validation",
        message: parsed.error.issues[0]?.message ?? "Tell us why you want the money back.",
      },
      400,
    );
  }

  // What is still held, and the reference the provider knows it by.
  let fundRes: Response;
  try {
    fundRes = await callAsCaller("booking_fund", token, { p_booking: bookingId });
  } catch {
    return json(UNCONFIGURED, 503);
  }
  if (!fundRes.ok) return failure(fundRes);
  const fund = ((await fundRes.json()) as BookingFund[])[0];
  if (!fund) {
    return json({ error: "not_found", message: "We could not find that booking." }, 404);
  }

  let requested: Response;
  try {
    requested = await callAsCaller("request_fund_refund", token, {
      p_booking: bookingId,
      p_reason: parsed.data.reason,
    });
  } catch {
    return json(UNCONFIGURED, 503);
  }
  if (!requested.ok) return failure(requested);
  const outcome = (await requested.json()) as string;

  if (outcome === "refunded" || !fund.payment_reference || fund.held_minor < 1) {
    return json({ outcome }, 200);
  }

  try {
    await sendRefund({
      reference: fund.payment_reference,
      amountMinor: fund.held_minor,
      reason: "Host requested a refund for a booking",
    });
  } catch (error) {
    // The obligation is recorded in the ledger; the provider has not moved the money yet. The
    // host is told the truth rather than a failure they cannot act on.
    console.error("paystack refund not sent", error instanceof Error ? error.message : "unknown");
    return json({ outcome, pending: true }, 202);
  }

  return json({ outcome }, 200);
}

// ---------------------------------------------------------------------------
// POST /api/bookings/:id/freeze — an arbitrator holds the money
// ---------------------------------------------------------------------------
export async function freezeBookingFundAsCaller(
  request: Request,
  bookingId: string,
): Promise<Response> {
  if (!UUID_PATTERN.test(bookingId)) {
    return json({ error: "validation", message: "That booking link is not valid." }, 400);
  }
  const token = callerToken(request);
  if (!token) {
    return json({ error: "unauthorized", message: "Sign in to manage payments." }, 401);
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return json({ error: "validation", message: "Say why the money is being held." }, 400);
  }
  const parsed = freezeRequestSchema.safeParse(body);
  if (!parsed.success) {
    return json(
      {
        error: "validation",
        message: parsed.error.issues[0]?.message ?? "Say why the money is being held.",
      },
      400,
    );
  }

  let res: Response;
  try {
    res = await callAsCaller("freeze_fund_pool", token, {
      p_booking: bookingId,
      p_reason: parsed.data.reason,
    });
  } catch {
    return json(UNCONFIGURED, 503);
  }
  if (!res.ok) return failure(res);
  return json({ outcome: "frozen" }, 200);
}
