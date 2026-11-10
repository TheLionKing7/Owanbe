import { createFileRoute } from "@tanstack/react-router";
import { reportInteractionAsCaller } from "@/features/ai/server";

// F-107 wiring: POST /ai/report. One report per answer, recorded against the caller's own
// interaction. The caller's token is forwarded to the database, which decides.
export const Route = createFileRoute("/api/ai/report")({
  server: {
    handlers: {
      POST: ({ request }) => reportInteractionAsCaller(request),
    },
  },
});
