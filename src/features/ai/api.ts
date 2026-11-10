/**
 * F-107 browser boundary for the shared AI surfaces.
 *
 * The browser talks to the app's own routes; a route forwards the caller's token to the
 * database, which decides whether the report may be logged.
 */
import type { InvestigationFinding, InvestigationResult, ReportCategory } from "./contracts";

export type AiErrorCode =
  | "forbidden"
  | "not_found"
  | "validation"
  | "unauthorized"
  | "rate_limited"
  | "unconfigured"
  | "locked"
  | "unknown";

export class AiError extends Error {
  constructor(
    readonly code: AiErrorCode,
    message: string,
    readonly retryable = false,
  ) {
    super(message);
    this.name = "AiError";
  }
}

export const AI_ERROR_COPY: Record<AiErrorCode, string> = {
  forbidden: "That answer is not yours to report.",
  not_found: "We could not find that answer.",
  validation: "Check the details and try again.",
  unauthorized: "Sign in to use this.",
  rate_limited: "Too many requests right now. Wait a moment and try again.",
  unconfigured: "Sign-in is not configured in this environment, so this stays locked.",
  locked: "OwanbeAI is closed until the platform's zero-data-retention agreement is confirmed.",
  unknown: "Something went wrong. Try again in a moment.",
};

const ERROR_CODES: readonly AiErrorCode[] = [
  "forbidden",
  "not_found",
  "validation",
  "unauthorized",
  "rate_limited",
  "unconfigured",
  "locked",
  "unknown",
];

/** Validation carries the field's own words; every other refusal is explained from the copy map. */
export function aiErrorMessage(error: unknown): string {
  if (error instanceof AiError) {
    return error.code === "validation" ? error.message : AI_ERROR_COPY[error.code];
  }
  return AI_ERROR_COPY.unknown;
}

function readError(body: unknown): AiError {
  const payload = body as { error?: unknown; message?: unknown; retryable?: unknown } | null;
  const code = ERROR_CODES.find((candidate) => candidate === payload?.error) ?? "unknown";
  return new AiError(
    code,
    typeof payload?.message === "string" ? payload.message : "request_failed",
    payload?.retryable === true,
  );
}

export interface AiReportApi {
  report(interactionId: string, category: ReportCategory, note?: string): Promise<void>;
}

/** Why OwanbeAI may not be shown: the caller has no grant, or the contract is still unconfirmed. */
export type AiUnavailableReason = "no_grant" | "zdr_pending";

export interface AiStatus {
  available: boolean;
  reason: AiUnavailableReason | null;
}

export interface AiApi extends AiReportApi {
  status(): Promise<AiStatus>;
  investigate(bookingId: string, question?: string): Promise<InvestigationResult>;
}

/** GET /api/ai/status. */
export async function fetchAiStatus(accessToken: string | null): Promise<AiStatus> {
  if (!accessToken) throw new AiError("unauthorized", "no_token");
  let res: Response;
  try {
    res = await fetch("/api/ai/status", {
      method: "GET",
      headers: { Authorization: `Bearer ${accessToken}` },
    });
  } catch {
    throw new AiError("unknown", "status_request_failed");
  }
  const body = (await res.json().catch(() => null)) as {
    available?: unknown;
    reason?: unknown;
  } | null;
  if (!res.ok) throw readError(body);
  const reason = body?.reason;
  return {
    available: body?.available === true,
    reason: reason === "no_grant" || reason === "zdr_pending" ? reason : null,
  };
}

/** POST /api/ai/investigate. */
export async function investigatePayment(
  bookingId: string,
  accessToken: string | null,
  question?: string,
): Promise<InvestigationResult> {
  if (!accessToken) throw new AiError("unauthorized", "no_token");
  let res: Response;
  try {
    res = await fetch("/api/ai/investigate", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
      body: JSON.stringify({ booking_id: bookingId, question: question ?? null }),
    });
  } catch {
    throw new AiError("unknown", "investigate_request_failed");
  }
  const body = (await res.json().catch(() => null)) as Partial<InvestigationResult> | null;
  if (!res.ok) throw readError(body);
  if (!body || typeof body.interaction_id !== "string" || typeof body.summary !== "string") {
    throw new AiError("unknown", "invalid_investigation_response");
  }
  const finding = body.finding;
  return {
    interaction_id: body.interaction_id,
    disclosure: typeof body.disclosure === "string" ? body.disclosure : "AI investigation",
    summary: body.summary,
    finding:
      finding === "no_issue" || finding === "needs_human" || finding === "case_opened"
        ? finding
        : "needs_human",
    case_id: typeof body.case_id === "string" ? body.case_id : null,
  };
}

/** POST /api/ai/report. */
export async function reportAiInteraction(
  interactionId: string,
  category: ReportCategory,
  accessToken: string | null,
  note?: string,
): Promise<void> {
  if (!accessToken) throw new AiError("unauthorized", "no_token");
  let res: Response;
  try {
    res = await fetch("/api/ai/report", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
      body: JSON.stringify({ interaction_id: interactionId, category, note: note ?? null }),
    });
  } catch {
    throw new AiError("unknown", "report_request_failed");
  }
  const body = (await res.json().catch(() => null)) as unknown;
  if (!res.ok) throw readError(body);
}

/** The token reader is injected so a surface can be rendered in tests without an auth provider. */
export function createAiReportApi(getAccessToken: () => Promise<string | null>): AiReportApi {
  return {
    report: async (interactionId, category, note) =>
      reportAiInteraction(interactionId, category, await getAccessToken(), note),
  };
}

/** The token reader is injected so the panel can be rendered in tests without an auth provider. */
export function createAiApi(getAccessToken: () => Promise<string | null>): AiApi {
  return {
    report: async (interactionId, category, note) =>
      reportAiInteraction(interactionId, category, await getAccessToken(), note),
    status: async () => fetchAiStatus(await getAccessToken()),
    investigate: async (bookingId, question) =>
      investigatePayment(bookingId, await getAccessToken(), question),
  };
}
