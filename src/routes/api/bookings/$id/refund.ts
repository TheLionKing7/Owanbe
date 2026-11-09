import { createFileRoute } from "@tanstack/react-router";
import { refundBookingAsCaller } from "@/features/payments/server";

// F-102: the host asks for the money back. The database records the obligation and decides who
// may ask; the provider moves the money afterwards.
export const Route = createFileRoute("/api/bookings/$id/refund")({
  server: {
    handlers: {
      POST: ({ request, params }) => refundBookingAsCaller(request, params.id),
    },
  },
});
