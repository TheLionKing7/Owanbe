import { describe, expect, it } from "vitest";
import {
  INVESTIGATION_SYSTEM,
  buildInvestigationPrompt,
  investigationSchema,
  type PaymentEventRow,
  type PaymentLogRow,
} from "./investigation";

const LOG: PaymentLogRow = {
  booking_id: "6f1e9c4a-2b3d-4e5f-8a7b-1c2d3e4f5a6b",
  booking_status: "paid",
  pool_status: "held",
  currency: "NGN",
  total_minor: 5_000_000,
  paid_minor: 5_000_000,
  held_minor: 5_000_000,
  released_minor: 0,
  refunded_minor: 0,
  frozen: false,
  release_30_due_at: "2026-12-09T00:00:00Z",
  paid_at: "2026-11-09T00:00:00Z",
  completed_at: null,
  refunded_at: null,
  movement_count: 2,
  event_count: 3,
  failed_event_count: 1,
  hours_since_paid: 48,
};

const EVENTS: PaymentEventRow[] = [
  {
    event_id: "3f1e9c4a-2b3d-4e5f-8a7b-1c2d3e4f5a99",
    event_type: "charge.failed",
    outcome: "failed",
    amount_minor: 5_000_000,
    currency: "NGN",
    occurred_at: "2026-11-08T09:00:00Z",
  },
];

describe("the investigation prompt", () => {
  it("gives the model the money in minor units and the currency beside it", () => {
    const prompt = buildInvestigationPrompt(LOG, EVENTS, undefined);
    expect(prompt).toContain("minor units of NGN");
    expect(prompt).toContain("paid 5000000");
    expect(prompt).toContain("held 5000000");
    expect(prompt).toContain("total 5000000");
  });

  it("carries no event id, so no provider record can be read back out of it", () => {
    const prompt = buildInvestigationPrompt(LOG, EVENTS, undefined);
    expect(prompt).not.toContain(EVENTS[0]?.event_id ?? "");
    expect(prompt).not.toContain(LOG.booking_id);
  });

  it("says plainly when the booking has never been paid", () => {
    const prompt = buildInvestigationPrompt(
      { ...LOG, paid_at: null, hours_since_paid: null },
      [],
      undefined,
    );
    expect(prompt).toContain("paid at: never");
    expect(prompt).toContain("hours since the payment: not paid");
    expect(prompt).toContain("The provider has recorded no event for this booking.");
  });

  it("carries the staff member's question when there is one", () => {
    const prompt = buildInvestigationPrompt(LOG, EVENTS, "Why is the money still held?");
    expect(prompt).toContain("The staff member's question:");
    expect(prompt).toContain("Why is the money still held?");
  });

  it("tells the model it cannot move money", () => {
    expect(INVESTIGATION_SYSTEM).toContain("read-only investigator");
    expect(INVESTIGATION_SYSTEM).toContain("cannot move money");
  });
});

describe("the investigation answer", () => {
  it("takes a finding, and a subject and a reason when a case is asked for", () => {
    const parsed = investigationSchema.parse({
      summary: "The money is still held with no release recorded.",
      finding: "case_opened",
      subject: "Held payment with no release",
      reason: "The payment was taken and no release was recorded after the due date.",
      priority: "high",
    });
    expect(parsed.finding).toBe("case_opened");
    expect(parsed.priority).toBe("high");
  });

  it("refuses a finding it does not know", () => {
    const parsed = investigationSchema.safeParse({
      summary: "Something.",
      finding: "refund_the_host",
    });
    expect(parsed.success).toBe(false);
  });
});
