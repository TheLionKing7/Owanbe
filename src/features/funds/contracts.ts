/**
 * F-109 recovery fund: the shapes staff read and the few things a person may type.
 *
 * Every amount is an integer in the currency's minor unit, exactly as the ledger holds it. The
 * split is never calculated here: the database owns the 70/30 rule and the fees, and the browser
 * asks it. A person types a reason and an amount; the platform decides what that means.
 */
import { z } from "zod";

// ---------------------------------------------------------------------------
// The shapes
// ---------------------------------------------------------------------------

/** The 70/30 split of a booking total, with the fees of each tranche. */
export interface SplitAllocation {
  release_70: number;
  release_30: number;
  commission_70: number;
  tax_70: number;
  vendor_net_70: number;
  commission_30: number;
  tax_30: number;
  vendor_net_30: number;
}

/** What the recovery fund holds, per currency. */
export interface RecoveryFundBalance {
  currency: string;
  balance_minor: number;
  clawed_back_minor: number;
  advanced_minor: number;
  open_actions: number;
}

/** One recovery request, as the staff console reads it. */
export interface RecoveryActionRow {
  action_id: string;
  reference: string;
  kind: "clawback" | "advance";
  status: "requested" | "approved" | "settled" | "refused" | "void";
  case_id: string;
  case_reference: string;
  booking_id: string;
  pool_id: string;
  currency: string;
  amount_minor: number;
  replacement_cost_minor: number | null;
  requested_by: string;
  requested_by_name: string;
  approvals: number;
  requested_at: string;
  approved_at: string | null;
  settled_at: string | null;
  reason: string;
}

/** The money a case is about, so staff can see the currency and the ceiling before asking. */
export interface RecoveryCaseContext {
  case_id: string;
  case_reference: string;
  case_status: string;
  booking_id: string;
  pool_id: string;
  currency: string;
  paid_minor: number;
  refunded_minor: number;
  vendor_payable_minor: number;
  fund_balance_minor: number;
}

/** One movement of the recovery money. */
export interface FundPoolLedgerEntry {
  movement: "clawback" | "advance";
  direction: "in" | "out";
  amount_minor: number;
  currency: string;
  memo: string | null;
  created_at: string;
}

/** A pool whose completion window has closed and whose last tranche is waiting. */
export interface DueFundPool {
  pool_id: string;
  booking_id: string;
  host_house_id: string;
  vendor_house_id: string;
  currency: string;
  total_minor: number;
  paid_minor: number;
  held_minor: number;
  released_70_minor: number;
  release_30_due_at: string | null;
  frozen: boolean;
}

/** What a reconciliation run found. It moves no money. */
export interface ReconciliationReport {
  events_checked: number;
  pools_checked: number;
  matched: number;
  exception_count: number;
  exceptions: Array<{ code: string; [key: string]: unknown }>;
}

// ---------------------------------------------------------------------------
// The labels
// ---------------------------------------------------------------------------

/** The kind of recovery money, in the words staff read. */
export const RECOVERY_KIND_LABELS: Record<string, string> = {
  clawback: "Taken back from the vendor",
  advance: "Advanced to the host",
};

/** The state of a recovery request, in the words staff read. */
export const RECOVERY_STATUS_LABELS: Record<string, string> = {
  requested: "Waiting for two approvals",
  approved: "Approved, not yet paid",
  settled: "Paid",
  refused: "Refused",
  void: "Withdrawn",
};

/** The movements of the recovery money, in the words staff read. */
export const RECOVERY_MOVEMENT_LABELS: Record<string, string> = {
  clawback: "Taken back from the vendor",
  advance: "Advanced to the host",
};

/**
 * F-109: how many staff must approve a recovery action before it may settle.
 * The large-amount threshold is not approved, so every manual fund action needs two
 * (blueprint/architecture.md:232).
 */
export const REQUIRED_RECOVERY_APPROVALS = 2;

// ---------------------------------------------------------------------------
// What a person may type
// ---------------------------------------------------------------------------

/** The split the database is asked for. The browser never computes it. */
export const splitRequestSchema = z.object({
  total_minor: z
    .number()
    .int("Enter the amount in the currency's minor unit.")
    .positive("Enter an amount above zero."),
  currency: z
    .string()
    .trim()
    .regex(/^[A-Za-z]{3}$/, "Use a three-letter currency code."),
});
export type SplitRequest = z.infer<typeof splitRequestSchema>;

/** The booking whose last tranche is waiting. */
export const releaseRequestSchema = z.object({
  booking_id: z.string().uuid("That booking link is not valid."),
});
export type ReleaseRequest = z.infer<typeof releaseRequestSchema>;

/** The recovery request a decision or a settlement is about. */
export const actionRequestSchema = z.object({
  action_id: z.string().uuid("That request link is not valid."),
});
export type ActionRequest = z.infer<typeof actionRequestSchema>;

