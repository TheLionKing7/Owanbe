import { createFileRoute } from "@tanstack/react-router";
import { completeBookingAsCaller } from "@/features/payments/server";

// F-102: the host confirms the celebration happened, and the last tranche is released. The
// database checks that the caller is the host of the booking.
export const Route = createFileRoute("/api/bookings/$id/complete")({
  server: {
    handlers: {
      POST: ({ request, params }) => completeBookingAsCaller(request, params.id),
    },
  },
});
