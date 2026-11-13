/**
 * F-126 server-only boundary for GET /api/observability.
 *
 * The caller's own token is forwarded to PostgREST, so the database decides whether they may
 * read the dashboard: a platform staff member holding the 'operations' capability. No secret key
 * is read here, and no service-role path exists in this file.
 *
 * The error-tracking half of the dashboard is read on the server too, because Sentry's auth token
 * is server-only. When Sentry is not configured, or cannot be reached, the dashboard still shows
 * the platform's own counters and says that error tracking was not available.
 */
import { callAsCaller, callerToken } from "@/lib/db/caller.server";
import { readSentryIssueSummary } from "@/lib/monitoring/sentry.server";
import {
  OBSERVABILITY_DISCLOSURE,
  OBSERVABILITY_SEVERITIES,
  type ErrorTrackingSummary,
  type ObservabilitySeverity,
  type ObservabilitySignal,
} from "./contracts";

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

const UNCONFIGURED = {
  error: "unconfigured",
  message: "Sign-in is not configured in this environment, so the dashboard stays locked.",
};

/** The database's own refusal, turned into what the browser is told. Raw text is not returned. */
async function failure(res: Response): Promise<Response> {
  let code = "";
  try {
    const body = (await res.json()) as { code?: unknown };
    code = String(body.code ?? "");
  } catch {
    code = "";
  }
  if (code === "42501") {
    return json(
      { error: "forbidden", message: "This dashboard is for platform operations staff." },
      403,
    );
  }
  if (code === "28000") {
    return json(
      { error: "unauthorized", message: "Sign in to open the operations dashboard." },
      401,
    );
  }
  if (code === "22023") {
    return json({ error: "unknown", message: "Something went wrong. Try again in a moment." }, 502);
  }
  console.error("observability rpc failed", res.status, code);
  return json({ error: "unknown", message: "Something went wrong. Try again in a moment." }, 502);
}

function readSeverity(value: unknown): ObservabilitySeverity {
  const found = OBSERVABILITY_SEVERITIES.find((candidate) => candidate === value);
  return found ?? "info";
}

/** One signal, as the database published it. */
function toSignal(row: unknown): ObservabilitySignal | null {
  const record = (row ?? {}) as Record<string, unknown>;
  const key = typeof record["signal_key"] === "string" ? record["signal_key"] : "";
  if (!key) return null;
  const amount = Number(record["signal_value"] ?? 0);
  return {
    signal_key: key,
    signal_label: typeof record["signal_label"] === "string" ? record["signal_label"] : "",
    value: Number.isFinite(amount) ? amount : 0,
    detail: typeof record["detail"] === "string" ? record["detail"] : "",
    severity: readSeverity(record["severity"]),
  };
}

function toErrorTracking(summary: Awaited<ReturnType<typeof readSentryIssueSummary>>) {
  if (!summary) return null;
  const tracking: ErrorTrackingSummary = {
    unresolved_issues: summary.unresolved_issues,
    capped_at: summary.capped_at,
    window_hours: summary.window_hours,
  };
  return tracking;
}

/** GET /api/observability — the platform's operational counters. */
export async function readObservabilityAsCaller(request: Request): Promise<Response> {
  const token = callerToken(request);
  if (!token) {
    return json(
      { error: "unauthorized", message: "Sign in to open the operations dashboard." },
      401,
    );
  }

  let res: Response;
  try {
    res = await callAsCaller("observability_dashboard", token, {});
  } catch {
    return json(UNCONFIGURED, 503);
  }
  if (!res.ok) return failure(res);

  const rows = (await res.json()) as unknown;
  const signals = (Array.isArray(rows) ? rows : [])
    .map(toSignal)
    .filter((signal): signal is ObservabilitySignal => signal !== null);

  const errorTracking = toErrorTracking(await readSentryIssueSummary());

  return json(
    {
      signals,
      read_at: new Date().toISOString(),
      disclosure: OBSERVABILITY_DISCLOSURE,
      error_tracking: errorTracking,
    },
    200,
  );
}
