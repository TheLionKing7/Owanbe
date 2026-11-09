import { createFileRoute } from "@tanstack/react-router";
import { freezeBookingFundAsCaller } from "@/features/payments/server";

// F-102: an arbitrator holds the money while a dispute is open. The database checks the grant;
// this route grants nothing by itself.
export const Route = createFileRoute("/api/bookings/$id/freeze")({
  server: {
    handlers: {
      POST: ({ request, params }) => freezeBookingFundAsCaller(request, params.id),
    },
  },
});
