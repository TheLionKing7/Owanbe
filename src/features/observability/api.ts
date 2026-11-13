/**
 * F-126 browser boundary. The browser talks to the app's own route; the route forwards the
 * caller's token to the database, which decides whether they may read the dashboard at all.
 */
import {
  OBSERVABILITY_DISCLOSURE,
  OBSERVABILITY_SEVERITIES,
  type ErrorTrackingSummary,
  type ObservabilitySeverity,
  type ObservabilitySignal,
  type ObservabilitySnapshot,
} from "./contracts";

export type ObservabilityErrorCode = "forbidden" | "unauthorized" | "unconfigured" | "unknown";

export class ObservabilityError extends Error {
  constructor(
    readonly code: ObservabilityErrorCode,
    message: string,
    readonly retryable = false,
  ) {
    super(message);
    this.name = "ObservabilityError";
  }
}

export const OBSERVABILITY_ERROR_COPY: Record<ObservabilityErrorCode, string> = {
  forbidden: "This dashboard is for platform operations staff.",
  unauthorized: "Sign in to open the operations dashboard.",
  unconfigured: "Sign-in is not configured in this environment, so the dashboard stays locked.",
  unknown: "Something went wrong. Try again in a moment.",
};

const ERROR_CODES: readonly ObservabilityErrorCode[] = [
  "forbidden",
  "unauthorized",
  "unconfigured",
  "unknown",
];

/** Every refusal is explained in the user's words; nothing else is shown. */
export function observabilityErrorMessage(error: unknown): string {
  if (error instanceof ObservabilityError) return OBSERVABILITY_ERROR_COPY[error.code];
  return OBSERVABILITY_ERROR_COPY.unknown;
}

function readError(body: unknown): ObservabilityError {
  const payload = body as { error?: unknown; message?: unknown; retryable?: unknown } | null;
  const code = ERROR_CODES.find((candidate) => candidate === payload?.error) ?? "unknown";
  return new ObservabilityError(
    code,
    typeof payload?.message === "string" ? payload.message : "request_failed",
    payload?.retryable === true,
  );
}

function readSeverity(value: unknown): ObservabilitySeverity {
  const found = OBSERVABILITY_SEVERITIES.find((candidate) => candidate === value);
  return found ?? "info";
}

function readSignal(row: unknown): ObservabilitySignal | null {
  const record = (row ?? {}) as Record<string, unknown>;
  const key = typeof record["signal_key"] === "string" ? record["signal_key"] : "";
  if (!key) return null;
  const amount = Number(record["value"] ?? 0);
  return {
    signal_key: key,
    signal_label: typeof record["signal_label"] === "string" ? record["signal_label"] : "",
    value: Number.isFinite(amount) ? amount : 0,
    detail: typeof record["detail"] === "string" ? record["detail"] : "",
    severity: readSeverity(record["severity"]),
  };
}

function readErrorTracking(row: unknown): ErrorTrackingSummary | null {
  const record = (row ?? {}) as Record<string, unknown>;
  if (!record || typeof record !== "object" || record["unresolved_issues"] === undefined)
    return null;
  const issues = Number(record["unresolved_issues"] ?? 0);
  const capped = Number(record["capped_at"] ?? 0);
  const hours = Number(record["window_hours"] ?? 0);
  return {
    unresolved_issues: Number.isFinite(issues) ? issues : 0,
    capped_at: Number.isFinite(capped) ? capped : 0,
    window_hours: Number.isFinite(hours) ? hours : 0,
  };
}

export interface ObservabilityApi {
  read(): Promise<ObservabilitySnapshot>;
}

/** GET /api/observability. */
export async function fetchObservabilitySnapshot(
  accessToken: string | null,
): Promise<ObservabilitySnapshot> {
  if (!accessToken) throw new ObservabilityError("unauthorized", "no_token");
  let res: Response;
  try {
    res = await fetch("/api/observability", {
      method: "GET",
      headers: { Authorization: `Bearer ${accessToken}` },
    });
  } catch {
    throw new ObservabilityError("unknown", "observability_request_failed");
  }
  const body = (await res.json().catch(() => null)) as {
    signals?: unknown;
    read_at?: unknown;
    disclosure?: unknown;
    error_tracking?: unknown;
    error?: unknown;
    message?: unknown;
    retryable?: unknown;
  } | null;
  if (!res.ok) throw readError(body);
  const rows = Array.isArray(body?.signals) ? body.signals : [];
  return {
    signals: rows
      .map(readSignal)
      .filter((signal): signal is ObservabilitySignal => signal !== null),
    read_at: typeof body?.read_at === "string" ? body.read_at : "",
    disclosure: typeof body?.disclosure === "string" ? body.disclosure : OBSERVABILITY_DISCLOSURE,
    error_tracking: readErrorTracking(body?.error_tracking),
  };
}

/** The token reader is injected so the panel can be rendered in tests without an auth provider. */
export function createObservabilityApi(
  getAccessToken: () => Promise<string | null>,
): ObservabilityApi {
  return {
    read: async () => fetchObservabilitySnapshot(await getAccessToken()),
  };
}
