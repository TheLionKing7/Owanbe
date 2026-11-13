/**
 * F-107 server-only boundary for the OwanbeAI console.
 *
 * The caller's own token is forwarded to the database, so the database decides whether they may
 * read the case queue, read the answers or work a case: a staff member holding the
 * 'ai_investigation' capability. No secret key is read here, and there is no service-role path in
 * this file.
 *
 * The console moves no money. Working a case writes the case's status and a note, and the
 * database writes the audit row; nothing in this file reaches the ledger, a hold or a booking.
 */
import { callAsCaller, callerToken } from "@/lib/db/caller.server";
import {
  AI_CASE_STATUSES,
  aiCaseUpdateSchema,
  AI_CONSOLE_FORBIDDEN,
  type AiAnswer,
  type AiCase,
  type AiCaseStatus,
} from "./console-contracts";

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

const UNCONFIGURED = {
  error: "unconfigured",
  message: "Sign-in is not configured in this environment, so the console stays locked.",
};

/** The refusals the console may show, in the words of the console. */
const CASE_REFUSALS: Record<string, string> = {
  invalid_case_status: "That is not a status a case can hold.",
  invalid_case_transition: "A case cannot go from where it is to where you asked.",
  invalid_case_note: "The note cannot be empty and cannot be longer than 1000 characters.",
  case_note_no_credentials: "That note looks like it carries a card number. Take it out.",
  invalid_case_subject: "That case cannot be described that way.",
  invalid_case_reason: "That case cannot be described that way.",
};

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
  if (code === "42501") {
    return json({ error: "forbidden", message: AI_CONSOLE_FORBIDDEN }, 403);
  }
  if (code === "28000") {
    return json({ error: "unauthorized", message: "Sign in to open the console." }, 401);
  }
  if (code === "P0002") {
    return json({ error: "not_found", message: "We could not find that case." }, 404);
  }
  if (code === "22023") {
    const known = Object.keys(CASE_REFUSALS).find((fragment) => message.includes(fragment));
    return json(
      {
        error: "validation",
        message: known ? CASE_REFUSALS[known] : "That change could not be made.",
      },
      400,
    );
  }
  console.error("ai console rpc failed", res.status, code);
  return json({ error: "unknown", message: "Something went wrong. Try again in a moment." }, 502);
}

