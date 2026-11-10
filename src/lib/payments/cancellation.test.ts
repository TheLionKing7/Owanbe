import { describe, expect, it } from "vitest";
import { daysUntil, quoteCancellation, refundPercent } from "./cancellation";

describe("cancellation policy", () => {
  it("host more than 30 days out gets 80%", () => expect(refundPercent("host", 31)).toBe(80));
  it("host exactly 30 days out gets 50%", () => expect(refundPercent("host", 30)).toBe(50));
  it("host 14 days out gets 50%", () => expect(refundPercent("host", 14)).toBe(50));
  it("host under 14 days gets nothing", () => expect(refundPercent("host", 13)).toBe(0));
  it("vendor cancellation refunds everything", () => expect(refundPercent("vendor", 1)).toBe(100));

  it("₦500,000 refund is automatic, one kobo more needs two approvals", () => {
    expect(quoteCancellation("vendor", 50_000_000, 5).needsSecondApproval).toBe(false);
    expect(quoteCancellation("vendor", 50_000_001, 5).needsSecondApproval).toBe(true);
  });

  it("splits 80/20 for an early host cancel", () => {
    const q = quoteCancellation("host", 1_000_000, 60);
    expect(q.refundMinor).toBe(800_000);
    expect(q.vendorKeepsMinor).toBe(200_000);
  });

  it("counts whole days in UTC", () => {
    expect(daysUntil("2026-12-10", new Date("2026-11-10T23:00:00Z"))).toBe(30);
  });
});
