import { createFileRoute } from "@tanstack/react-router";
import { claimInvitationAsCaller } from "@/features/tickets/claim.server";

// F-108 wiring: POST /api/invitations/claim. A guest with an invitation link claims it without an
// account: the platform's publishable key acts as the anonymous role and the database decides
// whether the link may be claimed. The phone is stored only as a hash.
export const Route = createFileRoute("/api/invitations/claim")({
  server: {
    handlers: {
      POST: ({ request }) => claimInvitationAsCaller(request),
    },
  },
});
