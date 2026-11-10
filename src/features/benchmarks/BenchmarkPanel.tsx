import { useEffect, useMemo, useState } from "react";
import { TrendingUp } from "lucide-react";
import { benchmarkErrorMessage, createBenchmarkApi, type BenchmarkApi } from "./api";
import {
  BENCHMARK_NOT_PUBLISHED_LABEL,
  BENCHMARK_SOURCE_LABEL,
  freshnessLabel,
  type BenchmarkRange,
} from "./contracts";
import { formatMoney } from "@/lib/payments/currency";

const NO_TOKEN = async (): Promise<string | null> => null;

interface BenchmarkPanelProps {
  /** The categories of the vendors this option names. */
  categories: string[];
  /** The city the host is planning in. */
  location: string;
  /** Injected in tests; defaults to the app's own benchmark route. */
  api?: BenchmarkApi | undefined;
  /** The caller's own token decides what the database lets them read. */
  getAccessToken?: (() => Promise<string | null>) | undefined;
}

/**
 * F-106: the market range beside the vendors a plan names. The range comes from prices vendors
 * actually quoted, and it says so, with the window it was observed in. A range with one vendor
 * behind it is not published, and the panel says that instead of showing a price.
 */
export function BenchmarkPanel({ categories, location, api, getAccessToken }: BenchmarkPanelProps) {
  const readToken = getAccessToken ?? NO_TOKEN;
  const client = useMemo(() => api ?? createBenchmarkApi(readToken), [api, readToken]);

  const [ranges, setRanges] = useState<BenchmarkRange[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const wanted = useMemo(
    () => Array.from(new Set(categories.map((category) => category.trim()).filter(Boolean))),
    [categories],
  );
  const key = wanted.join("|");

  useEffect(() => {
    const asked = key.split("|").filter(Boolean);
    if (asked.length === 0 || !location.trim()) {
      setRanges(null);
      setError(null);
      return;
    }
    let live = true;
    setLoading(true);
    setError(null);
    client
      .read({ categories: asked, location: location.trim() })
      .then((result) => {
        if (!live) return;
        setRanges(result.ranges);
      })
      .catch((caught: unknown) => {
        if (!live) return;
        setRanges(null);
        setError(benchmarkErrorMessage(caught));
      })
      .finally(() => {
        if (live) setLoading(false);
      });
    return () => {
      live = false;
    };
  }, [client, key, location]);

  if (wanted.length === 0 || !location.trim()) return null;

  return (
    <div className="mt-4 rounded-2xl bg-cream-100 p-4" data-testid="benchmark-panel">
      <p className="inline-flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.14em] text-plum-800">
        <TrendingUp aria-hidden className="h-3.5 w-3.5" /> Market prices
      </p>

      {loading && (
        <p role="status" className="mt-2 text-sm text-ink-muted" data-testid="benchmark-loading">
          Looking for the prices vendors quoted…
        </p>
      )}

      {error && !loading && (
        <p role="alert" className="mt-2 text-sm text-ink-muted" data-testid="benchmark-error">
          {error}
        </p>
      )}

      {!loading && !error && ranges !== null && ranges.length === 0 && (
        <p className="mt-2 text-sm text-ink-muted" data-testid="benchmark-empty">
          No vendors have quoted for this in {location.trim()} yet, so there is no market price to
          show.
        </p>
      )}

      {!loading && !error && ranges !== null && ranges.length > 0 && (
        <ul className="mt-2 space-y-2" data-testid="benchmark-ranges">
          {ranges.map((range) => (
            <li
              key={`${range.category}-${range.currency}`}
              className="text-sm"
              data-testid="benchmark-range"
            >
              <span className="font-semibold text-plum-950">{range.category}</span>
              {range.published &&
              range.min_price_minor !== null &&
              range.max_price_minor !== null ? (
                <span className="text-ink">
                  {" — "}
                  {formatMoney(range.min_price_minor, range.currency)} to{" "}
                  {formatMoney(range.max_price_minor, range.currency)}
                  {range.median_price_minor !== null && (
                    <span className="text-ink-muted">
                      {" "}
                      (typically {formatMoney(range.median_price_minor, range.currency)})
                    </span>
                  )}
                </span>
              ) : (
                <span className="text-ink-muted"> — {BENCHMARK_NOT_PUBLISHED_LABEL}</span>
              )}
              <span className="mt-1 block text-xs text-ink-subtle">
                {BENCHMARK_SOURCE_LABEL} · {range.vendor_count} vendor
                {range.vendor_count === 1 ? "" : "s"} · {freshnessLabel(range)}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
