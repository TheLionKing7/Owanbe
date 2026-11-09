import { createFileRoute } from "@tanstack/react-router";
import { planAsCaller } from "@/features/planner/server";

// F-101 wiring: POST /planner/generate. The caller's token is forwarded to the database, which
// decides whether they may plan; the answer is grounded against the published vendor profiles
// before it is returned.
export const Route = createFileRoute("/api/planner/generate")({
  server: {
    handlers: {
      POST: ({ request }) => planAsCaller(request),
    },
  },
});
