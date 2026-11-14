import { createFileRoute } from "@tanstack/react-router";
import { readAiAnswersAsCaller } from "@/features/ai/console.server";

// F-107 wiring: GET /api/ai/answers. Every answer OwanbeAI gave, whoever asked for it. The
// caller's token is forwarded to the database, which decides whether they may read it, and the
// read is audited as a sensitive read because an answer may describe money and state.
export const Route = createFileRoute("/api/ai/answers")({
  server: {
    handlers: {
      GET: ({ request }) => readAiAnswersAsCaller(request),
    },
  },
});
