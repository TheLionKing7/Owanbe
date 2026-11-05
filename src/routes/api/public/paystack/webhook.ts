import { createFileRoute } from "@tanstack/react-router";
import { safeEventName } from "@/lib/payments/credential-guard";
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
          // F-60: the signed body is read for its event name and then dropped. It is never stored,
          // never forwarded, and never written to a log — a card payload inside it must not survive
          // this function, so the name is whitelisted to a bare identifier.
          event = safeEventName((JSON.parse(raw) as { event?: unknown }).event);
        } catch {
          return new Response("invalid body", { status: 400 });
        }
        console.info(`paystack webhook received: ${event}`);
        return new Response("ok", { status: 200 });
      },
    },
  },
});
