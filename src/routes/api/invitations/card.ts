import { createFileRoute } from "@tanstack/react-router";
import { readGuestCardAsCaller } from "@/features/tickets/claim.server";

// F-108 wiring: POST /api/invitations/card. The guest reads their own card with their own
// session, so no account is needed and nobody else's card can be read.
export const Route = createFileRoute("/api/invitations/card")({
  server: {
    handlers: {
      POST: ({ request }) => readGuestCardAsCaller(request),
    },
  },
});