function text(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function optionalText(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const read = String(value);
  return read ? read : null;
}

function notes(value: unknown): AiCase["notes"] {
  const rows = Array.isArray(value) ? value : [];
  return rows
    .map((row) => {
      const record = (row ?? {}) as Record<string, unknown>;
      const id = text(record["id"]);
      const body = text(record["body"]);
      if (!id || !body) return null;
      return {
        id,
        author: text(record["author"]),
        body,
        at: text(record["at"]),
      };
    })
    .filter((note): note is AiCase["notes"][number] => note !== null);
}

function readStatus(value: unknown): AiCaseStatus {
  const found = AI_CASE_STATUSES.find((status) => status === value);
  return found ?? "open";
}

/** One case, as the database published it. */
function toCase(row: unknown): AiCase | null {
  const record = (row ?? {}) as Record<string, unknown>;
  const caseId = text(record["case_id"]);
  if (!caseId) return null;
  return {
    case_id: caseId,
    case_reference: text(record["case_reference"]),
    subject: text(record["subject"]),
    reason: text(record["reason"]),
    status: readStatus(record["status"]),
    priority: text(record["priority"]),
    source: text(record["source"]),
    opened_by: optionalText(record["opened_by"]),
    ai_interaction_id: optionalText(record["ai_interaction_id"]),
    booking_id: optionalText(record["booking_id"]),
    created_at: text(record["created_at"]),
    updated_at: text(record["updated_at"]),
    notes: notes(record["notes"]),
  };
}

/** One answer, as the database published it. */
export function toAnswer(row: unknown): AiAnswer | null {
  const record = (row ?? {}) as Record<string, unknown>;
  const interactionId = text(record["interaction_id"]);
  if (!interactionId) return null;
  return {
    interaction_id: interactionId,
    created_at: text(record["created_at"]),
    surface: text(record["surface"]),
    request_summary: text(record["request_summary"]),
    response_text: text(record["response_text"]),
    reason: optionalText(record["reason"]),
    outcome: text(record["outcome"]),
    model: text(record["model"]),
    booking_id: optionalText(record["booking_id"]),
    case_id: optionalText(record["case_id"]),
    case_reference: text(record["case_reference"]),
    reported_at: optionalText(record["reported_at"]),
    report_category: optionalText(record["report_category"]),
  };
}

/**
 * GET /api/ai/cases — the queue of cases.
 *
 * The status filter is the caller's choice, but the grant is the database's: a caller without it
 * is refused here and the console says the queue is for staff.
 */
export async function readAiCasesAsCaller(request: Request): Promise<Response> {
  const token = callerToken(request);
  if (!token) {
    return json({ error: "unauthorized", message: "Sign in to open the console." }, 401);
  }
  const status = new URL(request.url).searchParams.get("status");

  let res: Response;
  try {
    res = await callAsCaller("read_ai_cases", token, { p_status: status || null });
  } catch {
    return json(UNCONFIGURED, 503);
  }
  if (!res.ok) return failure(res);

  const rows = (await res.json()) as unknown;
  const cases = (Array.isArray(rows) ? rows : [])
    .map(toCase)
    .filter((item): item is AiCase => item !== null);
  return json({ cases }, 200);
}

/** GET /api/ai/answers — every answer OwanbeAI gave. A sensitive read; the database audits it. */
export async function readAiAnswersAsCaller(request: Request): Promise<Response> {
  const token = callerToken(request);
  if (!token) {
    return json({ error: "unauthorized", message: "Sign in to open the console." }, 401);
  }
  const surface = new URL(request.url).searchParams.get("surface");

  let res: Response;
  try {
    res = await callAsCaller("read_ai_interactions", token, { p_surface: surface || null });
  } catch {
    return json(UNCONFIGURED, 503);
  }
  if (!res.ok) return failure(res);

  const rows = (await res.json()) as unknown;
  const answers = (Array.isArray(rows) ? rows : [])
    .map(toAnswer)
    .filter((item): item is AiAnswer => item !== null);
  return json({ answers }, 200);
}

/**
 * GET /api/ai/mine — the answers OwanbeAI gave the caller.
 *
 * This one is not a staff read: it is the caller's own answers, and the database returns only
 * rows the caller is the actor on.
 */
export async function readMyAiAnswersAsCaller(request: Request): Promise<Response> {
  const token = callerToken(request);
  if (!token) {
    return json({ error: "unauthorized", message: "Sign in to see your answers." }, 401);
  }

  let res: Response;
  try {
    res = await callAsCaller("my_ai_interactions", token, {});
  } catch {
    return json(UNCONFIGURED, 503);
  }
  if (!res.ok) return failure(res);

  const rows = (await res.json()) as unknown;
  const answers = (Array.isArray(rows) ? rows : [])
    .map(toAnswer)
    .filter((item): item is AiAnswer => item !== null);
  return json({ answers }, 200);
}

/** POST /api/ai/case — working a case: the status it moves to, and a note about why. */
export async function updateAiCaseAsCaller(request: Request): Promise<Response> {
  const token = callerToken(request);
  if (!token) {
    return json({ error: "unauthorized", message: "Sign in to work a case." }, 401);
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return json({ error: "validation", message: "Check the details and try again." }, 400);
  }
  const parsed = aiCaseUpdateSchema.safeParse(body);
  if (!parsed.success) {
    return json(
      {
        error: "validation",
        message: parsed.error.issues[0]?.message ?? "Check the details and try again.",
      },
      400,
    );
  }

  let res: Response;
  try {
    res = await callAsCaller("update_ai_case", token, {
      p_case: parsed.data.case_id,
      p_status: parsed.data.status,
      p_note: parsed.data.note ?? null,
    });
  } catch {
    return json(UNCONFIGURED, 503);
  }
  if (!res.ok) return failure(res);

  return json({ case_id: parsed.data.case_id, status: parsed.data.status }, 200);
}
