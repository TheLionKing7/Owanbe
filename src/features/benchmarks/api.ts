/**
 * F-106 browser boundary. The browser talks to the app's own route; the route forwards the
 * caller's token to the database, which decides whether they may read a market range.
 */
import { BENCHMARK_DISCLOSURE, type BenchmarkRange, type BenchmarkRequest } from "./contracts";

export type BenchmarkErrorCode =
  | "forbidden"
  | "not_found"
  | "validation"
  | "unauthorized"
  | "rate_limited"
  | "unconfigured"
  | "unknown";

export class BenchmarkError extends Error {
  constructor(
    readonly code: BenchmarkErrorCode,
    message: string,
    readonly retryable = false,
  ) {
    super(message);
    this.name = "BenchmarkError";
  }
}

export const BENCHMARK_ERROR_COPY: Record<BenchmarkErrorCode, string> = {
  forbidden: "Market prices are only shown to hosts in a house and to the analytics team.",
  not_found: "We could not find any market prices.",
  validation: "Check the details and try again.",
  unauthorized: "Sign in to see market prices.",
  rate_limited: "You asked a moment ago. Give it a few seconds before asking again.",
  unconfigured: "Sign-in is not configured in this environment, so market prices stay locked.",
  unknown: "Something went wrong. Try again in a moment.",
};

const ERROR_CODES: readonly BenchmarkErrorCode[] = [
  "forbidden",
  "not_found",
  "validation",
  "unauthorized",
  "rate_limited",
  "unconfigured",
  "unknown",
];

/** Validation carries the field's own words; every other refusal is explained from the copy map. */
export function benchmarkErrorMessage(error: unknown): string {
  if (error instanceof BenchmarkError) {
    return error.code === "validation" ? error.message : BENCHMARK_ERROR_COPY[error.code];
  }
  return BENCHMARK_ERROR_COPY.unknown;
}

function readError(body: unknown): BenchmarkError {
  const payload = body as { error?: unknown; message?: unknown; retryable?: unknown } | null;
  const code = ERROR_CODES.find((candidate) => candidate === payload?.error) ?? "unknown";
  return new BenchmarkError(
    code,
    typeof payload?.message === "string" ? payload.message : "request_failed",
    payload?.retryable === true,
  );
}

function readRange(row: unknown): BenchmarkRange | null {
  const record = (row ?? {}) as Record<string, unknown>;
  const category = typeof record["category"] === "string" ? record["category"] : "";
  if (!category) return null;
  return {
    category,
    location: typeof record["location"] === "string" ? record["location"] : "",
    currency: typeof record["currency"] === "string" ? record["currency"] : "",
    observation_count: Number(record["observation_count"] ?? 0),
    vendor_count: Number(record["vendor_count"] ?? 0),
    min_price_minor: nullableNumber(record["min_price_minor"]),
    median_price_minor: nullableNumber(record["median_price_minor"]),
    max_price_minor: nullableNumber(record["max_price_minor"]),
    oldest_observed_at:
      typeof record["oldest_observed_at"] === "string" ? record["oldest_observed_at"] : null,
    newest_observed_at:
      typeof record["newest_observed_at"] === "string" ? record["newest_observed_at"] : null,
    source: typeof record["source"] === "string" ? record["source"] : "vendor_quote",
    published: record["published"] === true,
  };
}

function nullableNumber(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const amount = Number(value);
  return Number.isFinite(amount) ? amount : null;
}

export interface BenchmarkApi {
  read(request: BenchmarkRequest): Promise<{ ranges: BenchmarkRange[] }>;
}

/** POST /api/benchmarks. */
export async function fetchBenchmarkRanges(
  request: BenchmarkRequest,
  accessToken: string | null,
): Promise<{ ranges: BenchmarkRange[] }> {
  if (!accessToken) throw new BenchmarkError("unauthorized", "no_token");
  let res: Response;
  try {
    res = await fetch("/api/benchmarks", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
      body: JSON.stringify(request),
    });
  } catch {
    throw new BenchmarkError("unknown", "benchmark_request_failed");
  }
  const body = (await res.json().catch(() => null)) as {
    ranges?: unknown;
    error?: unknown;
    message?: unknown;
    retryable?: unknown;
  } | null;
  if (!res.ok) throw readError(body);
  const rows = Array.isArray(body?.ranges) ? body.ranges : [];
  return { ranges: rows.map(readRange).filter((range): range is BenchmarkRange => range !== null) };
}

/** The token reader is injected so the panel can be rendered in tests without an auth provider. */
export function createBenchmarkApi(getAccessToken: () => Promise<string | null>): BenchmarkApi {
  return {
    read: async (request) => fetchBenchmarkRanges(request, await getAccessToken()),
  };
}

export { BENCHMARK_DISCLOSURE };
