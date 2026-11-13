/**
 * F-107 OwanbeAI console: what a case and an answer look like, and the moves a case may make.
 *
 * The database decides what a case may do. The table below is the same rule the database
 * applies, kept here so the console can offer the moves that will be accepted instead of a
 * menu the server will refuse; it is never the authority. A move the console offers and the
 * database rejects is a disagreement, and the database is right.
 */
import { z } from "zod";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const AI_CASE_STATUSES = [
  "open",
  "investigating",
  "waiting_on_customer",
  "resolved",
  "closed",
] as const;
export type AiCaseStatus = (typeof AI_CASE_STATUSES)[number];

/** The statuses a case may be moved to. A case does not move back to 'open'. */
export const AI_CASE_TARGET_STATUSES = [
  "investigating",
  "waiting_on_customer",
  "resolved",
  "closed",
] as const;
export type AiCaseTargetStatus = (typeof AI_CASE_TARGET_STATUSES)[number];

export const AI_CASE_STATUS_LABEL: Record<AiCaseStatus, string> = {
  open: "Open",
  investigating: "Being looked at",
  waiting_on_customer: "Waiting on the customer",
  resolved: "Resolved",
  closed: "Closed",
};

/** The moves each status allows. The database applies the same rule. */
export const AI_CASE_MOVES: Record<AiCaseStatus, AiCaseStatus[]> = {
  open: ["investigating", "waiting_on_customer", "resolved", "closed"],
  investigating: ["waiting_on_customer", "resolved", "closed"],
  waiting_on_customer: ["investigating", "resolved", "closed"],
  resolved: ["investigating", "closed"],
  closed: [],
};

/** The urgency the case was opened with. */
export const AI_CASE_PRIORITY_LABEL: Record<string, string> = {
  low: "Low",
  normal: "Normal",
  high: "High",
  urgent: "Urgent",
};

/** One note a staff member left on a case. */
export interface AiCaseNote {
  id: string;
  author: string;
  body: string;
  at: string;
}

/** One case OwanbeAI opened, or that a person raised. */
export interface AiCase {
  case_id: string;
  case_reference: string;
  subject: string;
  reason: string;
  status: AiCaseStatus;
  priority: string;
  source: string;
  opened_by: string | null;
  ai_interaction_id: string | null;
  booking_id: string | null;
  created_at: string;
  updated_at: string;
  notes: AiCaseNote[];
}

/** One answer OwanbeAI gave, whoever asked for it. */
export interface AiAnswer {
  interaction_id: string;
  created_at: string;
  surface: string;
  request_summary: string;
  response_text: string;
  reason: string | null;
  outcome: string;
  model: string;
  booking_id: string | null;
  case_id: string | null;
  case_reference: string;
  reported_at: string | null;
  report_category: string | null;
}

/** What the console says about itself, on every surface that shows it. */
export const AI_CONSOLE_DISCLOSURE =
  "OwanbeAI's own records. Working a case changes the case and nothing else: no payment, no hold and no booking is touched.";

/** The sentence shown to a caller who may not use the console. */
export const AI_CONSOLE_FORBIDDEN =
  "The OwanbeAI case queue is for platform staff who hold the AI investigation grant.";

/** The move a staff member makes on a case. */
export const aiCaseUpdateSchema = z.object({
  case_id: z.string().trim().regex(UUID, "That case is not valid."),
  status: z.enum(AI_CASE_TARGET_STATUSES, {
    message: "That is not a status a case can be moved to.",
  }),
  note: z.string().trim().max(1000, "A note cannot be longer than 1000 characters.").optional(),
});
export type AiCaseUpdate = z.infer<typeof aiCaseUpdateSchema>;
