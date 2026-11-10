/**
 * F-106 server-only boundary for POST /api/benchmarks.
 *
 * The caller's own token is forwarded to PostgREST, so the database decides whether they may
 * read a market range: a host in a house, or platform staff holding the 'analytics' capability.
 * No service-role key is read here: a secret key would answer as the server, not as the caller.
 */
import { BENCHMARK_DISCLOSURE, benchmarkRequestSchema, type BenchmarkRange } from "./contracts";

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

function callerToken(request: Request): string | null {
  const header = request.headers.get("authorization");
  const token = header?.startsWith("Bearer ") ? header.slice(7).trim() : "";
  return token.split(".").length === 3 ? token : null;
}

/** The publishable key only: a secret key would answer as the server, not as the caller. */
function callerCredentials(): { url: string; key: string } | null {
  const url = process.env["EXTERNAL_SUPABASE_URL"] ?? process.env["SUPABASE_URL"];
  const key =
    process.env["EXTERNAL_SUPABASE_PUBLISHABLE_KEY"] ?? process.env["SUPABASE_PUBLISHABLE_KEY"];
  if (!url || !key || key.startsWith("sb_secret_")) return null;
  return { url: url.replace(/\/+$/, ""), key };
}

async function callAsCaller(
  rpc: string,
  token: string,
  payload: Record<string, unknown>,
): Promise<Response> {
  const credentials = callerCredentials();
  if (!credentials) throw new Error("unconfigured");
  return fetch(`${credentials.url}/rest/v1/rpc/${rpc}`, {
    method: "POST",
    headers: {
      apikey: credentials.key,
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });
}

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
    return json(
      {
        error: "forbidden",
        message: "Market prices are only shown to hosts in a house and to the analytics team.",
      },
      403,
    );
  }
  if (code === "P0002") {
    return json({ error: "not_found", message: "We could not find any market prices." }, 404);
  }
  if (code === "22023") {
    return json({ error: "validation", message: "Check the details and try again." }, 400);
  }
  if (code === "28000") {
    return json({ error: "unauthorized", message: "Sign in to see market prices." }, 401);
  }
  if (res.status === 401) {
    return json({ error: "unauthorized", message: "Sign in to see market prices." }, 401);
  }
  console.error("benchmark rpc failed", res.status, code);
  return json({ error: "unknown", message: "Something went wrong. Try again in a moment." }, 502);
}

const UNCONFIGURED = {
  error: "unconfigured",
  message: "Sign-in is not configured in this environment, so market prices stay locked.",
};

/** One row of the range, as the database published it. */
function toRange(row: unknown): BenchmarkRange | null {
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

/** POST /api/benchmarks — the market range for the categories a host is comparing. */
export async function readBenchmarksAsCaller(request: Request): Promise<Response> {
  const token = callerToken(request);
  if (!token) {
    return json({ error: "unauthorized", message: "Sign in to see market prices." }, 401);
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return json({ error: "validation", message: "Check the details and try again." }, 400);
  }
  const parsed = benchmarkRequestSchema.safeParse(body);
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
    res = await callAsCaller("read_market_benchmarks", token, {
      p_categories: parsed.data.categories,
      p_location: parsed.data.location,
    });
  } catch {
    return json(UNCONFIGURED, 503);
  }
  if (!res.ok) return failure(res);

  const rows = (await res.json()) as unknown;
  const ranges = (Array.isArray(rows) ? rows : [])
    .map(toRange)
    .filter((range): range is BenchmarkRange => range !== null);

  return json({ ranges, disclosure: BENCHMARK_DISCLOSURE }, 200);
}
