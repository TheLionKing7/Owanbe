import { createFileRoute } from "@tanstack/react-router";
import { verifyPaystackSignature } from "@/lib/payments/paystack.server";

// Paystack calls this URL. Unsigned or wrongly signed requests are rejected.
// Event handling (charges, transfers) lands with the payments features.
export const Route = createFileRoute("/api/public/paystack/webhook")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const raw = await request.text();
        const ok = await verifyPaystackSignature(raw, request.headers.get("x-paystack-signature"), process.env["PAYSTACK_SECRET_KEY"]);
        if (!ok) return new Response("invalid signature", { status: 401 });
        let event = "unknown";
        try {
          event = String((JSON.parse(raw) as { event?: unknown }).event ?? "unknown");
        } catch {
          return new Response("invalid body", { status: 400 });
        }
        console.info(`paystack webhook received: ${event}`);
        return new Response("ok", { status: 200 });
      },
    },
  },
});
