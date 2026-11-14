import { createFileRoute } from "@tanstack/react-router";
import { requestRecoveryAsCaller } from "@/features/funds/server";

// F-109: POST /funds/recovery. Staff ask for money to be taken back from a vendor that did not
// deliver, or for half the cost of a replacement to be advanced to a host out of the recovery
// fund. Asking moves nothing: two distinct staff must approve it first.
export const Route = createFileRoute("/api/funds/recovery")({
  server: {
    handlers: {
      POST: ({ request }) => requestRecoveryAsCaller(request),
    },
  },
});
