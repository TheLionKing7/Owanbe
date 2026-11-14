/**
 * F-107 server-only boundary for the shared AI surfaces.
 *
 * Every read and every rule about who may do what runs as the caller: the caller's own token is
 * forwarded to the database, which decides. The service-role path is used nowhere here.
 *
 * The payment investigation is read-only. The caller may look at a payment trail and may open a
 * case; there is no path from this file to the ledger, and the SQL suite proves the grant the AI
 * holds carries no money authority at all.
 */
import {
  AI_DISCLOSURE,
  aiReportSchema,
  investigationRequestSchema,
  type InvestigationFinding,
  type InvestigationResult,
} from "./contracts";
import {
  INVESTIGATION_SYSTEM,
  buildInvestigationPrompt,
  investigationSchema,
  type PaymentEventRow,
  type PaymentLogRow,
} from "./investigation";
import { generateStructured, type AiFailure } from "@/lib/ai/provider.server";
import { callAsCaller, callerToken } from "@/lib/db/caller.server";

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

const UNCONFIGURED = {
  error: "unconfigured",
  message: "Sign-in is not configured in this environment, so this stays locked.",
};

const ZDR_LOCKED =
  "OwanbeAI is closed until the platform's zero-data-retention agreement with the model provider is confirmed.";

const GRANT_REQUIRED = "OwanbeAI is limited to staff who hold the AI investigation grant.";

interface FailureCopy {
  forbidden: string;
  notFound: string;
  validation: string;
  unauthorized: string;
}

/** The database's own refusal, turned into what the browser is told. Raw text is not returned. */
async function failure(res: Response, copy: FailureCopy): Promise<Response> {
  let code = "";
  let message = "";
  try {
    const body = (await res.json()) as { code?: unknown; message?: unknown };
    code = String(body.code ?? "");
    message = String(body.message ?? "");
  } catch {
    code = "";
  }
  if (code === "42501") {
    return json({ error: "forbidden", message: copy.forbidden }, 403);
  }
  if (code === "P0002") {
    return json({ error: "not_found", message: copy.notFound }, 404);
  }
  if (code === "22023" && message.includes("zdr_contract_required")) {
    return json({ error: "locked", message: ZDR_LOCKED }, 503);
  }
  if (code === "22023" && message.includes("already_reported")) {
    return json({ error: "validation", message: "That answer has already been reported." }, 400);
  }
  if (code === "22023") {
    return json({ error: "validation", message: copy.validation }, 400);
  }
  if (code === "28000") {
    return json({ error: "unauthorized", message: copy.unauthorized }, 401);
  }
  console.error("ai rpc failed", res.status, code);
  return json({ error: "unknown", message: "Something went wrong. Try again in a moment." }, 502);
}

const REPORT_COPY: FailureCopy = {
  forbidden: "That answer is not yours to report.",
  notFound: "We could not find that answer.",
  validation: "Choose what was wrong with the answer.",
  unauthorized: "Sign in to report an answer.",
};

const INVESTIGATION_COPY: FailureCopy = {
  forbidden: GRANT_REQUIRED,
  notFound: "We could not find that booking.",
  validation: "Check the details and try again.",
  unauthorized: "Sign in to investigate a payment.",
};

// ---------------------------------------------------------------------------
// POST /api/ai/report — the person who was shown an answer reports it
// ---------------------------------------------------------------------------
/**
 * One report per answer: the database refuses a second one rather than merging it.
 */
export async function reportInteractionAsCaller(request: Request): Promise<Response> {
  const token = callerToken(request);
  if (!token) {
    return json({ error: "unauthorized", message: "Sign in to report an answer." }, 401);
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return json({ error: "validation", message: "Choose what was wrong with the answer." }, 400);
  }
  const parsed = aiReportSchema.safeParse(body);
  if (!parsed.success) {
    return json(
      {
        error: "validation",
        message: parsed.error.issues[0]?.message ?? "Choose what was wrong with the answer.",
      },
      400,
    );
  }

  let res: Response;
  try {
    res = await callAsCaller("report_ai_interaction", token, {
      p_interaction: parsed.data.interaction_id,
      p_category: parsed.data.category,
      p_note: parsed.data.note ?? null,
    });
  } catch {
    return json(UNCONFIGURED, 503);
  }
  if (!res.ok) return failure(res, REPORT_COPY);
  return json({ interaction_id: parsed.data.interaction_id, category: parsed.data.category }, 200);
}

// ---------------------------------------------------------------------------
// GET /api/ai/status — may this caller see OwanbeAI at all
// ---------------------------------------------------------------------------
interface InvestigationStatus {
  zdr_confirmed: boolean;
  has_grant: boolean;
  can_investigate: boolean;
}

/**
 * The panel asks this before it shows itself. The answer is about the caller and the platform's
 * own configuration; it says nothing about a booking.
 */
