import { createFileRoute } from "@tanstack/react-router";
import { bookingMoneyAsCaller, startBookingPaymentAsCaller } from "@/features/payments/server";

// F-102 wiring: the money of one booking, and the start of a payment. The caller's token is
// forwarded to the database, which decides what they may see and what they may do; the amount
// comes from the database, never from the browser.
export const Route = createFileRoute("/api/bookings/$id/payments")({
  server: {
    handlers: {
      GET: ({ request, params }) => bookingMoneyAsCaller(request, params.id),
      POST: ({ request, params }) => startBookingPaymentAsCaller(request, params.id),
    },
  },
});
