import { createFileRoute } from "@tanstack/react-router";
import { settleRecoveryAsCaller } from "@/features/funds/server";

// F-109: POST /funds/settle. The money moves. A clawback needs no provider call; an advance
// sends the host a partial refund of the charge they paid, and the provider's own reference for
// it is recorded so the webhook that follows settles nothing twice.
export const Route = createFileRoute("/api/funds/settle")({
  server: {
    handlers: {
      POST: ({ request }) => settleRecoveryAsCaller(request),
    },
  },
});
