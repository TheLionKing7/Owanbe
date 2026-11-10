import { createFileRoute } from "@tanstack/react-router";
import { safeEventName } from "@/lib/payments/credential-guard";
import { safeAuthorization, verifyPaystackSignature } from "@/lib/payments/paystack.server";
import { recordProviderEvent, savePaymentAuthorization } from "@/lib/payments/router.server";

// Paystack calls this URL. Unsigned or wrongly signed requests are rejected.
//
// The signed body is read for the event name and for a few named fields, and then dropped. It is
// never stored, never forwarded and never written to a log — a card payload inside it must not
// survive this function. Only an allow-listed summary is recorded, and only for the events the
// money path understands.
const MONEY_EVENTS = new Set(["charge.success", "refund.processed", "charge.failed"]);

function field(body: unknown, name: string): unknown {
  if (!body || typeof body !== "object") return undefined;
  return (body as Record<string, unknown>)[name];
}

export const Route = createFileRoute("/api/public/paystack/webhook")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const raw = await request.text();
        const ok = await verifyPaystackSignature(
          raw,
          request.headers.get("x-paystack-signature"),
          process.env["PAYSTACK_SECRET_KEY"],
        );
        if (!ok) return new Response("invalid signature", { status: 401 });

        let event = "unknown";
        let data: Record<string, unknown> = {};
        try {
          const parsed = JSON.parse(raw) as { event?: unknown; data?: unknown };
          // F-60: the signed body is read for its event name and then dropped. It is never stored,
          // never forwarded, and never written to a log — a card payload inside it must not survive
          // this function, so the name is whitelisted to a bare identifier.
          event = safeEventName(parsed.event);
          const body = field(parsed, "data");
          if (body && typeof body === "object") data = body as Record<string, unknown>;
        } catch {
          return new Response("invalid body", { status: 400 });
        }
        console.info(`paystack webhook received: ${event}`);

        if (!MONEY_EVENTS.has(event)) return new Response("ok", { status: 200 });

        const reference = typeof data["reference"] === "string" ? data["reference"] : "";
        const amountMinor = Number(data["amount"] ?? 0);
        const currency = typeof data["currency"] === "string" ? data["currency"] : "";
        const metadata = data["metadata"];
        const bookingId =
          metadata &&
          typeof metadata === "object" &&
          typeof (metadata as { booking_id?: unknown }).booking_id === "string"
            ? (metadata as { booking_id: string }).booking_id
            : null;

        // The allow-listed summary: no email, no card, no customer record.
        const payload: Record<string, unknown> = {
          provider: "paystack",
          status: typeof data["status"] === "string" ? data["status"] : "",
          channel: typeof data["channel"] === "string" ? data["channel"] : "",
        };
        if (typeof data["paid_at"] === "string") payload["paid_at"] = data["paid_at"];
        if (typeof data["refund_reference"] === "string") {
          payload["refund_reference"] = data["refund_reference"];
        }

        try {
          const outcome = await recordProviderEvent({
            eventType: event as "charge.success" | "refund.processed" | "charge.failed",
            reference,
            amountMinor,
            currency,
            payload,
            bookingId,
          });
          // F-60: keep only the reusable reference and display fields of the card.
          if (event === "charge.success" && bookingId) {
            const auth = safeAuthorization(data["authorization"]);
            if (auth) {
              try {
                await savePaymentAuthorization({ bookingId, ...auth });
              } catch {
                // The payment itself is recorded; a missing saved card is not worth a retry storm.
                console.error("paystack webhook: card reference could not be saved");
              }
            }
          }
          return Response.json({ status: "recorded", outcome });
        } catch (error) {
          const message = error instanceof Error ? error.message : "unknown";
          // A half-configured deployment must be told so, and told again: the provider retries.
          if (message.includes("payment_router_not_configured")) {
            console.error("paystack webhook: the payment router is not configured");
            return new Response("payment router not configured", { status: 503 });
          }
          console.error("paystack webhook could not be recorded", message);
          return new Response("could not record", { status: 500 });
        }
      },
    },
  },
});
