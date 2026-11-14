import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { streamText } = vi.hoisted(() => ({ streamText: vi.fn() }));
vi.mock("ai", async (importOriginal) => {
  const actual = await importOriginal<typeof import("ai")>();
  return { ...actual, streamText };
});
vi.mock("@ai-sdk/openai", () => ({
  createOpenAI: () => ({ responses: () => "model" }),
}));

import { generatePlanOptions } from "./planner.server";
import { PRICE_UNKNOWN_LABEL, type PlannerInput, type VendorFact } from "./contracts";

const INPUT: PlannerInput = {
  event_type: "Wedding",
  city: "Lagos",
  guest_count: 150,
  budget_minor: 50_000_000,
  budget_currency: "NGN",
  brief: "A traditional wedding with a small band.",
};

const FACT: VendorFact = {
  slug: "adeola-cakes",
  business_name: "Adeola Cakes",
  category: "Cakes",
  locations: "Lagos",
  price_note: "Packages from ₦500,000",
  services: ["Wedding cake"],
  highlights: ["Bespoke designs"],
};

beforeEach(() => {
  streamText.mockReset();
  vi.stubEnv("LOVABLE_API_KEY", "test-key");
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("generatePlanOptions", () => {
  it("grounds the answer before it is returned", async () => {
    streamText.mockReturnValue({
      output: {
        summary: "The day can run two ways.",
        options: [
          {
            title: "The intimate plan",
            summary: "A smaller afternoon celebration.",
            vendor_slugs: ["adeola-cakes", "ghost-vendor"],
            steps: [{ title: "Book the band", detail: "Confirm the set list." }],
          },
        ],
      },
    });

    const outcome = await generatePlanOptions(INPUT, [FACT], { zdrConfirmed: true });

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.plan.options.at(0)?.vendors.map((vendor) => vendor.slug)).toEqual([
      "adeola-cakes",
    ]);
    expect(outcome.plan.removed_vendors).toBe(1);
    expect(outcome.plan.options.at(0)?.vendors.at(0)?.price_label).toBe("Packages from ₦500,000");
  });

  it("gives no answer at all when no vendor has published a profile", async () => {
    const outcome = await generatePlanOptions(INPUT, [], { zdrConfirmed: true });

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.plan.options).toHaveLength(0);
    expect(outcome.plan.summary).toContain("No vendor has published a profile yet");
    expect(streamText).not.toHaveBeenCalled();
  });

  it("says the planner is not set up when the gateway key is missing", async () => {
    vi.stubEnv("LOVABLE_API_KEY", "");
    const outcome = await generatePlanOptions(INPUT, [FACT], { zdrConfirmed: true });

    expect(outcome).toMatchObject({ ok: false, code: "unconfigured", retryable: false });
    expect(streamText).not.toHaveBeenCalled();
  });

  it("refuses to plan while the zero-retention contract is unconfirmed", async () => {
    const outcome = await generatePlanOptions(INPUT, [FACT], { zdrConfirmed: false });

    expect(outcome).toMatchObject({ ok: false, code: "unconfigured", retryable: false });
    expect(streamText).not.toHaveBeenCalled();
  });

  it("labels a price it cannot read as unknown", async () => {
    streamText.mockReturnValue({
      output: {
        summary: "One way.",
        options: [
          {
            title: "The plan",
            summary: "A plan.",
            vendor_slugs: ["adeola-cakes"],
            steps: [],
          },
        ],
      },
    });

    const outcome = await generatePlanOptions(INPUT, [{ ...FACT, price_note: "Ask us" }], {
      zdrConfirmed: true,
    });

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.plan.options.at(0)?.vendors.at(0)?.price_label).toBe(PRICE_UNKNOWN_LABEL);
    expect(outcome.plan.unknown_prices).toBe(1);
  });
});
