import { createFileRoute } from "@tanstack/react-router";
import { readBenchmarksAsCaller } from "@/features/benchmarks/server";

// F-106 wiring: POST /api/benchmarks. The caller's token is forwarded to the database, which
// decides whether they may read a market range and publishes it only when two or more vendors
// hold a current price.
export const Route = createFileRoute("/api/benchmarks")({
  server: {
    handlers: {
      POST: ({ request }) => readBenchmarksAsCaller(request),
    },
  },
});
