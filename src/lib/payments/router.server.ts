/**
 * F-102 payment router: the one place in the app that may move money.
 *
 * Three doors, and only these three:
 *   - a host or a vendor, whose own token is forwarded so the database decides what they may do;
 *   - Paystack, which arrives signed and is verified before anything is recorded;
 *   - the platform's own sweep, which releases the money the completion window has closed on.
 *
 * The router is also the platform's own gate. Without PAYMENT_ROUTER_KEY it refuses to move money
 * at all, so a deployment that is only half configured cannot pay anybody. The key is never
 * logged, never returned to a browser and never written to a row: it is a switch, not an identity.
 *
 * The service-role key is used here and nowhere else in this feature, and only for the functions
 * the database has granted to service_role. Every rule about who may do what lives in the
 * database, not in this file.
 */
import { supabaseServerUrl, supabaseServiceRoleKey } from "@/lib/supabase-admin-env.server";
import {
  initializeTransaction,
  refundTransaction,
  verifyTransaction,
  type PaystackInitialized,
  type PaystackRefunded,
  type PaystackVerified,
} from "./paystack.server";

/** What can go wrong on the money path, in the shapes a caller has to answer. */
export type PaymentRouterErrorCode =
  "unconfigured" | "refused" | "not_found" | "validation" | "unknown";

export class PaymentRouterError extends Error {
  constructor(
    readonly code: PaymentRouterErrorCode,
    message: string,
    /** The database's SQLSTATE, when the refusal came from there. */
    readonly sqlstate = "",
  ) {
    super(message);
    this.name = "PaymentRouterError";
  }
}

/** The platform's own gate on the money path. Absent means the router does not run. */
export function paymentRouterKey(
  env: Record<string, string | undefined> = process.env,
): string | undefined {
  return env["PAYMENT_ROUTER_KEY"]?.trim() || undefined;
}

function requireRouterKey(): void {
  if (!paymentRouterKey()) {
    throw new PaymentRouterError("unconfigured", "payment_router_not_configured");
  }
}

/** The database's own refusal, kept as a code the caller can read without the raw text. */
function classify(sqlstate: string): PaymentRouterErrorCode {
  if (sqlstate === "P0002") return "not_found";
  if (sqlstate === "22023") return "validation";
  if (sqlstate === "42501") return "refused";
  if (sqlstate === "28000") return "unconfigured";
  return "unknown";
}

/**
 * A call to the database as the platform. The service role reaches only the functions that were
 * granted to it, and each of those functions carries its own rule about the money.
 */
