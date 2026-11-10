import { createFileRoute } from "@tanstack/react-router";
import { reportPlanAsCaller } from "@/features/planner/server";

// F-101 wiring: POST /planner/report. One report per answer, recorded against the caller's own
// interaction.
export const Route = createFileRoute("/api/planner/report")({
  server: {
    handlers: {
      POST: ({ request }) => reportPlanAsCaller(request),
    },
  },
});
