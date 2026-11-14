import { createFileRoute } from "@tanstack/react-router";
import { allocateSplitAsCaller } from "@/features/funds/server";

// F-109 wiring: POST /funds/allocate. The split of a booking total, as the database calculates
// it. Nothing moves here: the 70/30 rule and the fees of each tranche live in the database, and
// the caller never supplies them.
export const Route = createFileRoute("/api/funds/allocate")({
  server: {
    handlers: {
      POST: ({ request }) => allocateSplitAsCaller(request),
    },
  },
});
