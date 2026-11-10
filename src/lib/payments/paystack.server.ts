/**
 * Paystack (F-79 wiring, F-102 money path). Two jobs live here and nowhere else: proving a
 * webhook is genuine, and talking to the Paystack API with the secret key.
 *
 * The secret key is read inside a call, never at module scope, and never written to a log, a
 * response or a database row. A provider refusal is never returned to the browser: Paystack's own
 * message can echo the request back, so only the shape of the refusal leaves this module.
 */
import { sanitizeForLog } from "./credential-guard";

const enc = new TextEncoder();

function toHex(buf: ArrayBuffer): string {
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export async function paystackSignature(rawBody: string, secretKey: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(secretKey),
    { name: "HMAC", hash: "SHA-512" },
    false,
    ["sign"],
  );
  return toHex(await crypto.subtle.sign("HMAC", key, enc.encode(rawBody)));
}

export async function verifyPaystackSignature(
  rawBody: string,
  signature: string | null,
  secretKey: string | undefined,
): Promise<boolean> {
  if (!signature || !secretKey) return false;
  const expected = await paystackSignature(rawBody, secretKey);
  return timingSafeEqual(expected, signature.trim().toLowerCase());
}

// ---------------------------------------------------------------------------
// The API client
// ---------------------------------------------------------------------------
const PAYSTACK_API = "https://api.paystack.co";

/** The provider's own refusals, in the three shapes this app has to answer. */
export type PaystackErrorCode = "unconfigured" | "refused" | "unavailable";

export class PaystackError extends Error {
  constructor(
    readonly code: PaystackErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "PaystackError";
  }
}

/** The secret key, read at the point of use so it never sits in a module-level constant. */
export function paystackSecretKey(
  env: Record<string, string | undefined> = process.env,
): string | undefined {
  return env["PAYSTACK_SECRET_KEY"]?.trim() || undefined;
}

interface PaystackEnvelope {
  status?: boolean;
  message?: string;
  data?: unknown;
}

/**
 * One call to the provider. The response body is read once and only the data is handed back;
 * the key never appears in a request we can see in a log.
 */
async function paystackRequest<T>(
  path: string,
  init: { method: string; body?: unknown },
): Promise<T> {
  const key = paystackSecretKey();
  if (!key) throw new PaystackError("unconfigured", "paystack_not_configured");

  let res: Response;
  try {
    res = await fetch(`${PAYSTACK_API}${path}`, {
      method: init.method,
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
      },
      ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
    });
  } catch {
    throw new PaystackError("unavailable", "paystack_unreachable");
  }

  let envelope: PaystackEnvelope;
  try {
    envelope = (await res.json()) as PaystackEnvelope;
  } catch {
    throw new PaystackError("unavailable", "paystack_bad_body");
  }

  if (!res.ok || envelope.status !== true) {
    console.error(
      "paystack request refused",
      res.status,
      sanitizeForLog(String(envelope.message ?? "unknown")),
    );
    throw new PaystackError("refused", "paystack_refused");
  }
  return envelope.data as T;
}

export interface PaystackInitialized {
  reference: string;
  authorizationUrl: string;
  amountMinor: number;
  currency: string;
}

/**
 * Start a charge. The booking id rides along in the metadata so a webhook can find the booking
 * without guessing. Paystack counts amounts in the currency's minor unit, which is the same unit
 * the platform's ledger counts in.
 */
export async function initializeTransaction(input: {
  email: string;
  amountMinor: number;
  currency: string;
  reference: string;
  bookingId: string;
}): Promise<PaystackInitialized> {
  const data = await paystackRequest<{
    reference?: unknown;
    authorization_url?: unknown;
    amount?: unknown;
    currency?: unknown;
  }>("/transaction/initialize", {
    method: "POST",
    body: {
      email: input.email,
      amount: input.amountMinor,
      currency: input.currency.trim().toUpperCase(),
      reference: input.reference,
      metadata: { booking_id: input.bookingId },
    },
  });

  const reference = typeof data.reference === "string" ? data.reference : "";
  const authorizationUrl = typeof data.authorization_url === "string" ? data.authorization_url : "";
  if (!reference || !authorizationUrl) {
    throw new PaystackError("refused", "paystack_initialize_incomplete");
  }
  return {
    reference,
    authorizationUrl,
    amountMinor: Number(data.amount ?? input.amountMinor),
    currency: typeof data.currency === "string" ? data.currency : input.currency,
  };
}

export interface PaystackVerified {
  reference: string;
  status: string;
  amountMinor: number;
  currency: string;
  paidAt: string | null;
  bookingId: string | null;
}

