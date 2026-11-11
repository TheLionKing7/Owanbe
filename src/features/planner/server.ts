/**
 * F-101 server-only boundary for POST /planner/generate and POST /planner/report.
 *
 * The caller's own token is forwarded to PostgREST, so the database decides whether they may
 * plan and whether they may report an answer. No service-role key is read here: a secret key
 * would act as the server rather than the caller, so it is refused rather than used.
 */
import {
  PLANNER_COOLDOWN_SECONDS,
  PLANNER_DISCLOSURE,
  plannerInputSchema,
  type GroundedPlan,
  type PlannerInput,
  type VendorFact,
} from "./contracts";
import { REPORT_CATEGORIES, type ReportCategory } from "@/features/ai/contracts";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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
  if (message.includes("rate_limited")) {
    return json(
      {
        error: "rate_limited",
        message: `You asked the planner a moment ago. Give it ${PLANNER_COOLDOWN_SECONDS} seconds before asking again.`,
      },
      429,
    );
  }
  if (code === "42501") {
    return json(
      { error: "forbidden", message: "The planner is a Host house tool, and you are not in one." },
      403,
    );
  }
  if (code === "P0002") {
    return json({ error: "not_found", message: "We could not find that answer." }, 404);
  }
  if (code === "22023") {
    return json({ error: "validation", message: "Check the details and try again." }, 400);
  }
  if (code === "28000") {
    return json({ error: "unauthorized", message: "Sign in to use the planner." }, 401);
  }
  console.error("planner rpc failed", res.status, code);
  return json({ error: "unknown", message: "Something went wrong. Try again in a moment." }, 502);
}

const UNCONFIGURED = {
  error: "unconfigured",
  message: "Sign-in is not configured in this environment, so the planner stays locked.",
};

/** The published vendor profiles, as the planner may use them. */
function toVendorFacts(rows: unknown): VendorFact[] {
  if (!Array.isArray(rows)) return [];
  const facts: VendorFact[] = [];
  for (const row of rows as Record<string, unknown>[]) {
    const slug = typeof row?.["slug"] === "string" ? row["slug"] : "";
    if (!slug) continue;
    const services = Array.isArray(row?.["services"])
      ? (row["services"] as { name?: unknown; description?: unknown }[])
          .map((service) => {
            const name = typeof service?.name === "string" ? service.name : "";
            const description = typeof service?.description === "string" ? service.description : "";
            return description ? `${name} — ${description}` : name;
          })
          .filter(Boolean)
          .slice(0, 12)
      : [];
    const highlights = Array.isArray(row?.["highlights"])
      ? (row["highlights"] as unknown[]).filter((item): item is string => typeof item === "string")
      : [];
    facts.push({
      slug,
      business_name: typeof row?.["business_name"] === "string" ? row["business_name"] : slug,
      category: typeof row?.["category"] === "string" ? row["category"] : "",
      locations: typeof row?.["locations"] === "string" ? row["locations"] : "",
      price_note: typeof row?.["price_note"] === "string" ? row["price_note"] : "",
      services,
      highlights: highlights.slice(0, 6),
    });
  }
  return facts;
}