async function callAsService(rpc: string, payload: Record<string, unknown>): Promise<unknown> {
  requireRouterKey();
  const url = supabaseServerUrl();
  const key = supabaseServiceRoleKey();
  if (!url || !key) {
    throw new PaymentRouterError("unconfigured", "supabase_not_configured");
  }

  let res: Response;
  try {
    res = await fetch(`${url.replace(/\/+$/, "")}/rest/v1/rpc/${rpc}`, {
      method: "POST",
      headers: {
        apikey: key,
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });
  } catch {
    throw new PaymentRouterError("unknown", "database_unreachable");
  }

  if (!res.ok) {
    let sqlstate = "";
    let message = "";
    try {
      const body = (await res.json()) as { code?: unknown; message?: unknown };
      sqlstate = String(body.code ?? "");
      message = String(body.message ?? "");
    } catch {
      sqlstate = "";
    }
    // The message is the database's own name for the refusal (payment_already_recorded,
    // payments_paused, ...). It names no money and no person.
    throw new PaymentRouterError(classify(sqlstate), message || `rpc_${rpc}_failed`, sqlstate);
  }

  return res.json().catch(() => null);
}

// ---------------------------------------------------------------------------
// The money
// ---------------------------------------------------------------------------

/**
 * Record a paid booking: the money is held, the first 70% goes out, and the completion window
 * for the last 30% starts. The database owns every rule; this only hands it the provider's
 * evidence.
 *
 * Returns 'allocated', or 'refund_required' when the host lost the date and the money is owed
 * back instead.
 */
export async function allocateSplitPayment(
  bookingId: string,
  reference: string,
  amountMinor: number,
  currency: string,
): Promise<string> {
  const outcome = await callAsService("allocate_split_payment", {
    p_booking: bookingId,
    p_reference: reference,
    p_amount_minor: amountMinor,
    p_currency: currency,
  });
  return typeof outcome === "string" ? outcome : "unknown";
}

/**
 * One provider event, recorded once. A replay of the same event changes nothing, which is what
 * makes a webhook safe to retry.
 */
export async function recordProviderEvent(input: {
  eventType: "charge.success" | "refund.processed" | "charge.failed";
  reference: string;
  amountMinor: number;
  currency: string;
  payload: Record<string, unknown>;
  bookingId?: string | null;
}): Promise<string> {
  const outcome = await callAsService("record_payment_event", {
    p_event_type: input.eventType,
    p_reference: input.reference,
    p_amount_minor: input.amountMinor,
    p_currency: input.currency,
    p_payload: input.payload,
    p_booking: input.bookingId ?? null,
  });
  return typeof outcome === "string" ? outcome : "unknown";
}

/** F-60: keep the reusable Paystack reference for the host who paid. Never a card number. */
export async function savePaymentAuthorization(input: {
  bookingId: string;
  authorizationCode: string;
  cardBrand: string | null;
  last4: string | null;
  expMonth: string | null;
  expYear: string | null;
  reusable: boolean;
}): Promise<string> {
  const outcome = await callAsService("save_payment_authorization", {
    p_booking: input.bookingId,
    p_code: input.authorizationCode,
    p_brand: input.cardBrand,
    p_last4: input.last4,
    p_exp_month: input.expMonth,
    p_exp_year: input.expYear,
    p_reusable: input.reusable,
  });
  return typeof outcome === "string" ? outcome : "unknown";
}

/** F-48: remember the Dedicated Virtual Account Paystack created for this user. */
export async function storeDedicatedAccount(input: {
  userId: string;
  customerCode: string;
  accountNumber: string;
  accountName: string;
  bankName: string;
}): Promise<string> {
  const outcome = await callAsService("store_dedicated_account", {
    p_user: input.userId,
    p_customer: input.customerCode,
    p_number: input.accountNumber,
    p_name: input.accountName,
    p_bank: input.bankName,
  });
  return typeof outcome === "string" ? outcome : "unknown";
}

/** The provider has sent the money back, so the ledger follows. */
export async function settleRefund(bookingId: string, reference: string): Promise<string> {
  const outcome = await callAsService("settle_refund", {
    p_booking: bookingId,
    p_reference: reference,
  });
  return typeof outcome === "string" ? outcome : "unknown";
}

/** Release the tranches whose completion window has closed. Returns how many were released. */
export async function releaseDueTranches(): Promise<number> {
  const outcome = await callAsService("release_due_fund_tranches", {});
  return Number(outcome ?? 0);
}

/** The booking a provider reference belongs to, once the payment has been recorded. */
export async function bookingForReference(reference: string): Promise<string | null> {
  const outcome = await callAsService("booking_for_payment_reference", {
    p_reference: reference,
  });
  return typeof outcome === "string" && outcome.length > 0 ? outcome : null;
}

// ---------------------------------------------------------------------------
// The provider
// ---------------------------------------------------------------------------

/** Start a charge for a booking. The booking id rides along so a webhook can find it. */
export async function startCharge(input: {
  email: string;
  amountMinor: number;
  currency: string;
  reference: string;
  bookingId: string;
}): Promise<PaystackInitialized> {
  requireRouterKey();
  return initializeTransaction(input);
}

/** Ask the provider what happened to a charge. */
export async function verifyCharge(reference: string): Promise<PaystackVerified> {
  requireRouterKey();
  return verifyTransaction(reference);
}

/** Ask the provider to send the money back. */
export async function sendRefund(input: {
  reference: string;
  amountMinor: number;
  reason: string;
}): Promise<PaystackRefunded> {
  requireRouterKey();
  return refundTransaction(input);
}
