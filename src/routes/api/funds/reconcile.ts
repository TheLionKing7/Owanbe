import { createFileRoute } from "@tanstack/react-router";
import { reconcileLedgerAsCaller } from "@/features/funds/server";

// F-109: POST /funds/reconcile. The provider's events against the ledger. The run moves no money
// and repairs nothing: it writes down what disagrees, and a person decides.
export const Route = createFileRoute("/api/funds/reconcile")({
  server: {
    handlers: {
      POST: ({ request }) => reconcileLedgerAsCaller(request),
    },
  },
});
