import { describe, expect, it } from "vitest";
import { quoteRequestSchema } from "./requests";

const base = { vendor_slug: "ade-events", guest_count: 200, budget_naira: 500000, notes: null };
const daysFromNow = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);

describe("F-13 quote request rules", () => {
  it("accepts a future celebration date", () => {
    expect(quoteRequestSchema.safeParse({ ...base, service_date: daysFromNow(10) }).success).toBe(true);
  });
  it("rejects today and past dates", () => {
    expect(quoteRequestSchema.safeParse({ ...base, service_date: daysFromNow(0) }).success).toBe(false);
    expect(quoteRequestSchema.safeParse({ ...base, service_date: daysFromNow(-3) }).success).toBe(false);
  });
  it("rejects zero guests and over-long notes", () => {
    expect(quoteRequestSchema.safeParse({ ...base, service_date: daysFromNow(5), guest_count: 0 }).success).toBe(false);
    expect(
      quoteRequestSchema.safeParse({ ...base, service_date: daysFromNow(5), notes: "x".repeat(1001) }).success,
    ).toBe(false);
  });
});
