import { describe, expect, it } from "vitest";
import {
  normalizePhone,
  plannerPrompt,
  resumeStep,
  safeNext,
  validateAbout,
  validatePlans,
  type OnboardingState,
} from "./contracts";

const base: OnboardingState = {
  role: "host",
  display_name: "Ada Okafor",
  phone_e164: "+2348012345678",
  phone_verified: false,
  city: "Lagos",
  host_intent: null,
  event_type: null,
  event_date: null,
  business_category: null,
  has_vendor_house: false,
  completed_at: null,
};

describe("F-7 onboarding rules", () => {
  it("turns the phone numbers people actually type into E.164", () => {
    expect(normalizePhone("0801 234 5678")).toBe("+2348012345678");
    expect(normalizePhone("+234 (0) 801 234 5678")).toBe("+2348012345678");
    expect(normalizePhone("2348012345678")).toBe("+2348012345678");
    expect(normalizePhone("+44 7700 900123")).toBe("+447700900123");
    expect(normalizePhone("0044 7700 900123")).toBe("+447700900123");
    expect(normalizePhone("7700 900123")).toBeNull(); // foreign without a country code
    expect(normalizePhone("0801234")).toBeNull();
    expect(normalizePhone("")).toBeNull();
  });

  it("resumes at the first step that is missing something", () => {
    expect(resumeStep(null, null)).toBe("role");
    expect(resumeStep(null, "vendor")).toBe("about");
    expect(resumeStep({ ...base, city: null }, null)).toBe("about");
    expect(resumeStep(base, null)).toBe("plans");
    expect(resumeStep({ ...base, host_intent: "hosting" }, null)).toBe("done");
    expect(resumeStep({ ...base, role: "vendor", business_category: "Catering" }, null)).toBe(
      "business",
    );
    expect(
      resumeStep(
        { ...base, role: "vendor", business_category: "Catering", has_vendor_house: true },
        null,
      ),
    ).toBe("done");
    expect(resumeStep({ ...base, completed_at: "2026-11-07T00:00:00Z" }, "vendor")).toBe("done");
  });

  it("explains each problem in plain words", () => {
    expect(validateAbout({ name: "A", phone: "123", city: "" })).toEqual({
      name: expect.stringContaining("name"),
      phone: expect.stringContaining("full phone number"),
      city: expect.stringContaining("city"),
    });
    expect(validateAbout({ name: "Ada", phone: "08012345678", city: "Lagos" })).toEqual({});
    const today = new Date(2026, 10, 7);
    expect(validatePlans({ intent: "", eventType: "", eventDate: "" }, today)).toHaveProperty(
      "intent",
    );
    expect(
      validatePlans({ intent: "hosting", eventType: "", eventDate: "2026-11-06" }, today),
    ).toHaveProperty("eventDate");
    expect(
      validatePlans({ intent: "hosting", eventType: "", eventDate: "2026-11-07" }, today),
    ).toEqual({});
  });

  it("hands OwanbePlanner only what the host told us", () => {
    expect(
      plannerPrompt({
        host_intent: "hosting",
        event_type: "Wedding",
        event_date: "2027-03-14",
        city: "Lagos",
      }),
    ).toBe("Help me plan my wedding in Lagos on 14 March 2027.");
    expect(
      plannerPrompt({ host_intent: "arranging", event_type: null, event_date: null, city: null }),
    ).toBe("Help me plan a celebration I'm arranging for a client.");
  });

  it("only continues to in-app paths", () => {
    expect(safeNext("/host/quotes", "/host")).toBe("/host/quotes");
    expect(safeNext("//evil.example", "/host")).toBe("/host");
    expect(safeNext("https://evil.example", "/host")).toBe("/host");
    expect(safeNext("/welcome?role=host", "/host")).toBe("/host");
    expect(safeNext(null, "/vendor")).toBe("/vendor");
  });
});
