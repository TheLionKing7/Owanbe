import { describe, expect, it, vi } from "vitest";

const { generateStructured } = vi.hoisted(() => ({ generateStructured: vi.fn() }));
vi.mock("@/lib/ai/provider.server", () => ({ generateStructured }));

import { generateProfileCopy } from "./copy.server";

const brief = {
  businessName: "Ade Events",
  category: "event-centers",
  tone: "warm",
  offerings: ["Hall only"],
  details: {},
  locations: "Lagos",
  priceNote: "",
  story: "We plan weddings.",
};

function failure(code: string) {
  generateStructured.mockResolvedValue({ ok: false, failure: { code, retryable: true } });
}

describe("the vendor copy assistant", () => {
  it("drafts through the platform's provider, not its own gateway client", async () => {
    generateStructured.mockResolvedValue({
      ok: true,
      model: "openai/gpt-6-luna",
      value: {
        headline: "Weddings made calm",
        tagline: "We plan the day.",
        about: "Two short paragraphs.",
        services: [{ name: "Wedding planning", description: "The whole day." }],
        highlights: ["Calm planning"],
      },
    });

    const result = await generateProfileCopy(brief);

    expect(result.ok).toBe(true);
    expect(generateStructured).toHaveBeenCalledWith(
      expect.objectContaining({ model: "vendorCopy" }),
    );
    // The log has to name the model that answered, not the chain's first choice.
    expect(result.ok && result.model).toBe("openai/gpt-6-luna");
  });

  it("says the assistant is not set up when the gateway is not configured", async () => {
    failure("unconfigured");

    const result = await generateProfileCopy(brief);

    expect(result).toEqual({
      ok: false,
      error: "The writing assistant is not set up yet.",
      retryable: false,
    });
  });

  it("tells the vendor to wait when the model is busy", async () => {
    failure("rate_limited");

    const result = await generateProfileCopy(brief);

    expect(result.ok).toBe(false);
    expect(result.ok === false && result.retryable).toBe(true);
    expect(result.ok === false && result.error).toBe(
      "Too many requests right now. Wait a minute and try again.",
    );
  });

  it("does not offer to retry when the credits are gone", async () => {
    failure("credits");

    const result = await generateProfileCopy(brief);

    expect(result.ok === false && result.retryable).toBe(false);
  });

  it("refuses when the platform's AI agreement is unconfirmed", async () => {
    failure("zdr_required");

    const result = await generateProfileCopy(brief);

    expect(result.ok === false && result.retryable).toBe(false);
    expect(result.ok === false && result.error).toContain("AI agreement");
  });
});
