import { createFileRoute } from "@tanstack/react-router";
import { readAiCasesAsCaller } from "@/features/ai/console.server";

// F-107 wiring: GET /api/ai/cases. The caller's token is forwarded to the database, which decides
// whether they may read the case queue: a platform staff member holding the 'ai_investigation'
// grant. The read is audited.
export const Route = createFileRoute("/api/ai/cases")({
  server: {
    handlers: {
      GET: ({ request }) => readAiCasesAsCaller(request),
    },
  },
});
