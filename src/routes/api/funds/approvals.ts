import { createFileRoute } from "@tanstack/react-router";
import { decideRecoveryAsCaller } from "@/features/funds/server";

// F-109: POST /funds/approvals. One staff member's decision about a recovery request: approve it,
// refuse it, or withdraw it. The database counts the approvals, and the person who asked for the
// request may not be one of the approvers.
export const Route = createFileRoute("/api/funds/approvals")({
  server: {
    handlers: {
      POST: ({ request }) => decideRecoveryAsCaller(request),
    },
  },
});