/** Ask the provider what happened to a charge. The answer is evidence, not a decision. */
export async function verifyTransaction(reference: string): Promise<PaystackVerified> {
  const data = await paystackRequest<{
    reference?: unknown;
    status?: unknown;
    amount?: unknown;
    currency?: unknown;
    paid_at?: unknown;
    metadata?: unknown;
  }>(`/transaction/verify/${encodeURIComponent(reference)}`, { method: "GET" });

  const metadata = data.metadata as { booking_id?: unknown } | undefined;
  return {
    reference: typeof data.reference === "string" ? data.reference : reference,
    status: typeof data.status === "string" ? data.status : "unknown",
    amountMinor: Number(data.amount ?? 0),
    currency: typeof data.currency === "string" ? data.currency : "",
    paidAt: typeof data.paid_at === "string" ? data.paid_at : null,
    bookingId:
      metadata && typeof metadata.booking_id === "string" && metadata.booking_id.length > 0
        ? metadata.booking_id
        : null,
  };
}

export interface PaystackRefunded {
  reference: string;
  status: string;
  amountMinor: number;
}

/** Send a charge back. The provider sends its own reference for the refund. */
export async function refundTransaction(input: {
  reference: string;
  amountMinor: number;
  reason: string;
}): Promise<PaystackRefunded> {
  const data = await paystackRequest<{
    reference?: unknown;
    status?: unknown;
    amount?: unknown;
  }>(`/transaction/refund/${encodeURIComponent(input.reference)}`, {
    method: "POST",
    body: { amount: input.amountMinor, reason: input.reason },
  });

  return {
    reference: typeof data.reference === "string" ? data.reference : input.reference,
    status: typeof data.status === "string" ? data.status : "unknown",
    amountMinor: Number(data.amount ?? input.amountMinor),
  };
}

export interface PaystackDedicatedAccount {
  customerCode: string;
  accountNumber: string;
  accountName: string;
  bankName: string;
}

/**
 * F-48: create the customer's Paystack Dedicated Virtual Account. Called on first checkout only
 * (owner decision 2026-11-10). Money paid into it is held by Paystack, never by Ówàńbè.
 */
export async function createDedicatedAccount(input: {
  email: string;
  firstName: string;
  lastName: string;
  phone?: string;
  preferredBank?: string;
}): Promise<PaystackDedicatedAccount> {
  const customer = await paystackRequest<{ customer_code?: unknown }>("/customer", {
    method: "POST",
    body: {
      email: input.email,
      first_name: input.firstName,
      last_name: input.lastName,
      phone: input.phone,
    },
  });
  const customerCode = typeof customer.customer_code === "string" ? customer.customer_code : "";
  if (!customerCode) throw new PaystackError("refused", "paystack_customer_incomplete");

  const dva = await paystackRequest<{
    account_number?: unknown;
    account_name?: unknown;
    bank?: { name?: unknown };
  }>("/dedicated_account", {
    method: "POST",
    body: { customer: customerCode, preferred_bank: input.preferredBank ?? "wema-bank" },
  });
  const accountNumber = typeof dva.account_number === "string" ? dva.account_number : "";
  if (!/^\d{10}$/.test(accountNumber)) throw new PaystackError("refused", "paystack_dva_incomplete");
  return {
    customerCode,
    accountNumber,
    accountName: typeof dva.account_name === "string" ? dva.account_name : "",
    bankName: typeof dva.bank?.name === "string" ? dva.bank.name : "",
  };
}

/** F-60: keep only the reusable reference and display fields. Never the card number. */
export function safeAuthorization(raw: unknown): {
  authorizationCode: string;
  cardBrand: string | null;
  last4: string | null;
  expMonth: string | null;
  expYear: string | null;
  reusable: boolean;
} | null {
  if (!raw || typeof raw !== "object") return null;
  const a = raw as Record<string, unknown>;
  const code = typeof a["authorization_code"] === "string" ? a["authorization_code"] : "";
  if (!/^AUTH_[A-Za-z0-9]+$/.test(code)) return null;
  const pick = (k: string, re: RegExp) => {
    const v = a[k];
    return typeof v === "string" && re.test(v) ? v : null;
  };
  return {
    authorizationCode: code,
    cardBrand: pick("brand", /^[A-Za-z ]{1,20}$/),
    last4: pick("last4", /^\d{4}$/),
    expMonth: pick("exp_month", /^\d{2}$/),
    expYear: pick("exp_year", /^\d{4}$/),
    reusable: a["reusable"] === true,
  };
}
