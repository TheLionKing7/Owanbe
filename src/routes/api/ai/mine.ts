import { createFileRoute } from "@tanstack/react-router";
import { readMyAiAnswersAsCaller } from "@/features/ai/console.server";

// F-107 wiring: GET /api/ai/mine. The answers OwanbeAI gave the caller. This is not a staff read:
// the database returns only the rows the caller is the actor on.
export const Route = createFileRoute("/api/ai/mine")({
  server: {
    handlers: {
      GET: ({ request }) => readMyAiAnswersAsCaller(request),
    },
  },
});
