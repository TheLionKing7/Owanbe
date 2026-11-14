/**
 * F-107 browser boundary for the OwanbeAI console.
 *
 * The browser talks to the app's own routes; a route forwards the caller's token to the
 * database, which decides whether they may read the queue or work a case. The browser never
 * decides that for itself.
 */
import type { AiAnswer, AiCase, AiCaseStatus } from "./console-contracts";

export type AiConsoleErrorCode =
  "forbidden" | "not_found" | "validation" | "unauthorized" | "unconfigured" | "unknown";

export class AiConsoleError extends Error {
  constructor(
    readonly code: AiConsoleErrorCode,
    message: string,
    readonly retryable = false,
  ) {
    super(message);
    this.name = "AiConsoleError";
  }
}

export const AI_CONSOLE_ERROR_COPY: Record<AiConsoleErrorCode, string> = {
  forbidden: "The OwanbeAI case queue is for platform staff who hold the AI investigation grant.",
  not_found: "We could not find that case.",
  validation: "Check the details and try again.",
  unauthorized: "Sign in to open the console.",
  unconfigured: "Sign-in is not configured in this environment, so the console stays locked.",
  unknown: "Something went wrong. Try again in a moment.",
};

const ERROR_CODES: readonly AiConsoleErrorCode[] = [
  "forbidden",
  "not_found",
  "validation",
  "unauthorized",
  "unconfigured",
  "unknown",
];

/** Validation carries the field's own words; every other refusal is explained from the copy map. */
export function aiConsoleErrorMessage(error: unknown): string {
  if (error instanceof AiConsoleError) {
    return error.code === "validation" ? error.message : AI_CONSOLE_ERROR_COPY[error.code];
  }
  return AI_CONSOLE_ERROR_COPY.unknown;
}

function readError(body: unknown): AiConsoleError {
  const payload = body as { error?: unknown; message?: unknown; retryable?: unknown } | null;
  const code = ERROR_CODES.find((candidate) => candidate === payload?.error) ?? "unknown";
  return new AiConsoleError(
    code,
    typeof payload?.message === "string" ? payload.message : "request_failed",
    payload?.retryable === true,
  );
}

function readText(record: Record<string, unknown>, key: string): string {
  const value = record[key];
  return typeof value === "string" ? value : "";
}

function readOptionalText(record: Record<string, unknown>, key: string): string | null {
  const value = record[key];
  if (value === null || value === undefined) return null;
  const read = String(value);
  return read ? read : null;
}

function readNotes(value: unknown): AiCase["notes"] {
  const rows = Array.isArray(value) ? value : [];
  return rows
    .map((row) => {
      const record = (row ?? {}) as Record<string, unknown>;
      const id = readText(record, "id");
      const body = readText(record, "body");
      if (!id || !body) return null;
      return {
        id,
        author: readText(record, "author"),
        body,
        at: readText(record, "at"),
      };
    })
    .filter((note): note is AiCase["notes"][number] => note !== null);
}

function readCase(row: unknown): AiCase | null {
  const record = (row ?? {}) as Record<string, unknown>;
  const caseId = readText(record, "case_id");
  if (!caseId) return null;
  return {
    case_id: caseId,
    case_reference: readText(record, "case_reference"),
    subject: readText(record, "subject"),
    reason: readText(record, "reason"),
    status: readText(record, "status") as AiCaseStatus,
    priority: readText(record, "priority"),
    source: readText(record, "source"),
    opened_by: readOptionalText(record, "opened_by"),
    ai_interaction_id: readOptionalText(record, "ai_interaction_id"),
    booking_id: readOptionalText(record, "booking_id"),
    created_at: readText(record, "created_at"),
    updated_at: readText(record, "updated_at"),
    notes: readNotes(record["notes"]),
  };
}

