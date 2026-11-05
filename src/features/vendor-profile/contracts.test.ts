import { describe, expect, it } from "vitest";
import { normalizeCopy, profileBriefSchema } from "./contracts";
import { VENDOR_CATEGORIES } from "./presets";

const brief = {
  businessName: "Adé Events Place",
  category: "event-centers",
  offerings: ["Hall only"],
  details: {},
  story: "A bright 500-seat hall in Lekki with full power backup.",
  tone: "warm",
};

describe("vendor profile copy", () => {
  it("covers every vendor type the owner listed", () => {
    expect(VENDOR_CATEGORIES.map((c) => c.slug)).toEqual([
      "event-centers", "service-apartments", "catering", "mc", "fashion", "photo-video",
      "live-band", "decor", "event-manager", "chauffeur", "protocol-security",
    ]);
  });
  it("accepts a complete brief", () => expect(profileBriefSchema.safeParse(brief).success).toBe(true));
  it("rejects unknown categories", () => expect(profileBriefSchema.safeParse({ ...brief, category: "spa" }).success).toBe(false));
  it("requires at least one service", () => expect(profileBriefSchema.safeParse({ ...brief, offerings: [] }).success).toBe(false));
  it("rejects unexpected fields", () => expect(profileBriefSchema.safeParse({ ...brief, role: "admin" }).success).toBe(false));
  it("drops incomplete model output", () => expect(normalizeCopy({ headline: "", about: "x" })).toBeNull());
  it("clamps service count to 12", () => {
    const services = Array.from({ length: 20 }, (_, i) => ({ name: `S${i}`, description: "d" }));
    expect(normalizeCopy({ headline: "H", tagline: "", about: "A", services, highlights: [] })?.services).toHaveLength(12);
  });
});
