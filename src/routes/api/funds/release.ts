import { createFileRoute } from "@tanstack/react-router";
import { releaseTrancheAsCaller } from "@/features/funds/server";

// F-109 wiring: POST /funds/release. The last 30% of a booking whose completion window has
// closed. The rules decide whether the money may go out, so this is an ask, not a decision.
export const Route = createFileRoute("/api/funds/release")({
  server: {
    handlers: {
      POST: ({ request }) => releaseTrancheAsCaller(request),
    },
  },
});
