import { createFileRoute } from "@tanstack/react-router";
import { readObservabilityAsCaller } from "@/features/observability/server";

// F-126 wiring: GET /api/observability. The caller's token is forwarded to the database, which
// decides whether they may read the dashboard: a platform staff member holding the existing
// 'operations' capability.
export const Route = createFileRoute("/api/observability")({
  server: {
    handlers: {
      GET: ({ request }) => readObservabilityAsCaller(request),
    },
  },
});