export async function aiStatusAsCaller(request: Request): Promise<Response> {
  const token = callerToken(request);
  if (!token) {
    return json({ error: "unauthorized", message: "Sign in to use OwanbeAI." }, 401);
  }

  let res: Response;
  try {
    res = await callAsCaller("ai_investigation_status", token, {});
  } catch {
    return json(UNCONFIGURED, 503);
  }
  if (!res.ok) {
    console.error("ai status failed", res.status);
    return json({ error: "unknown", message: "Something went wrong. Try again in a moment." }, 502);
  }

  const rows = (await res.json()) as InvestigationStatus[];
  const status = rows[0];
  const hasGrant = status?.has_grant === true;
  const canInvestigate = status?.can_investigate === true;

  return json(
    {
      available: canInvestigate,
      reason: canInvestigate ? null : hasGrant ? "zdr_pending" : "no_grant",
    },
    200,
  );
}

// ---------------------------------------------------------------------------
// POST /api/ai/investigate — OwanbeAI reads a payment trail
// ---------------------------------------------------------------------------
/** Why the payment trail is being read. The database keeps this against every sensitive read. */
const INVESTIGATION_PURPOSE = "Tracing a payment trail for a support investigation";

function toPaymentLog(row: unknown): PaymentLogRow | null {
  const record = (row ?? {}) as Record<string, unknown>;
  if (typeof record["booking_id"] !== "string") return null;
  return {
    booking_id: record["booking_id"],
    booking_status: String(record["booking_status"] ?? ""),
    pool_status: String(record["pool_status"] ?? ""),
    currency: String(record["currency"] ?? ""),
    total_minor: Number(record["total_minor"] ?? 0),
    paid_minor: Number(record["paid_minor"] ?? 0),
    held_minor: Number(record["held_minor"] ?? 0),
    released_minor: Number(record["released_minor"] ?? 0),
    refunded_minor: Number(record["refunded_minor"] ?? 0),
    frozen: record["frozen"] === true,
    release_30_due_at: nullableText(record["release_30_due_at"]),
    paid_at: nullableText(record["paid_at"]),
    completed_at: nullableText(record["completed_at"]),
    refunded_at: nullableText(record["refunded_at"]),
    movement_count: Number(record["movement_count"] ?? 0),
    event_count: Number(record["event_count"] ?? 0),
    failed_event_count: Number(record["failed_event_count"] ?? 0),
    hours_since_paid:
      record["hours_since_paid"] === null || record["hours_since_paid"] === undefined
        ? null
        : Number(record["hours_since_paid"]),
  };
}

function toPaymentEvent(row: unknown): PaymentEventRow | null {
  const record = (row ?? {}) as Record<string, unknown>;
  if (typeof record["event_id"] !== "string") return null;
  return {
    event_id: record["event_id"],
    event_type: String(record["event_type"] ?? ""),
    outcome: String(record["outcome"] ?? ""),
    amount_minor:
      record["amount_minor"] === null || record["amount_minor"] === undefined
        ? null
        : Number(record["amount_minor"]),
    currency: String(record["currency"] ?? ""),
    occurred_at: String(record["occurred_at"] ?? ""),
  };
}

function nullableText(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const text = String(value);
  return text ? text : null;
}

/**
 * Whether the platform's zero-retention contract is confirmed.
 *
 * The row in app_private.ai_settings is the only truth about it, so the app reads it and never
 * assumes it: a request marked sensitive is refused unless the database says the contract is
 * confirmed. `null` means the answer could not be read, which is not the same as "no" and is
 * treated as a refusal.
 */
async function zdrConfirmedAsCaller(token: string): Promise<boolean | null> {
  try {
    const res = await callAsCaller("ai_investigation_status", token, {});
    if (!res.ok) return null;
    const rows = (await res.json()) as { zdr_confirmed?: unknown }[];
    return rows[0]?.zdr_confirmed === true;
  } catch {
    return null;
  }
}

/** The model's failure, said in OwanbeAI's own words. */
function investigationFailure(failure: AiFailure): Response {
  switch (failure.code) {
    case "unconfigured":
      return json(
        { error: "unconfigured", message: "OwanbeAI is not set up in this environment yet." },
        503,
      );
    case "zdr_required":
      return json({ error: "locked", message: ZDR_LOCKED }, 503);
    case "rate_limited":
      return json(
        {
          error: "rate_limited",
          message: "Too many requests right now. Wait a minute and try again.",
        },
        429,
      );
    case "credits":
      return json(
        {
          error: "unconfigured",
          message: "AI credits have run out. The workspace owner needs to top up.",
        },
        503,
      );
    case "unavailable":
      return json(
        { error: "unconfigured", message: "OwanbeAI is not available for this workspace." },
        503,
      );
    case "incomplete":
      return json(
        { error: "unknown", message: "The investigation came back incomplete. Please try again." },
        502,
      );
    default:
      return json(
        { error: "unknown", message: "Something went wrong. Try again in a moment." },
        502,
      );
  }
}

const FINDING_OUTCOME: Record<InvestigationFinding, string> = {
  no_issue: "no_issue",
  needs_human: "needs_human",
  case_opened: "opened_case",
};

/**
 * The case the AI asks for. The subject and the reason are the AI's own words, so the person who
 * picks the case up can see why it exists without reading the investigation again.
 */