function readAnswer(row: unknown): AiAnswer | null {
  const record = (row ?? {}) as Record<string, unknown>;
  const interactionId = readText(record, "interaction_id");
  if (!interactionId) return null;
  return {
    interaction_id: interactionId,
    created_at: readText(record, "created_at"),
    surface: readText(record, "surface"),
    request_summary: readText(record, "request_summary"),
    response_text: readText(record, "response_text"),
    reason: readOptionalText(record, "reason"),
    outcome: readText(record, "outcome"),
    model: readText(record, "model"),
    booking_id: readOptionalText(record, "booking_id"),
    case_id: readOptionalText(record, "case_id"),
    case_reference: readText(record, "case_reference"),
    reported_at: readOptionalText(record, "reported_at"),
    report_category: readOptionalText(record, "report_category"),
  };
}

export interface AiConsoleApi {
  /** The queue of cases. A status narrows it; the database still decides who may look. */
  cases(status?: AiCaseStatus | null): Promise<AiCase[]>;
  /** Every answer OwanbeAI gave. */
  answers(surface?: string | null): Promise<AiAnswer[]>;
  /** The answers OwanbeAI gave the caller. */
  mine(): Promise<AiAnswer[]>;
  /** Working a case: the status it moves to and the note about why. */
  updateCase(input: {
    case_id: string;
    status: AiCaseStatus;
    note?: string | undefined;
  }): Promise<void>;
}

async function readList(
  url: string,
  token: string | null,
  key: "cases" | "answers",
): Promise<unknown[]> {
  if (!token) throw new AiConsoleError("unauthorized", "no_token");
  let res: Response;
  try {
    res = await fetch(url, { method: "GET", headers: { Authorization: `Bearer ${token}` } });
  } catch {
    throw new AiConsoleError("unknown", `${key}_request_failed`);
  }
  const body = (await res.json().catch(() => null)) as Record<string, unknown> | null;
  if (!res.ok) throw readError(body);
  const rows = body?.[key];
  return Array.isArray(rows) ? rows : [];
}

/** GET /api/ai/cases. */
export async function fetchAiCases(
  accessToken: string | null,
  status?: AiCaseStatus | null,
): Promise<AiCase[]> {
  const query = status ? `?status=${encodeURIComponent(status)}` : "";
  const rows = await readList(`/api/ai/cases${query}`, accessToken, "cases");
  return rows.map(readCase).filter((item): item is AiCase => item !== null);
}

/** GET /api/ai/answers. */
export async function fetchAiAnswers(
  accessToken: string | null,
  surface?: string | null,
): Promise<AiAnswer[]> {
  const query = surface ? `?surface=${encodeURIComponent(surface)}` : "";
  const rows = await readList(`/api/ai/answers${query}`, accessToken, "answers");
  return rows.map(readAnswer).filter((item): item is AiAnswer => item !== null);
}

/** GET /api/ai/mine. */
export async function fetchMyAiAnswers(accessToken: string | null): Promise<AiAnswer[]> {
  const rows = await readList("/api/ai/mine", accessToken, "answers");
  return rows.map(readAnswer).filter((item): item is AiAnswer => item !== null);
}

/** POST /api/ai/case. */
export async function updateAiCase(
  accessToken: string | null,
  input: { case_id: string; status: AiCaseStatus; note?: string | undefined },
): Promise<void> {
  if (!accessToken) throw new AiConsoleError("unauthorized", "no_token");
  let res: Response;
  try {
    res = await fetch("/api/ai/case", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
      body: JSON.stringify({
        case_id: input.case_id,
        status: input.status,
        note: input.note ?? null,
      }),
    });
  } catch {
    throw new AiConsoleError("unknown", "case_request_failed");
  }
  const body = (await res.json().catch(() => null)) as unknown;
  if (!res.ok) throw readError(body);
}

/** The token reader is injected so the console can be rendered in tests without an auth provider. */
export function createAiConsoleApi(getAccessToken: () => Promise<string | null>): AiConsoleApi {
  return {
    cases: async (status) => fetchAiCases(await getAccessToken(), status),
    answers: async (surface) => fetchAiAnswers(await getAccessToken(), surface),
    mine: async () => fetchMyAiAnswers(await getAccessToken()),
    updateCase: async (input) => updateAiCase(await getAccessToken(), input),
  };
}
