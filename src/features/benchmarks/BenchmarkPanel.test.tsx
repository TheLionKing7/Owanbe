import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { BenchmarkError, type BenchmarkApi } from "./api";
import { BenchmarkPanel } from "./BenchmarkPanel";
import { BENCHMARK_NOT_PUBLISHED_LABEL, type BenchmarkRange } from "./contracts";

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

function stubApi(ranges: BenchmarkRange[] = [range()]): BenchmarkApi {
  return { read: vi.fn(async () => ({ ranges })) };
}

afterEach(cleanup);

describe("BenchmarkPanel", () => {
  it("asks the database about the categories the option names", async () => {
    const api = stubApi();
    render(<BenchmarkPanel categories={["Cakes", "Cakes", "Bands"]} location="Lagos" api={api} />);

    await waitFor(() => expect(api.read).toHaveBeenCalled());
    expect(api.read).toHaveBeenCalledWith({ categories: ["Cakes", "Bands"], location: "Lagos" });
  });

  it("shows the range with its source and the window it was seen in", async () => {
    render(<BenchmarkPanel categories={["Cakes"]} location="Lagos" api={stubApi()} />);

    const shown = await screen.findByTestId("benchmark-range");
    expect(shown).toHaveTextContent("Cakes");
    expect(shown).toHaveTextContent("Prices vendors quoted");
    expect(shown).toHaveTextContent("Seen between 12 March 2026 and 2 September 2026.");
    expect(shown).toHaveTextContent("2 vendors");
  });

  it("names no price when one vendor is behind the range", async () => {
    render(
      <BenchmarkPanel
        categories={["Cakes"]}
        location="Lagos"
        api={stubApi([
          range({
            published: false,
            vendor_count: 1,
            min_price_minor: null,
            median_price_minor: null,
            max_price_minor: null,
          }),
        ])}
      />,
    );

    const shown = await screen.findByTestId("benchmark-range");
    expect(shown).toHaveTextContent(BENCHMARK_NOT_PUBLISHED_LABEL);
    expect(shown).not.toHaveTextContent("300,000");
  });

  it("says when there is no market price yet", async () => {
    render(<BenchmarkPanel categories={["Cakes"]} location="Lagos" api={stubApi([])} />);

    expect(await screen.findByTestId("benchmark-empty")).toHaveTextContent(
      "No vendors have quoted for this in Lagos yet",
    );
  });

  it("explains a refusal instead of showing a price", async () => {
    const api: BenchmarkApi = {
      read: vi.fn(async () => {
        throw new BenchmarkError("forbidden", "raw text");
      }),
    };
    render(<BenchmarkPanel categories={["Cakes"]} location="Lagos" api={api} />);

    expect(await screen.findByTestId("benchmark-error")).toHaveTextContent(
      "Market prices are only shown to hosts in a house",
    );
    expect(screen.queryByTestId("benchmark-range")).not.toBeInTheDocument();
  });

  it("says nothing when there is no category or no city", () => {
    render(<BenchmarkPanel categories={[""]} location="Lagos" api={stubApi()} />);
    expect(screen.queryByTestId("benchmark-panel")).not.toBeInTheDocument();
  });
});
