import { createFileRoute } from "@tanstack/react-router";
import { aiStatusAsCaller } from "@/features/ai/server";

// F-107 wiring: GET /ai/status. Whether this caller may see OwanbeAI: the zero-retention
// contract must be confirmed and the caller must hold the AI investigation grant.
export const Route = createFileRoute("/api/ai/status")({
  server: {
    handlers: {
      GET: ({ request }) => aiStatusAsCaller(request),
    },
  },
});
