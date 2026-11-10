/**
 * F-107 OwanbeAI: what every AI surface shares.
 *
 * An answer that came from a model is never presented as a person's advice. Every surface that
 * shows one carries a persistent label, and every answer can be reported. The report categories
 * live here so the platform counts what is reported across surfaces the same way.
 */
import { z } from "zod";

/**
 * The label each surface puts on its own output. A surface may word it as it likes, but the
 * reader always sees that the words came from a model.
 */
export const AI_DISCLOSURE = {
  planner: "AI-generated plan",
  vendorCopy: "AI-written draft",
  investigation: "AI investigation",
} as const;

/** The categories a person can report an AI answer under. The database holds the same list. */
export const REPORT_CATEGORIES = [
  "wrong_facts",
  "not_relevant",
  "missing_vendor",
  "price_or_availability",
  "harmful",
  "other",
] as const;

export type ReportCategory = (typeof REPORT_CATEGORIES)[number];

export const REPORT_CATEGORY_LABEL: Record<ReportCategory, string> = {
  wrong_facts: "The facts are wrong",
  not_relevant: "Not relevant to my celebration",
  missing_vendor: "A vendor was missing",
  price_or_availability: "Price or availability is wrong",
  harmful: "Something harmful or offensive",
  other: "Something else",
};

/** The report a person sends about an answer. The note is optional and never carries a secret. */
export const aiReportSchema = z.object({
  interaction_id: z
    .string()
    .trim()
    .regex(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
      "We could not find that answer.",
    ),
  category: z.enum(REPORT_CATEGORIES),
  note: z.string().trim().max(500).optional(),
});
export type AiReport = z.infer<typeof aiReportSchema>;

// ---------------------------------------------------------------------------
// The payment investigation
// ---------------------------------------------------------------------------
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const investigationRequestSchema = z.object({
  booking_id: z.string().trim().regex(UUID, "That booking link is not valid."),
  question: z.string().trim().max(500).optional(),
});
export type InvestigationRequest = z.infer<typeof investigationRequestSchema>;

/** What the investigation found. The AI never decides the outcome of a payment. */
export type InvestigationFinding = "no_issue" | "needs_human" | "case_opened";

export interface InvestigationResult {
  interaction_id: string;
  disclosure: string;
  summary: string;
  finding: InvestigationFinding;
  /** The case the AI opened for a person to look at. */
  case_id: string | null;
}
