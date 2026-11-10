import { createFileRoute } from "@tanstack/react-router";
import { investigatePaymentAsCaller } from "@/features/ai/server";

// F-107 wiring: POST /ai/investigate. The caller's token is forwarded to the database, which
// decides whether the payment trail may be read at all. The answer is read-only: it can open a
// case for a person, and it can move no money.
export const Route = createFileRoute("/api/ai/investigate")({
  server: {
    handlers: {
      POST: ({ request }) => investigatePaymentAsCaller(request),
    },
  },
});