function usableCase(answer: { subject: string; reason: string }): boolean {
  return answer.subject.trim().length >= 3 && answer.reason.trim().length >= 10;
}

export async function investigatePaymentAsCaller(request: Request): Promise<Response> {
  const token = callerToken(request);
  if (!token) {
    return json({ error: "unauthorized", message: "Sign in to investigate a payment." }, 401);
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return json({ error: "validation", message: "Check the details and try again." }, 400);
  }
  const parsed = investigationRequestSchema.safeParse(body);
  if (!parsed.success) {
    return json(
      {
        error: "validation",
        message: parsed.error.issues[0]?.message ?? "Check the details and try again.",
      },
      400,
    );
  }
  const bookingId = parsed.data.booking_id;
  const question = parsed.data.question?.trim() || undefined;

  // The contract is the database's to confirm. The app reads it rather than assuming it, so a
  // payment trail cannot reach a model on the strength of a constant in this file.
  const zdrConfirmed = await zdrConfirmedAsCaller(token);
  if (zdrConfirmed === null) {
    return json(UNCONFIGURED, 503);
  }
  if (!zdrConfirmed) {
    return json({ error: "locked", message: ZDR_LOCKED }, 503);
  }

  // The database holds the payment trail. It refuses the read unless the caller holds the grant
  // and the zero-retention contract is confirmed, so the trail never leaves for a model that has
  // not contracted to keep nothing.
  let logRes: Response;
  let eventRes: Response;
  try {
    [logRes, eventRes] = await Promise.all([
      callAsCaller("ai_payment_log", token, {
        p_booking: bookingId,
        p_purpose: INVESTIGATION_PURPOSE,
      }),
      callAsCaller("ai_payment_event_log", token, {
        p_booking: bookingId,
        p_purpose: INVESTIGATION_PURPOSE,
      }),
    ]);
  } catch {
    return json(UNCONFIGURED, 503);
  }
  if (!logRes.ok) return failure(logRes, INVESTIGATION_COPY);
  if (!eventRes.ok) return failure(eventRes, INVESTIGATION_COPY);

  const log = toPaymentLog(((await logRes.json()) as unknown[])[0]);
  if (!log) {
    return json({ error: "not_found", message: "We could not find that booking." }, 404);
  }
  const events = ((await eventRes.json()) as unknown[])
    .map(toPaymentEvent)
    .filter((event): event is PaymentEventRow => event !== null);

  const outcome = await generateStructured({
    model: "investigation",
    system: INVESTIGATION_SYSTEM,
    prompt: buildInvestigationPrompt(log, events, question),
    schema: investigationSchema,
    sensitive: true,
    zdrConfirmed,
  });
  if (!outcome.ok) return investigationFailure(outcome.failure);

  const answer = outcome.value;
  const summary = answer.summary.trim().slice(0, 4000) || "The investigation returned no summary.";
  const finding: InvestigationFinding = usableCase(answer)
    ? answer.finding
    : answer.finding === "case_opened"
      ? "needs_human"
      : answer.finding;

  // The answer is logged against the caller, so it can be reported and so the case, if there is
  // one, points back at the investigation that found it.
  let interactionId = "";
  try {
    const logged = await callAsCaller("log_ai_interaction", token, {
      p_surface: "payment_investigation",
      p_request_summary: (question ?? "Investigate the payment trail for this booking").slice(
        0,
        500,
      ),
      p_response_text: summary,
      p_reason: null,
      p_model: outcome.model,
      p_outcome: FINDING_OUTCOME[finding],
      p_booking: bookingId,
    });
    if (!logged.ok) {
      console.error("ai interaction not logged", logged.status);
      return json(
        { error: "unknown", message: "Something went wrong. Try again in a moment." },
        502,
      );
    }
    const rows = (await logged.json()) as unknown;
    interactionId = typeof rows === "string" ? rows : String((rows as { id?: unknown })?.id ?? "");
  } catch {
    return json({ error: "unknown", message: "Something went wrong. Try again in a moment." }, 502);
  }

  let caseId: string | null = null;
  if (finding === "case_opened") {
    try {
      const opened = await callAsCaller("open_ai_case", token, {
        p_interaction: interactionId,
        p_subject: answer.subject.trim().slice(0, 200),
        p_reason: answer.reason.trim().slice(0, 1000),
        p_priority: answer.priority,
      });
      if (opened.ok) {
        const rows = (await opened.json()) as unknown;
        caseId = typeof rows === "string" ? rows : String((rows as { id?: unknown })?.id ?? "");
        if (!caseId) caseId = null;
      } else {
        console.error("ai case not opened", opened.status);
      }
    } catch (error) {
      console.error("ai case not opened", error instanceof Error ? error.message : "unknown");
    }
  }

  const result: InvestigationResult = {
    interaction_id: interactionId,
    disclosure: AI_DISCLOSURE.investigation,
    summary,
    finding: caseId ? "case_opened" : finding,
    case_id: caseId,
  };
  return json(result, 200);
}
