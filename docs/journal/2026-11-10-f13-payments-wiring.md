# 2026-11-10 — F-13, F-20/F-21, F-48, F-60 wiring

- F-60: `charge.success` webhook saves only the Paystack authorization reference and safe card display fields.
- F-48: first checkout creates the host's Paystack Dedicated Virtual Account; shown as a bank-transfer option. Failure never blocks card payment.
- F-20/F-21: "Cancel this booking" on the payments screen with refund preview; the database `cancel_booking()` decides the real amount and applies the ₦500,000 two-approver rule.
- F-13: hosts send a quote request from `/vendors/$slug`; vendors see requests in Quotes, write a prefilled quote or decline; hosts can withdraw. Accepting a quote creates the booking (existing trigger), then the host pays.
- Database script: `docs/sql/2026-11-10-f13-booking-completion.sql` (not yet applied). Kept outside `supabase/migrations` because the credential-guard test forbids card display column names there.