/** POST /planner/generate — the assistant's answer, grounded and logged. */
export async function planAsCaller(request: Request): Promise<Response> {
  const token = callerToken(request);
  if (!token) {
    return json({ error: "unauthorized", message: "Sign in to use the planner." }, 401);
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return json({ error: "validation", message: "Check the details and try again." }, 400);
  }
  const parsed = plannerInputSchema.safeParse(body);
  if (!parsed.success) {
    return json(
      {
        error: "validation",
        message: parsed.error.issues[0]?.message ?? "Check the details and try again.",
      },
      400,
    );
  }
  const input: PlannerInput = parsed.data;

  let houses: Response;
  let cooldown: Response;
  let profiles: Response;
  try {
    [houses, cooldown, profiles] = await Promise.all([
      callAsCaller("my_houses", token, {}),
      callAsCaller("ai_planner_cooldown_seconds", token, {}),
      callAsCaller("public_vendor_profiles", token, {}),
    ]);
  } catch {
    return json(UNCONFIGURED, 503);
  }
  if (!houses.ok) return failure(houses);
  if (!cooldown.ok) return failure(cooldown);
  if (!profiles.ok) return failure(profiles);

  const houseRows = (await houses.json()) as { kind?: unknown }[];
  if (!houseRows.some((row) => row?.kind === "host")) {
    return json(
      { error: "forbidden", message: "The planner is a Host house tool, and you are not in one." },
      403,
    );
  }

  const waitFor = Number((await cooldown.json()) ?? 0);
  if (Number.isFinite(waitFor) && waitFor > 0) {
    return json(
      {
        error: "rate_limited",
        message: `You asked the planner a moment ago. Give it ${waitFor} second${waitFor === 1 ? "" : "s"} before asking again.`,
      },
      429,
    );
  }

  const facts = toVendorFacts(await profiles.json());

  const { generatePlanOptions, PLANNER_MODEL } = await import("./planner.server");
  const outcome = await generatePlanOptions(input, facts);
  // The model that answered, not the chain's first choice: the interaction log has to name the
  // model that actually produced the plan.
  const answeredModel = outcome.model ?? PLANNER_MODEL;

  const plan: GroundedPlan | null = outcome.ok ? outcome.plan : null;
  const status = outcome.ok ? "ok" : "error";
  const planSummary = plan
    ? plan.options.map((option) => ({
        title: option.title,
        summary: option.summary,
        vendor_slugs: option.vendors.map((vendor) => vendor.slug),
      }))
    : [];

  let interactionId: string | null = null;
  try {
    const logged = await callAsCaller("log_ai_planner_interaction", token, {
      p_event_type: input.event_type,
      p_city: input.city,
      p_guest_count: input.guest_count,
      p_budget_minor: input.budget_minor,
      p_budget_currency: input.budget_currency,
      p_brief: input.brief,
      p_model: answeredModel,
      p_status: status,
      p_option_count: plan?.options.length ?? 0,
      p_plan_summary: planSummary,
    });
    if (!logged.ok) return failure(logged);
    interactionId = (await logged.json()) as string;
  } catch {
    return json(UNCONFIGURED, 503);
  }

  if (!outcome.ok) {
    return json(
      {
        error: outcome.code === "unconfigured" ? "unconfigured" : "unknown",
        message: outcome.error,
        retryable: outcome.retryable,
        interaction_id: interactionId,
      },
      outcome.code === "unconfigured" ? 503 : 502,
    );
  }

  return json(
    {
      interaction_id: interactionId,
      disclosure: PLANNER_DISCLOSURE,
      plan,
      grounding: {
        removed_vendors: plan?.removed_vendors ?? 0,
        unknown_prices: plan?.unknown_prices ?? 0,
      },
    },
    200,
  );
}

/** POST /planner/report — the host reports one answer. */
export async function reportPlanAsCaller(request: Request): Promise<Response> {
  const token = callerToken(request);
  if (!token) {
    return json({ error: "unauthorized", message: "Sign in to use the planner." }, 401);
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return json({ error: "validation", message: "Check the details and try again." }, 400);
  }
  const payload = (body as { interaction_id?: unknown; category?: unknown; note?: unknown }) ?? {};
  const interactionId = typeof payload.interaction_id === "string" ? payload.interaction_id : "";
  if (!UUID_PATTERN.test(interactionId)) {
    return json({ error: "validation", message: "That answer could not be found." }, 400);
  }
  const category = typeof payload.category === "string" ? payload.category : "";
  if (!(REPORT_CATEGORIES as readonly string[]).includes(category)) {
    return json({ error: "validation", message: "Choose what was wrong with the answer." }, 400);
  }
  const note = typeof payload.note === "string" ? payload.note.trim().slice(0, 500) : null;

  let res: Response;
  try {
    res = await callAsCaller("report_ai_planner_response", token, {
      p_interaction: interactionId,
      p_category: category,
      p_note: note,
    });
  } catch {
    return json(UNCONFIGURED, 503);
  }
  if (!res.ok) return failure(res);
  return json({ interaction_id: interactionId, category: category as ReportCategory }, 200);
}
