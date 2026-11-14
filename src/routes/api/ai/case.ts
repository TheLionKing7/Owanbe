import { createFileRoute } from "@tanstack/react-router";
import { updateAiCaseAsCaller } from "@/features/ai/console.server";

// F-107 wiring: POST /api/ai/case. Working a case: the status it moves to and the note about
// why. The caller's token is forwarded to the database, which checks the 'ai_investigation'
// grant, the move itself and the note, and writes the audit row. Nothing here moves money.
export const Route = createFileRoute("/api/ai/case")({
  server: {
    handlers: {
      POST: ({ request }) => updateAiCaseAsCaller(request),
    },
  },
});
