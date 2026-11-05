import { describe, expect, it } from "vitest";
import { publishProblem, saveErrorMessage, toSavePayload, type SaveInput } from "./profile-data";

const base: SaveInput = {
  businessName: "  Adùnní Events ",
  category: "decor",
  locations: " Lagos ",
  priceNote: "",
  brief: { offerings: ["Stage design"], story: "We decorate." },
  copy: {
    headline: "Rooms that feel like home",
    tagline: "",
    about: "We dress halls.",
    services: [{ name: "Stage design", description: "Full stage." }, { name: "", description: "orphan" }],
    highlights: ["Fast setup", "  "],
  },
};

describe("vendor profile saving", () => {
  it("trims text and drops empty services and highlights", () => {
    const p = toSavePayload(base);
    expect(p.business_name).toBe("Adùnní Events");
    expect(p.locations).toBe("Lagos");
    expect(p.services).toEqual([{ name: "Stage design", description: "Full stage." }]);
    expect(p.highlights).toEqual(["Fast setup"]);
  });

  it("refuses to publish without a headline", () => {
    expect(publishProblem({ ...base, copy: { ...base.copy, headline: " " } })).toMatch(/headline/);
  });

  it("refuses to publish without an about section", () => {
    expect(publishProblem({ ...base, copy: { ...base.copy, about: "" } })).toMatch(/about/);
  });

  it("allows publishing a complete profile", () => {
    expect(publishProblem(base)).toBeNull();
  });

  it("explains a missing permission in plain words", () => {
    expect(saveErrorMessage(new Error("forbidden"))).toMatch(/permission/);
  });
});