/**
 * A recovery request. A clawback names the amount to take back; an advance names the cost of the
 * replacement, and the platform advances half of it (blueprint/prd.md:102).
 */
export const recoveryRequestSchema = z
  .object({
    kind: z.enum(["clawback", "advance"]),
    case_id: z.string().uuid("That case link is not valid."),
    amount_minor: z
      .number()
      .int("Enter the amount in the currency's minor unit.")
      .positive()
      .optional(),
    replacement_cost_minor: z
      .number()
      .int("Enter the replacement cost in the currency's minor unit.")
      .positive()
      .optional(),
    reason: z
      .string()
      .trim()
      .min(3, "Say why this money should move.")
      .max(200, "Keep the reason short."),
  })
  .superRefine((value, ctx) => {
    if (value.kind === "clawback" && !value.amount_minor) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["amount_minor"],
        message: "Enter the amount to take back from the vendor.",
      });
    }
    if (value.kind === "advance" && !value.replacement_cost_minor) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["replacement_cost_minor"],
        message: "Enter what the replacement booking costs.",
      });
    }
  });
export type RecoveryRequest = z.infer<typeof recoveryRequestSchema>;

/**
 * One decision about a recovery request. Two staff must approve it before it may settle, and the
 * person who asked for it may not be one of them.
 */
export const recoveryDecisionSchema = z.object({
  action_id: z.string().uuid("That request link is not valid."),
  decision: z.enum(["approved", "refused", "void"]),
  note: z.string().trim().max(200, "Keep the note short.").optional(),
  reason: z.string().trim().min(3, "Say why this request is withdrawn.").max(200).optional(),
});
export type RecoveryDecision = z.infer<typeof recoveryDecisionSchema>;

// ---------------------------------------------------------------------------
// The refusals
// ---------------------------------------------------------------------------

/** How the recovery fund can refuse. The browser turns each into a sentence. */
export type FundsErrorCode =
  "forbidden" | "not_found" | "validation" | "unauthorized" | "unconfigured" | "unknown";

/**
 * The database names its refusals; a person needs a sentence. The names carry no money and no
 * personal detail, so this map is the whole of what a refusal tells the browser.
 */
export const FUNDS_REFUSAL_COPY: Record<string, string> = {
  invalid_total: "That amount cannot be split.",
  invalid_currency: "That currency cannot be used.",
  invalid_amount: "That amount cannot be taken back.",
  invalid_replacement_cost: "That replacement cost cannot be used.",
  advance_too_small: "That replacement cost is too small for an advance.",
  nothing_to_recover: "There is nothing left to take back from this vendor.",
  insufficient_recovery_funds:
    "The recovery fund cannot cover this, so it has gone to the people who decide.",
  reason_required: "Say why this money should move.",
  reason_rejected: "That reason cannot be recorded.",
  fund_wallet_required: "The recovery fund has no wallet in this environment yet.",
  fund_wallet_rejected: "The recovery fund wallet cannot be recorded.",
  case_not_found: "We could not find that case.",
  case_closed: "That case is closed.",
  case_has_no_booking: "That case has no booking, so there is no money to move.",
  booking_not_found: "We could not find that booking.",
  fund_pool_not_found: "We could not find that booking's fund.",
  recovery_action_not_found: "We could not find that recovery request.",
  recovery_action_not_approved: "Two staff have not approved this yet.",
  recovery_action_closed: "That request is closed.",
  unknown_decision: "That decision is not one we record.",
  note_too_long: "Keep the note short.",
  note_rejected: "That note cannot be recorded.",
  payment_reference_required: "That payment reference is not valid.",
  payment_reference_rejected: "That payment reference is not valid.",
  nothing_paid: "This booking has not been paid yet.",
  first_tranche_not_released: "The first release has not happened yet.",
  fund_pool_frozen: "This money is on hold while a dispute is open.",
};

/** The refusal the database named, read as a code. */
export function classifyFundsError(refusal: string): FundsErrorCode {
  const text = (refusal ?? "").toLowerCase();
  if (text.includes("forbidden") || text.includes("permission denied")) return "forbidden";
  if (text.includes("not_found")) return "not_found";
  if (text.includes("not_configured") || text.includes("unconfigured")) return "unconfigured";
  const named = Object.keys(FUNDS_REFUSAL_COPY).find((name) => text.includes(name));
  return named ? "validation" : "unknown";
}

/** The sentence for a refusal the database named, or null when it named something we do not know. */
export function refusalCopyFor(refusal: string): string | null {
  const text = (refusal ?? "").toLowerCase();
  const named = Object.keys(FUNDS_REFUSAL_COPY).find((name) => text.includes(name));
  return named ? (FUNDS_REFUSAL_COPY[named] ?? null) : null;
}
