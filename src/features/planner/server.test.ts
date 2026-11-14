import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { planAsCaller, reportPlanAsCaller } from "./server";

const { generatePlanOptions } = vi.hoisted(() => ({ generatePlanOptions: vi.fn() }));
vi.mock("./planner.server", () => ({
  PLANNER_MODEL: "openai/gpt-6-astra",
  generatePlanOptions,
}));

const TOKEN = "header.payload.signature";
const INTERACTION_ID = "6f1e9c4a-2b3d-4e5f-8a7b-1c2d3e4f5a6b";

const INPUT = {
  event_type: "Wedding",
  city: "Lagos",
  guest_count: 150,
  budget_minor: 50_000_000,
  budget_currency: "NGN",
  brief: "A traditional wedding with a small band.",
};

const PROFILES = [
  {
    slug: "adeola-cakes",
    business_name: "Adeola Cakes",
    category: "Cakes",
    locations: "Lagos",
    price_note: "Packages from ₦500,000",
    services: [{ name: "Wedding cake", description: "Three tiers" }],
    highlights: ["Bespoke designs"],
  },
];

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function request(body?: unknown): Request {
  const init: RequestInit = {
    method: "POST",
    headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" },
  };
  if (body !== undefined) init.body = JSON.stringify(body);
  return new Request("https://owanbe.app/api/planner/generate", init);
}

interface RpcCalls {
  houses?: unknown;
  cooldown?: unknown;
  profiles?: unknown;
  aiStatus?: unknown;
  log?: unknown;
}

/** Stands in for PostgREST: each function answers with what the case needs. */
function stubDatabase(overrides: RpcCalls = {}) {
  const calls: { rpc: string; body: Record<string, unknown>; headers: Record<string, string> }[] =
    [];
  const fetchMock = vi.fn(async (url: string, init: RequestInit) => {
    const rpc = String(url).split("/").pop() ?? "";
    const body = JSON.parse((init.body as string) ?? "{}") as Record<string, unknown>;
    const headers = (init.headers ?? {}) as Record<string, string>;
    calls.push({ rpc, body, headers });
    if (rpc === "my_houses") {
      return jsonResponse(
        overrides.houses ?? [
          {
            house_id: "h-1",
            kind: "host",
            display_name: "Our wedding",
            role: "owner",
            capabilities: [],
          },
        ],
      );
    }
    if (rpc === "ai_planner_cooldown_seconds") {
      return jsonResponse(overrides.cooldown ?? 0);
    }
    if (rpc === "public_vendor_profiles") {
      return jsonResponse(overrides.profiles ?? PROFILES);
    }
    if (rpc === "ai_investigation_status") {
      return jsonResponse(
        overrides.aiStatus ?? [{ zdr_confirmed: true, has_grant: false, can_investigate: false }],
      );
    }
    if (rpc === "log_ai_planner_interaction") {
      return jsonResponse(overrides.log ?? INTERACTION_ID);
    }
    if (rpc === "report_ai_planner_response") {
      return jsonResponse(overrides.log ?? null);
    }
    return jsonResponse({ message: "unexpected rpc" }, 404);
  });
  vi.stubGlobal("fetch", fetchMock);
  return { calls, fetchMock };
}

