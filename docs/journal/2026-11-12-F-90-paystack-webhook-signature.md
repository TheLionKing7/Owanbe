# 2026-11-12 · F-90 Paystack webhook signature verification

- **Feature:** F-90 Paystack Webhook Signature Verification (`ba0145ee-a7bb-44ec-a547-67ee013e82c6`,
  should, stage `rooms`). Reported built; the 2026-11-13 audit marked it *partial* — "Paystack
  server module and webhook route exist; signature verification unconfirmed", and the audit model
  wrote that the SHA-512 HMAC check "was either bypassed, mocked, or missing an explicit
  constant/header verification in that route".
- **Feature description (Sage 7):** _"Found in audit: src/lib/payments/paystack.server.ts,
  src/routes/api/public/paystack/webhook.ts"_ — an audit-fix feature, with `acceptance_state:
  unconfirmed` and no acceptance criteria of its own.

## What the code already did

The audit's note was not true of the files it cited, and this change adds the evidence so the
next reader does not have to take anyone's word for it:

- `src/routes/api/public/paystack/webhook.ts` reads the **raw** body with `request.text()`, passes
  it with the `x-paystack-signature` header and `PAYSTACK_SECRET_KEY` to `verifyPaystackSignature`,
  and returns `401 "invalid signature"` when that is false — before the body is parsed, before the
  event name is read and before anything is recorded.
- `src/lib/payments/paystack.server.ts` computes the HMAC-**SHA-512** with `crypto.subtle` over the
  raw body, and compares with `timingSafeEqual`. A missing signature or a missing key is refused.

The reason the audit could not see it: **there was no test for the route itself.** The helper was
tested (`src/lib/payments/paystack.server.test.ts`, `src/test/deployment.test.ts`) and the route was
not, so the check that matters was never exercised end to end.

## What this change adds

`src/routes/api/public/paystack/webhook.test.ts` calls the route's own POST handler with real
`Request` objects. Only the database-facing module (`@/lib/payments/router.server`) is mocked; the
signature helper is the real one, so the signature in the test is made by the same code the route
trusts. Five cases:

1. a `charge.success` carrying a genuine signature → 200, the event recorded with its reference,
   amount, currency and booking id, and the reusable card reference saved;
2. a signature made over a **different** body → 401, nothing recorded;
3. a request with **no** `x-paystack-signature` header → 401, nothing recorded;
4. a signature made with **another secret key** → 401, nothing recorded;
5. a correctly signed event that is not about money (`customer.updated`) → 200, nothing recorded.

## Checks run

- `npx vitest run src/routes/api/public/paystack/webhook.test.ts` — 1 file, 5 tests passed.
- `npx vitest run src/lib/payments src/routes/api/public/paystack` — 7 files, 85 tests passed: the
  new mock of the database module does not leak into the neighbouring suites.
- `npx tsc --noEmit` — clean.
- `npx eslint src/routes/api/public/paystack/webhook.test.ts` — clean.

## Not done

The route still trusts `PAYSTACK_SECRET_KEY` from the environment, which the owner sets in
`.env.local`; there is no key rotation procedure and no replay window beyond the provider's own
delivery. Neither is in this feature's scope.
