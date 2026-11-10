/**
 * F-107: what OwanbeAI is allowed to see, and what it is asked to say.
 *
 * The investigation reads a payment trail that has already been minimised by the database: money,
 * states, timestamps and provider event types. There is no party name, no email address, no
 * provider reference and no payload in it, and none of it is added here.
 *
 * The model is an investigator, never an authority. It cannot move money, and the answer it gives
 * can only be a statement or a case for a person to look at.
 */
import { z } from "zod";

export const INVESTIGATION_SYSTEM = `You are OwanbeAI, a payment investigation assistant for Ówàńbè, a marketplace for Yoruba and Nigerian celebrations.

You are given the payment trail of one booking: amounts, states, timestamps and provider event types. There are no party names, no email addresses, no provider references and no card details in it, and you must not ask for them or guess at them.

Rules:
- Answer only from the trail you are given. Never invent a number, a date, a reference or a cause.
- You are a read-only investigator. You cannot move money, refund, release, freeze or complete anything, and you must never claim that you did.
- If the trail shows nothing wrong, say so plainly and set finding to "no_issue".
- If something looks wrong but a person has to decide what to do about it, set finding to "needs_human" and say what that person must check.
- If the trail shows something that must be looked at as a case, set finding to "case_opened", give a short subject and a plain-language reason, and choose a priority.
- Amounts are integer minor units in the currency given. Never convert between currencies.
- Keep the summary under 200 words. Write in clear British English.`;

/** The shape the model is asked for. Nothing here is trusted until it has been checked. */
export const investigationSchema = z.object({
  summary: z.string(),
  finding: z.enum(["no_issue", "needs_human", "case_opened"]),
  subject: z.string().default(""),
  reason: z.string().default(""),
  priority: z.enum(["low", "normal", "high", "urgent"]).default("normal"),
});
export type InvestigationAnswer = z.infer<typeof investigationSchema>;

/** One row of the minimised payment log. */
export interface PaymentLogRow {
  booking_id: string;
  booking_status: string;
  pool_status: string;
  currency: string;
  total_minor: number;
  paid_minor: number;
  held_minor: number;
  released_minor: number;
  refunded_minor: number;
  frozen: boolean;
  release_30_due_at: string | null;
  paid_at: string | null;
  completed_at: string | null;
  refunded_at: string | null;
  movement_count: number;
  event_count: number;
  failed_event_count: number;
  hours_since_paid: number | null;
}

/** One provider event for the booking. The payload and the reference are not returned. */
export interface PaymentEventRow {
  event_id: string;
  event_type: string;
  outcome: string;
  amount_minor: number | null;
  currency: string;
  occurred_at: string;
}

function or(value: string | null | undefined, fallback: string): string {
  const text = (value ?? "").trim();
  return text ? text : fallback;
}

/**
 * The trail, as the model reads it. Amounts stay in minor units with the currency beside them, so
 * no amount is ever rounded or rewritten on the way to the model.
 */
export function buildInvestigationPrompt(
  log: PaymentLogRow,
  events: PaymentEventRow[],
  question: string | undefined,
): string {
  const money = [
    `total ${log.total_minor}`,
    `paid ${log.paid_minor}`,
    `held ${log.held_minor}`,
    `released ${log.released_minor}`,
    `refunded ${log.refunded_minor}`,
  ].join(", ");

  const lines = [
    `The booking's money, in minor units of ${or(log.currency, "unknown currency")}:`,
    `booking status: ${or(log.booking_status, "unknown")}`,
    `pool status: ${or(log.pool_status, "none")}`,
    `${money}`,
    `frozen: ${log.frozen ? "yes" : "no"}`,
    `paid at: ${or(log.paid_at, "never")}`,
    `the last payment is released due at: ${or(log.release_30_due_at, "not set")}`,
    `completed at: ${or(log.completed_at, "not completed")}`,
    `refunded at: ${or(log.refunded_at, "not refunded")}`,
    `ledger movements: ${log.movement_count}`,
    `provider events: ${log.event_count}, of which failed: ${log.failed_event_count}`,
    `hours since the payment: ${log.hours_since_paid === null ? "not paid" : log.hours_since_paid}`,
  ];

  if (events.length > 0) {
    lines.push("", "The provider's events, newest first:");
    for (const event of events) {
      const amount = event.amount_minor === null ? "" : ` ${event.amount_minor}`;
      const currency = event.currency ? ` ${event.currency}` : "";
      lines.push(
        `- ${event.occurred_at} ${event.event_type}${outcomeSuffix(event.outcome)} amount${amount}${currency}`,
      );
    }
  } else {
    lines.push("", "The provider has recorded no event for this booking.");
  }

  const asked = (question ?? "").trim();
  if (asked) {
    lines.push("", "The staff member's question:", asked);
  }

  return lines.join("\n");
}

function outcomeSuffix(outcome: string): string {
  const text = (outcome ?? "").trim();
  return text ? ` (${text})` : "";
}
