import { describe, expect, it } from "vitest";
import {
  MOVEMENT_LABELS,
  PAYMENT_REFUSAL_COPY,
  POOL_STATUS_LABELS,
  classifyPaymentsError,
  freezeRequestSchema,
  paymentReferenceSchema,
  refusalCopyFor,
  refundRequestSchema,
} from "./contracts";

describe("refundRequestSchema", () => {
  it("accepts a reason a person wrote", () => {
    expect(refundRequestSchema.safeParse({ reason: "The date changed" }).success).toBe(true);
  });

  it("refuses a reason that is too short to be an explanation", () => {
    const parsed = refundRequestSchema.safeParse({ reason: "  " });
    expect(parsed.success).toBe(false);
  });

  it("refuses a reason that is too long to store", () => {
    expect(refundRequestSchema.safeParse({ reason: "x".repeat(201) }).success).toBe(false);
  });

  it("refuses a request with no reason at all", () => {
    expect(refundRequestSchema.safeParse({}).success).toBe(false);
  });
});

describe("freezeRequestSchema", () => {
  it("accepts a reason a person wrote", () => {
    expect(freezeRequestSchema.safeParse({ reason: "A dispute is open" }).success).toBe(true);
  });

  it("refuses a reason that is too short", () => {
    expect(freezeRequestSchema.safeParse({ reason: "no" }).success).toBe(false);
  });
});

describe("paymentReferenceSchema", () => {
  it("accepts a reference the provider gave", () => {
    expect(paymentReferenceSchema.safeParse("owanbe-abcd1234").success).toBe(true);
  });

  it("refuses an empty reference", () => {
    expect(paymentReferenceSchema.safeParse("   ").success).toBe(false);
  });
});

describe("classifyPaymentsError", () => {
  it("reads the pause the database names", () => {
    expect(classifyPaymentsError("payments_paused")).toBe("paused");
  });

  it("reads a refusal of the caller's access", () => {
    expect(classifyPaymentsError("forbidden: not the host of this booking")).toBe("forbidden");
    expect(classifyPaymentsError("permission denied for table fund_pool")).toBe("forbidden");
  });

  it("reads a booking that is not there", () => {
    expect(classifyPaymentsError("booking_not_found")).toBe("not_found");
  });

  it("reads an environment that is not set up", () => {
    expect(classifyPaymentsError("auth_not_configured")).toBe("unconfigured");
  });

  it("reads a named refusal as a validation problem", () => {
    expect(classifyPaymentsError("payment_below_quote_total")).toBe("validation");
    expect(classifyPaymentsError("fund_pool_frozen")).toBe("validation");
    expect(classifyPaymentsError("currency_mismatch")).toBe("validation");
  });

  it("does not guess at a refusal it does not know", () => {
    expect(classifyPaymentsError("something else entirely")).toBe("unknown");
    expect(classifyPaymentsError("")).toBe("unknown");
  });
});

describe("refusalCopyFor", () => {
  it("gives the sentence for a refusal the database named", () => {
    expect(refusalCopyFor("fund_pool_frozen")).toBe(
      "This money is on hold while a dispute is open.",
    );
    expect(refusalCopyFor("payment_already_recorded")).toBe("This booking has already been paid.");
  });

  it("has no sentence for a refusal it does not know", () => {
    expect(refusalCopyFor("something else entirely")).toBeNull();
  });

  it("gives every refusal a sentence, and no sentence that is empty", () => {
    for (const [name, copy] of Object.entries(PAYMENT_REFUSAL_COPY)) {
      expect(copy.length, name).toBeGreaterThan(0);
    }
  });
});

describe("the labels a host reads", () => {
  it("names every pool status the database can hold", () => {
    for (const status of [
      "awaiting_payment",
      "held",
      "partially_released",
      "released",
      "refund_pending",
      "refunded",
    ]) {
      expect(POOL_STATUS_LABELS[status], status).toBeTruthy();
    }
  });

  it("names every movement the wallet ledger can hold", () => {
    for (const movement of [
      "booking_hold",
      "release_70",
      "release_30",
      "fee",
      "refund",
      "refund_settled",
      "payout",
    ]) {
      expect(MOVEMENT_LABELS[movement], movement).toBeTruthy();
    }
  });
});
