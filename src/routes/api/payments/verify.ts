import { createFileRoute } from "@tanstack/react-router";
import { verifyPaymentReferenceAsCaller } from "@/features/payments/server";

// F-102: the host comes back from the provider with the reference of a charge. The server asks
// the provider what happened, and only a confirmed charge is recorded. A redirect is never
// evidence on its own.
export const Route = createFileRoute("/api/payments/verify")({
  server: {
    handlers: {
      GET: ({ request }) => verifyPaymentReferenceAsCaller(request),
    },
  },
});
