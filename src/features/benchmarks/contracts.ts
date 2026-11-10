/**
 * F-106 market benchmark data: the shapes a host reads, and the words that keep them honest.
 *
 * A benchmark range is a summary of prices vendors actually asked for. The platform proves a
 * price only when a vendor sent a quote, so every range carries where it came from and when it
 * was seen. A range is published only when two or more vendors hold a current price, so one
 * vendor's private quote is never handed back to the market.
 */
import { z } from "zod";

/** Where the numbers come from, in words a host can trust. */
export const BENCHMARK_SOURCE_LABEL = "Prices vendors quoted";

/** The label that sits on the source line, so the range is never read as the platform's own price. */
export const BENCHMARK_DISCLOSURE = "Market prices from vendor quotes";

/** Shown when there are not yet enough vendors for a range to be published. */
export const BENCHMARK_NOT_PUBLISHED_LABEL = "Not enough published prices yet";

/** The only categories a request may ask for, so the database is never asked to scan the market. */
export const BENCHMARK_CATEGORY_COUNT = 12;

export const benchmarkRequestSchema = z.object({
  categories: z
    .array(z.string().trim().min(2, "Name the kind of vendor you are comparing.").max(40))
    .min(1, "Tell us what you are comparing prices for.")
    .max(BENCHMARK_CATEGORY_COUNT),
  location: z.string().trim().min(1, "Tell us the city.").max(120),
});
export type BenchmarkRequest = z.infer<typeof benchmarkRequestSchema>;

/** One category's market range, as the database publishes it. */
export interface BenchmarkRange {
  category: string;
  location: string;
  currency: string;
  observation_count: number;
  vendor_count: number;
  /** Null while the range is not published: a single vendor's price is not a market. */
  min_price_minor: number | null;
  median_price_minor: number | null;
  max_price_minor: number | null;
  oldest_observed_at: string | null;
  newest_observed_at: string | null;
  source: string;
  published: boolean;
}

export interface BenchmarkResult {
  ranges: BenchmarkRange[];
  disclosure: string;
}

/** The ranges a host asked for, in the order the database gave them. */
export function publishedRanges(ranges: BenchmarkRange[]): BenchmarkRange[] {
  return ranges.filter((range) => range.published);
}

/**
 * The window the prices were observed in, in plain words. Freshness is relative: the database
 * keeps an observation current until the same vendor states a newer price, and the window tells
 * the host how old the oldest price in the range is.
 */
export function freshnessLabel(range: BenchmarkRange): string {
  const oldest = parseDate(range.oldest_observed_at);
  const newest = parseDate(range.newest_observed_at);
  if (!oldest || !newest) return "When these prices were seen is not recorded.";
  if (oldest === newest) return `Seen on ${oldest}.`;
  return `Seen between ${oldest} and ${newest}.`;
}

const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

function parseDate(value: string | null): string | null {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return `${date.getUTCDate()} ${MONTHS[date.getUTCMonth()]} ${date.getUTCFullYear()}`;
}
