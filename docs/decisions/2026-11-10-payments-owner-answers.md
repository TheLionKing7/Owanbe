# Payments owner answers — 2026-11-10

Answers Q10 and the spec's open payment decisions.
- Custody: wallets are shown on the platform; funds sit in Paystack / platform pool accounts. The router only sends instructions to Paystack.
- Host cancellation: >30 days 80% back (20% vendor forfeit); 14–30 days 50%; <14 days 0%. Vendor cancellation: 100% back.
- Paystack Dedicated Virtual Account: created on the user's first checkout.
- Refunds above ₦500,000 need two distinct finance approvals.
- AI: read-only for payments (monitoring and troubleshooting). Multiple zero-retention models with automatic fallback.

Built: docs/sql/2026-11-10-cancellation-tokens-dva.sql (cancel_booking, approve_cancellation_refund, payment_authorizations, dedicated_accounts), src/lib/payments/cancellation.ts, Paystack createDedicatedAccount/safeAuthorization, AI model chains. Not yet: cancel buttons on booking screens, webhook saving card references, wiring DVA creation into checkout.
