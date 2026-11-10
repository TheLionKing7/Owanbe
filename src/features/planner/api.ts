/**
 * F-101 browser boundary. The browser talks to the app's own routes; the routes forward the
 * caller's token to the database, which decides what the host may do.
 */
import { PLANNER_DISCLOSURE, type GroundedPlan, type PlannerInput } from "./contracts";
import type { ReportCategory } from "@/features/ai/contracts";

export type PlannerErrorCode =
  | "forbidden"
  | "not_found"
  | "validation"
  | "unauthorized"
  | "rate_limited"
  | "unconfigured"
  | "unknown";

export class PlannerError extends Error {
  constructor(
    readonly code: PlannerErrorCode,
    message: string,
    readonly retryable = false,
  ) {
    super(message);
    this.name = "PlannerError";
  }
}

export const PLANNER_ERROR_COPY: Record<PlannerErrorCode, string> = {
  forbidden: "The planner is a Host house tool, and you are not in one.",
  not_found: "We could not find that answer.",
  validation: "Check the details and try again.",
  unauthorized: "Sign in to use the planner.",
  rate_limited: "You asked the planner a moment ago. Give it a few seconds before asking again.",
  unconfigured: "Sign-in is not configured in this environment, so the planner stays locked.",
  unknown: "Something went wrong. Try again in a moment.",
};

const ERROR_CODES: readonly PlannerErrorCode[] = [
  "forbidden",
  "not_found",
  "validation",
  "unauthorized",
  "rate_limited",
  "unconfigured",
  "unknown",
];

/** Validation carries the field's own words; every other refusal is explained from the copy map. */
export function plannerErrorMessage(error: unknown): string {
  if (error instanceof PlannerError) {
    return error.code === "validation" ? error.message : PLANNER_ERROR_COPY[error.code];
  }
  return PLANNER_ERROR_COPY.unknown;
}

function readError(body: unknown): PlannerError {
  const payload = body as { error?: unknown; message?: unknown; retryable?: unknown } | null;
  const code = ERROR_CODES.find((candidate) => candidate === payload?.error) ?? "unknown";
  return new PlannerError(
    code,
    typeof payload?.message === "string" ? payload.message : "request_failed",
    payload?.retryable === true,
  );
}

export interface PlanResult {
  interaction_id: string;
  disclosure: string;
  plan: GroundedPlan;
  grounding: { removed_vendors: number; unknown_prices: number };
}

export interface PlannerApi {
  generate(input: PlannerInput): Promise<PlanResult>;
  report(interactionId: string, category: ReportCategory, note?: string): Promise<void>;
}

/** POST /api/planner/generate. */
export async function generatePlan(
  input: PlannerInput,
  accessToken: string | null,
): Promise<PlanResult> {
  if (!accessToken) throw new PlannerError("unauthorized", "no_token");
  let res: Response;
  try {
    res = await fetch("/api/planner/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
      body: JSON.stringify(input),
    });
  } catch {
    throw new PlannerError("unknown", "plan_request_failed");
  }
  const body = (await res.json().catch(() => null)) as Partial<PlanResult> | null;
  if (!res.ok) throw readError(body);
  if (!body || typeof body.interaction_id !== "string" || !body.plan) {
    throw new PlannerError("unknown", "invalid_plan_response");
  }
  return {
    interaction_id: body.interaction_id,
    disclosure: typeof body.disclosure === "string" ? body.disclosure : PLANNER_DISCLOSURE,
    plan: body.plan,
    grounding: {
      removed_vendors: Number(body.grounding?.removed_vendors ?? 0),
      unknown_prices: Number(body.grounding?.unknown_prices ?? 0),
    },
  };
}

/** POST /api/planner/report. */
export async function reportPlan(
  interactionId: string,
  category: ReportCategory,
  accessToken: string | null,
  note?: string,
): Promise<void> {
  if (!accessToken) throw new PlannerError("unauthorized", "no_token");
  let res: Response;
  try {
    res = await fetch("/api/planner/report", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
      body: JSON.stringify({ interaction_id: interactionId, category, note: note ?? null }),
    });
  } catch {
    throw new PlannerError("unknown", "report_request_failed");
  }
  const body = (await res.json().catch(() => null)) as unknown;
  if (!res.ok) throw readError(body);
}

/** The token reader is injected so the panel can be rendered in tests without an auth provider. */
export function createPlannerApi(getAccessToken: () => Promise<string | null>): PlannerApi {
  return {
    generate: async (input) => generatePlan(input, await getAccessToken()),
    report: async (interactionId, category, note) =>
      reportPlan(interactionId, category, await getAccessToken(), note),
  };
}
