import { describe, expect, it } from "vitest";
import {
  AI_DISCLOSURE,
  REPORT_CATEGORIES,
  REPORT_CATEGORY_LABEL,
  aiReportSchema,
  investigationRequestSchema,
} from "./contracts";

describe("the shared AI contracts", () => {
  it("holds the categories the database holds", () => {
    expect([...REPORT_CATEGORIES]).toEqual([
      "wrong_facts",
      "not_relevant",
      "missing_vendor",
      "price_or_availability",
      "harmful",
      "other",
    ]);
  });

  it("has a sentence for every category", () => {
    for (const category of REPORT_CATEGORIES) {
      expect(REPORT_CATEGORY_LABEL[category]).toBeTruthy();
    }
  });

  it("gives every surface its own disclosure", () => {
    expect(AI_DISCLOSURE.planner).toBe("AI-generated plan");
    expect(AI_DISCLOSURE.vendorCopy).toBe("AI-written draft");
    expect(AI_DISCLOSURE.investigation).toBe("AI investigation");
  });

  it("accepts a report for an answer and refuses one that is not an answer", () => {
    const parsed = aiReportSchema.safeParse({
      interaction_id: "6f1e9c4a-2b3d-4e5f-8a7b-1c2d3e4f5a6b",
      category: "wrong_facts",
      note: "The city is wrong",
    });
    expect(parsed.success).toBe(true);

    const refused = aiReportSchema.safeParse({
      interaction_id: "not-an-answer",
      category: "wrong_facts",
    });
    expect(refused.success).toBe(false);

    const unknownCategory = aiReportSchema.safeParse({
      interaction_id: "6f1e9c4a-2b3d-4e5f-8a7b-1c2d3e4f5a6b",
      category: "because",
    });
    expect(unknownCategory.success).toBe(false);
  });

  it("takes a booking and an optional question for an investigation", () => {
    const parsed = investigationRequestSchema.safeParse({
      booking_id: "6f1e9c4a-2b3d-4e5f-8a7b-1c2d3e4f5a6b",
      question: "Why is the money still held?",
    });
    expect(parsed.success).toBe(true);

    const refused = investigationRequestSchema.safeParse({ booking_id: "nope" });
    expect(refused.success).toBe(false);
  });
});
