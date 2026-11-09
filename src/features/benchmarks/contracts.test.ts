import { describe, expect, it } from "vitest";
import {
  BENCHMARK_NOT_PUBLISHED_LABEL,
  benchmarkRequestSchema,
  freshnessLabel,
  publishedRanges,
  type BenchmarkRange,
} from "./contracts";

function range(overrides: Partial<BenchmarkRange> = {}): BenchmarkRange {
  return {
    category: "Cakes",
    location: "Lagos",
    currency: "NGN",
    observation_count: 2,
    vendor_count: 2,
    min_price_minor: 30_000_000,
    median_price_minor: 40_000_000,
    max_price_minor: 50_000_000,
    oldest_observed_at: "2026-03-12T09:00:00.000Z",
    newest_observed_at: "2026-09-02T09:00:00.000Z",
    source: "vendor_quote",
    published: true,
    ...overrides,
  };
}

describe("benchmark request", () => {
  it("accepts categories and a city", () => {
    const parsed = benchmarkRequestSchema.safeParse({ categories: ["Cakes"], location: "Lagos" });
    expect(parsed.success).toBe(true);
  });

  it("will not ask for no categories", () => {
    const parsed = benchmarkRequestSchema.safeParse({ categories: [], location: "Lagos" });
    expect(parsed.success).toBe(false);
  });

  it("will not ask about no city", () => {
    const parsed = benchmarkRequestSchema.safeParse({ categories: ["Cakes"], location: "  " });
    expect(parsed.success).toBe(false);
  });

  it("keeps the categories within what the market can be asked about", () => {
    const categories = Array.from({ length: 13 }, (_, index) => `Category ${index}`);
    const parsed = benchmarkRequestSchema.safeParse({ categories, location: "Lagos" });
    expect(parsed.success).toBe(false);
  });
});

describe("publishedRanges", () => {
  it("keeps only the ranges the database published", () => {
    const ranges = [
      range({ category: "Cakes" }),
      range({
        category: "Bands",
        published: false,
        min_price_minor: null,
        median_price_minor: null,
        max_price_minor: null,
      }),
    ];
    expect(publishedRanges(ranges).map((item) => item.category)).toEqual(["Cakes"]);
  });
});

describe("freshnessLabel", () => {
  it("names the window the prices were seen in", () => {
    expect(freshnessLabel(range())).toBe("Seen between 12 March 2026 and 2 September 2026.");
  });

  it("names the day when every price was seen the same day", () => {
    const label = freshnessLabel(
      range({
        oldest_observed_at: "2026-03-12T09:00:00.000Z",
        newest_observed_at: "2026-03-12T09:00:00.000Z",
      }),
    );
    expect(label).toBe("Seen on 12 March 2026.");
  });

  it("says when the moment is not recorded", () => {
    const label = freshnessLabel(range({ oldest_observed_at: null, newest_observed_at: null }));
    expect(label).toBe("When these prices were seen is not recorded.");
  });
});

describe("the not-published label", () => {
  it("is what a host sees when one vendor is behind the range", () => {
    expect(BENCHMARK_NOT_PUBLISHED_LABEL).toBe("Not enough published prices yet");
  });
});