beforeEach(() => {
  vi.stubEnv("EXTERNAL_SUPABASE_URL", "https://project.supabase.co");
  vi.stubEnv("EXTERNAL_SUPABASE_PUBLISHABLE_KEY", "sb_publishable_example");
  generatePlanOptions.mockReset();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("POST /planner/generate", () => {
  it("refuses a caller with no token", async () => {
    stubDatabase();
    const res = await planAsCaller(
      new Request("https://owanbe.app/api/planner/generate", { method: "POST" }),
    );
    expect(res.status).toBe(401);
  });

  it("refuses a caller who is not in a Host house", async () => {
    stubDatabase({
      houses: [{ house_id: "v-1", kind: "vendor", display_name: "Adeola", role: "owner" }],
    });
    const res = await planAsCaller(request(INPUT));
    expect(res.status).toBe(403);
    expect(generatePlanOptions).not.toHaveBeenCalled();
  });

  it("refuses while the cooldown is still running", async () => {
    stubDatabase({ cooldown: 12 });
    const res = await planAsCaller(request(INPUT));
    expect(res.status).toBe(429);
    expect(generatePlanOptions).not.toHaveBeenCalled();
  });

  it("forwards the caller's own token to the database", async () => {
    const { calls } = stubDatabase();
    generatePlanOptions.mockResolvedValue({
      ok: true,
      plan: { summary: "A plan.", options: [], removed_vendors: 0, unknown_prices: 0 },
    });
    await planAsCaller(request(INPUT));
    expect(calls.length).toBeGreaterThan(0);
    for (const call of calls) {
      expect(call.headers["Authorization"]).toBe(`Bearer ${TOKEN}`);
    }
  });

  it("gives the assistant the published vendor profiles and the host's own words", async () => {
    stubDatabase();
    generatePlanOptions.mockResolvedValue({
      ok: true,
      plan: { summary: "A plan.", options: [], removed_vendors: 0, unknown_prices: 0 },
    });
    await planAsCaller(request(INPUT));

    const call = generatePlanOptions.mock.calls.at(0);
    expect(call).toBeDefined();
    const facts = (call?.[1] ?? []) as { slug: string; price_note: string }[];
    expect(call?.[0]).toEqual(INPUT);
    expect(facts).toHaveLength(1);
    expect(facts.at(0)?.slug).toBe("adeola-cakes");
    expect(facts.at(0)?.price_note).toBe("Packages from ₦500,000");
  });

  it("tells the assistant whether the zero-retention contract is confirmed", async () => {
    stubDatabase();
    generatePlanOptions.mockResolvedValue({
      ok: true,
      plan: { summary: "A plan.", options: [], removed_vendors: 0, unknown_prices: 0 },
    });
    await planAsCaller(request(INPUT));

    const call = generatePlanOptions.mock.calls.at(0);
    expect(call?.[2]).toEqual({ zdrConfirmed: true });
  });

  it("tells the assistant when the contract is not confirmed", async () => {
    stubDatabase({
      aiStatus: [{ zdr_confirmed: false, has_grant: false, can_investigate: false }],
    });
    generatePlanOptions.mockResolvedValue({
      ok: true,
      plan: { summary: "A plan.", options: [], removed_vendors: 0, unknown_prices: 0 },
    });
    await planAsCaller(request(INPUT));

    const call = generatePlanOptions.mock.calls.at(0);
    expect(call?.[2]).toEqual({ zdrConfirmed: false });
  });

  it("returns the answer with the interaction it was logged as", async () => {
    const { calls } = stubDatabase();
    generatePlanOptions.mockResolvedValue({
      ok: true,
      plan: {
        summary: "Two ways to do the day.",
        options: [
          {
            title: "The intimate plan",
            summary: "A smaller afternoon celebration.",
            vendors: [
              {
                slug: "adeola-cakes",
                business_name: "Adeola Cakes",
                category: "Cakes",
                price_label: "Packages from ₦500,000",
                price_known: true,
                availability_label: "Availability unknown — ask the vendor",
                budget_fit: "within_budget",
              },
            ],
            steps: [],
          },
        ],
        removed_vendors: 0,
        unknown_prices: 0,
      },
    });

    const res = await planAsCaller(request(INPUT));
    const body = (await res.json()) as {
      interaction_id: string;
      disclosure: string;
      plan: { options: unknown[] };
      grounding: { removed_vendors: number };
    };

    expect(res.status).toBe(200);
    expect(body.interaction_id).toBe(INTERACTION_ID);
    expect(body.disclosure).toBe("AI-generated plan");
    expect(body.plan.options).toHaveLength(1);

    const logged = calls.find((call) => call.rpc === "log_ai_planner_interaction");
    expect(logged?.body["p_status"]).toBe("ok");
    expect(logged?.body["p_option_count"]).toBe(1);
    expect(logged?.body["p_model"]).toBe("openai/gpt-6-astra");
    expect(logged?.body["p_plan_summary"]).toEqual([
      {
        title: "The intimate plan",
        summary: "A smaller afternoon celebration.",
        vendor_slugs: ["adeola-cakes"],
      },
    ]);
  });

  it("logs a failed attempt as well", async () => {
    const { calls } = stubDatabase();
    generatePlanOptions.mockResolvedValue({
      ok: false,
      code: "unknown",
      error: "We could not plan that just now. Please try again.",
      retryable: true,
    });

    const res = await planAsCaller(request(INPUT));
    expect(res.status).toBe(502);

    const logged = calls.find((call) => call.rpc === "log_ai_planner_interaction");
    expect(logged?.body["p_status"]).toBe("error");
    expect(logged?.body["p_option_count"]).toBe(0);
  });

  it("refuses a body the database would refuse", async () => {
    stubDatabase();
    const res = await planAsCaller(request({ ...INPUT, guest_count: 0 }));
    expect(res.status).toBe(400);
    expect(generatePlanOptions).not.toHaveBeenCalled();
  });
});

describe("POST /planner/report", () => {
  it("sends the report as the caller", async () => {
    const { calls } = stubDatabase();
    const res = await reportPlanAsCaller(
      request({ interaction_id: INTERACTION_ID, category: "wrong_facts", note: "Wrong city" }),
    );
    expect(res.status).toBe(200);

    const reported = calls.find((call) => call.rpc === "report_ai_planner_response");
    expect(reported?.body["p_interaction"]).toBe(INTERACTION_ID);
    expect(reported?.body["p_category"]).toBe("wrong_facts");
    expect(reported?.headers["Authorization"]).toBe(`Bearer ${TOKEN}`);
  });

  it("refuses a report with no category", async () => {
    stubDatabase();
    const res = await reportPlanAsCaller(request({ interaction_id: INTERACTION_ID }));
    expect(res.status).toBe(400);
  });
});
