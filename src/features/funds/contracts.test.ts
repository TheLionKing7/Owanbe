import { describe, expect, it } from "vitest";
import {
  classifyFundsError,
  recoveryDecisionSchema,
  recoveryRequestSchema,
  refusalCopyFor,
  releaseRequestSchema,
  splitRequestSchema,
} from "./contracts";

describe("the split a person asks for", () => {
  it("takes an amount and a currency", () => {
    const parsed = splitRequestSchema.safeParse({ total_minor: 100000, currency: "NGN" });
    expect(parsed.success).toBe(true);
  });

  it("refuses an amount that is not a whole number of minor units", () => {
    expect(splitRequestSchema.safeParse({ total_minor: 10.5, currency: "NGN" }).success).toBe(
      false,
    );
  });

  it("refuses an amount of nothing", () => {
    expect(splitRequestSchema.safeParse({ total_minor: 0, currency: "NGN" }).success).toBe(false);
  });

  it("refuses a currency that is not three letters", () => {
    expect(splitRequestSchema.safeParse({ total_minor: 100, currency: "N" }).success).toBe(false);
  });
});

describe("a recovery request", () => {
  it("takes the amount to take back from the vendor", () => {
    const parsed = recoveryRequestSchema.safeParse({
      kind: "clawback",
      case_id: "6f1e9c4a-2b3d-4e5f-8a7b-1c2d3e4f5a6b",
      amount_minor: 5000,
      reason: "The vendor did not deliver",
    });
    expect(parsed.success).toBe(true);
  });

  it("takes the cost of the replacement for an advance", () => {
    const parsed = recoveryRequestSchema.safeParse({
      kind: "advance",
      case_id: "6f1e9c4a-2b3d-4e5f-8a7b-1c2d3e4f5a6b",
      replacement_cost_minor: 8000,
      reason: "The vendor did not deliver",
    });
    expect(parsed.success).toBe(true);
  });

  it("will not ask for a clawback without an amount", () => {
    const parsed = recoveryRequestSchema.safeParse({
      kind: "clawback",
      case_id: "6f1e9c4a-2b3d-4e5f-8a7b-1c2d3e4f5a6b",
      reason: "The vendor did not deliver",
    });
    expect(parsed.success).toBe(false);
  });

  it("will not ask for an advance without the cost of the replacement", () => {
    const parsed = recoveryRequestSchema.safeParse({
      kind: "advance",
      case_id: "6f1e9c4a-2b3d-4e5f-8a7b-1c2d3e4f5a6b",
      reason: "The vendor did not deliver",
    });
    expect(parsed.success).toBe(false);
  });

  it("asks for a reason, because the trail needs one", () => {
    const parsed = recoveryRequestSchema.safeParse({
      kind: "clawback",
      case_id: "6f1e9c4a-2b3d-4e5f-8a7b-1c2d3e4f5a6b",
      amount_minor: 5000,
      reason: "no",
    });
    expect(parsed.success).toBe(false);
  });
});

describe("a decision about a request", () => {
  it("takes a decision and a request", () => {
    const parsed = recoveryDecisionSchema.safeParse({
      action_id: "6f1e9c4a-2b3d-4e5f-8a7b-1c2d3e4f5a6b",
      decision: "approved",
    });
    expect(parsed.success).toBe(true);
  });

  it("refuses a decision that is not one we record", () => {
    const parsed = recoveryDecisionSchema.safeParse({
      action_id: "6f1e9c4a-2b3d-4e5f-8a7b-1c2d3e4f5a6b",
      decision: "maybe",
    });
    expect(parsed.success).toBe(false);
  });
});

describe("the release of a tranche", () => {
  it("takes a booking", () => {
    const parsed = releaseRequestSchema.safeParse({
      booking_id: "6f1e9c4a-2b3d-4e5f-8a7b-1c2d3e4f5a6b",
    });
    expect(parsed.success).toBe(true);
  });

  it("refuses a link that is not a booking", () => {
    expect(releaseRequestSchema.safeParse({ booking_id: "not-a-booking" }).success).toBe(false);
  });
});

describe("the refusals", () => {
  it("reads a permission problem as a permission problem", () => {
    expect(classifyFundsError("forbidden: finance grant required")).toBe("forbidden");
  });

  it("reads a missing thing as a missing thing", () => {
    expect(classifyFundsError("case_not_found")).toBe("not_found");
  });

  it("reads a named refusal as a validation problem", () => {
    expect(classifyFundsError("insufficient_recovery_funds")).toBe("validation");
  });

  it("has a sentence for every refusal it names", () => {
    expect(refusalCopyFor("nothing_to_recover")).toBe(
      "There is nothing left to take back from this vendor.",
    );
    expect(refusalCopyFor("recovery_action_not_approved")).toBe(
      "Two staff have not approved this yet.",
    );
  });

  it("says nothing about a refusal it does not know", () => {
    expect(refusalCopyFor("something_else")).toBeNull();
    expect(classifyFundsError("something_else")).toBe("unknown");
  });
});
