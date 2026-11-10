/**
 * F-102 fund pool: the shapes a host reads and the few things a person may type.
 *
 * The amounts are integers in the currency's minor unit, exactly as the ledger holds them. The
 * deadlines come from the server and are never counted down in the browser.
 */
import { z } from "zod";

/** One booking, as the two houses that are party to it see it. */
export interface BookingSummary {
  booking_id: string;
  quote_id: string;
  service_date: string;
  total_minor: number;
  currency: string;
  booking_status: string;
  pool_status: string;
  paid_minor: number;
  held_minor: number;
  released_minor: number;
  refunded_minor: number;
  release_30_due_at: string | null;
  frozen: boolean;
  is_host_side: boolean;
  counterparty_name: string;
}

/** The money of one booking, from public.booking_fund(). */
export interface BookingFund {
  booking_id: string;
  quote_id: string;
  service_date: string;
  total_minor: number;
  currency: string;
  booking_status: string;
  pool_status: string;
  paid_minor: number;
  held_minor: number;
  released_70_minor: number;
  released_30_minor: number;
  commission_minor: number;
  tax_minor: number;
  vendor_net_minor: number;
  refunded_minor: number;
  release_30_due_at: string | null;
  paid_at: string | null;
  completed_at: string | null;
  refunded_at: string | null;
  frozen: boolean;
  frozen_reason: string | null;
  payment_reference: string | null;
  is_host_side: boolean;
  counterparty_house: string;
  counterparty_name: string;
}

/** One movement of the money, from public.booking_movements(). */
export interface FundMovement {
  movement: string;
  direction: "in" | "out";
  amount_minor: number;
  currency: string;
  reference: string | null;
  memo: string | null;
  created_at: string;
}

/** What a host gets back when a payment starts: where to send them to pay. */
export interface PaymentStart {
  reference: string;
  authorization_url: string;
  amount_minor: number;
  currency: string;
}

/** The pool's status, in the words a host reads. */
export const POOL_STATUS_LABELS: Record<string, string> = {
  awaiting_payment: "Waiting for your payment",
  held: "Paid — held for the celebration",
  partially_released: "Part paid out",
  released: "Fully paid out",
  refund_pending: "Refund on its way",
  refunded: "Refunded",
};

/** The movement labels, in the words a host reads. */
export const MOVEMENT_LABELS: Record<string, string> = {
  booking_hold: "Payment received",
  release_70: "First release to the vendor",
  release_30: "Final release to the vendor",
  fee: "Platform fee",
  refund: "Refund requested",
  refund_settled: "Refund sent",
  payout: "Payout to the vendor",
};

/** Why a host asks for the money back. It is a sentence, not a code. */
export const refundRequestSchema = z.object({
  reason: z
    .string()
    .trim()
    .min(3, "Tell us why you want the money back.")
    .max(200, "Keep the reason short."),
});
export type RefundRequest = z.infer<typeof refundRequestSchema>;

/** Why a fund is frozen. Only a staff member with an arbitrator grant may say it. */
export const freezeRequestSchema = z.object({
  reason: z
    .string()
    .trim()
    .min(3, "Say why the money is being held.")
    .max(200, "Keep the reason short."),
});
export type FreezeRequest = z.infer<typeof freezeRequestSchema>;

/** The reference a provider gives a charge, as the browser sends it back after paying. */
export const paymentReferenceSchema = z
  .string()
  .trim()
  .min(1, "That payment reference is not valid.")
  .max(120, "That payment reference is not valid.");

// ---------------------------------------------------------------------------
// The refusals
// ---------------------------------------------------------------------------
/** How the money path can refuse. The browser turns each into a sentence. */
export type PaymentsErrorCode =
  "forbidden" | "not_found" | "validation" | "unauthorized" | "unconfigured" | "paused" | "unknown";

/**
 * The database names its refusals; a person needs a sentence. The names carry no money and no
 * personal detail, so this map is the whole of what a refusal tells the browser.
 */
export const PAYMENT_REFUSAL_COPY: Record<string, string> = {
  payments_paused: "Payments are paused at the moment. Nothing you have done is wrong.",
  payment_already_recorded: "This booking has already been paid.",
  payment_below_quote_total: "The amount paid is less than the agreed total.",
  currency_mismatch: "The payment was made in a different currency.",
  payment_reference_required: "That payment reference is not valid.",
  payment_reference_rejected: "That payment reference is not valid.",
  invalid_paid_amount: "The amount paid could not be read.",
  invalid_currency: "The currency could not be read.",
  reason_required: "Tell us why you want the money back.",
  reason_rejected: "That reason cannot be recorded.",
  nothing_held_to_refund: "There is no money left to refund on this booking.",
  nothing_held_to_freeze: "There is no money left to hold on this booking.",
  booking_not_paid: "This booking has not been paid yet.",
  fund_pool_frozen: "This money is on hold while a dispute is open.",
  first_tranche_not_released: "The first release has not happened yet.",
  no_refund_pending: "There is no refund waiting to be sent.",
  first_release_failed: "The booking was paid, but the first release could not be made.",
};

/** The refusal the database named, read as a code. */
export function classifyPaymentsError(refusal: string): PaymentsErrorCode {
  const text = (refusal ?? "").toLowerCase();
  if (text.includes("payments_paused")) return "paused";
  if (text.includes("forbidden") || text.includes("permission denied")) return "forbidden";
  if (text.includes("auth_not_configured")) return "unconfigured";
  if (text.includes("not_found")) return "not_found";
  const named = Object.keys(PAYMENT_REFUSAL_COPY).find((name) => text.includes(name));
  return named ? "validation" : "unknown";
}

/** The sentence for a refusal the database named, or null when it named something we do not know. */
export function refusalCopyFor(refusal: string): string | null {
  const text = (refusal ?? "").toLowerCase();
  const named = Object.keys(PAYMENT_REFUSAL_COPY).find((name) => text.includes(name));
  return named ? (PAYMENT_REFUSAL_COPY[named] ?? null) : null;
}
