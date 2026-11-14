# 2026-11-13 · F-107 The contract is read, not assumed

## What the audit said

The 2026-11-14 audit graded F-107 **partial** with one note:

> *"AI profile copy assistant is implemented using @ai-sdk/openai, not full OwanbeAI."* —
> evidence `src/features/vendor-profile/copy.server.ts`, `src/features/vendor-profile/ProfileCopyStudio.tsx`

Two things were true at once, and only one of them was a defect.

**The note's premise is wrong.** The copy assistant does not build a client of its own:
`src/features/vendor-profile/copy.server.ts:5` imports `generateStructured` from
`@/lib/ai/provider.server`, and `@ai-sdk/openai` appears in exactly one place in the whole
repository — `src/lib/ai/provider.server.ts:15`, the platform's one provider. The copy studio
*is* the platform's provider; it is not a bypass of it.

**What the auditor could see explains the note.** The OwanbeAI **console** (`src/routes/ai.tsx`,
`src/features/ai/AiConsolePanel.tsx`, `src/features/ai/console.server.ts`) and the ZDR-gate
migration exist on `develop` only. `main` carries the provider and the payment investigation —
which is exactly what the note describes.

So the audit was not wrong that something is missing. It was reading the branch the console is
not on, and it could not see the part of the feature it had not been shown.

## What reading the tree found instead

Three gaps against F-107's own confirmed acceptance criteria, all inside them.

### 1. The app asserted the zero-retention contract instead of reading it

`src/lib/ai/provider.server.ts` states the rule it owns:

> *"a request marked sensitive is refused while no zero-retention contract is confirmed, so
> payment data cannot leave for a model that has not contracted to keep nothing. **The database
> decides whether the contract is confirmed; nothing here assumes it.**"*

The investigation broke that rule. `src/features/ai/server.ts` passed `zdrConfirmed: true` —
a constant in the file — to the provider. The database was still the authority (the F-107
migration raises `zdr_contract_required` before the payment trail is read), so nothing leaked;
but the app layer told the provider a fact it had not read.

The planner was the second half of the same gap, and a bigger one. `provider.server.ts:57`
defines a sensitive request as one carrying *"payment records, party details"*. The planner's
prompt carries the host's celebration — event type, city, guest count, budget and their own
brief — and it was sent with **no `sensitive` flag at all**. The one surface that puts a host's
party details in front of a model was the one surface the platform's own rule did not cover.

**What changed**

- `src/features/ai/server.ts:250` — `zdrConfirmedAsCaller()` reads
  `public.ai_investigation_status()` with the caller's own token. The row in
  `app_private.ai_settings` is the only truth about the contract, so the app reads it.
- `src/features/ai/server.ts:346` — the investigation refuses **before** the payment trail is
  read when the database says the contract is unconfirmed, and refuses when the answer could not
  be read at all (`null` is not "no", and it is not "yes" either).
- `src/features/ai/server.ts:390` — the provider gets the flag that was read, not a constant.
- `src/features/planner/planner.server.ts:166` — the planner's request is `sensitive: true`.
- `src/features/planner/server.ts:206` — the planner's boundary reads the same status row and
  passes the result down.

**No migration was written.** `public.ai_investigation_status()` already returns the platform's
zero-retention flag and is already granted to `authenticated`
(`supabase/migrations/20261109180000_f107_owanbe_ai.sql:216`). Reusing it keeps this an
application-layer change on a branch whose SQL cannot be applied on this machine — there is no
Postgres 16 here and Docker does not run.

The database gate is untouched and still holds on its own: the F-107 migration raises
`zdr_contract_required` before `ai_payment_log` and `ai_payment_event_log` return anything
(`20261109180000_f107_owanbe_ai.sql:309`, `:379`, `:463`). The app-side check is a second gate,
not a replacement.

### 2. Not every OwanbeAI response wore the label

F-107's first criterion is *"persistent AI labeling shown on all OwanbeAI responses"*. The
shared badge `AiLabel` (`src/features/ai/AiDisclosure.tsx:21`) was on the planner panel, the
copy studio and the investigation panel. It was **not** on the console — and the console is
where an answer is read back after it left the screen.

An answer row showed the surface and the model (`AiConsolePanel.tsx:212` before this change):

```
PAYMENT INVESTIGATION · openai/gpt-6-astra
```

The same answer, read in the investigation panel, wore an **AI investigation** badge. The label
was present on one surface and missing on the other.

**What changed**

- `src/features/ai/console-contracts.ts:107` — `AI_CONSOLE_LABEL` ("AI answers") is the badge
  the console wears on itself.
- `src/features/ai/console-contracts.ts:110` — `AI_ANSWER_LABEL` maps a surface to the label
  that surface's answers wear, taken from the one `AI_DISCLOSURE` definition that already
  exists (`AI investigation`, `AI-written draft`, `AI-generated plan`), with
  `AI_ANSWER_LABEL_FALLBACK` for a surface this build does not know.
- `src/features/ai/AiConsolePanel.tsx:165` — the page badge.
- `src/features/ai/AiConsolePanel.tsx:214` and `:453` — the badge on every answer row, in both
  "what OwanbeAI has answered you" and the staff answer queue.

### 3. The launch gate was still open in the tracker

`LG-01` — *"Zero Data Retention (ZDR) Model Agreement for Payment AI"*, v1, a **hard blocker**
linked to F-107, F-65 and F-46 — sat at `pending_owner_action` even though the owner had
confirmed the contract on 2026-11-10 (Sage 7 question `3e793b14`: *"Lovable has ZDR and gpt also
has ZDR in place so this is okay to function now"*) and the gate had been opened in the database
by `supabase/migrations/20261110203000_f107_open_zdr_gate.sql`.

The owner's confirmation was recorded in the database and in the journal, and never filed
against the tracker's gate. On the owner's instruction the evidence has now been submitted with
`record_gate_status`, moving LG-01 to `in_review`; the owner marks it satisfied.

Two other hard blockers are open and are not this feature's business: `LG-02` (Paystack
non-custodial DVA and transfer operational setup, linked to F-48 and F-60) and `LG-03` (the
₦500,000 dual-approver finance staff assignment, linked to F-47 and F-20). All three are why
`develop` is not promoted to `main` — which is why the console the audit could not find is
still invisible to a reader who only follows `main`.

## What was deliberately left alone

**The vendor copy studio is not marked sensitive.** `src/features/vendor-profile/copy.server.ts`
sends the vendor's own business description to the same provider. The owner's decision
`3081dc4f` approved exactly that use, and the brief is the vendor's own marketing text, which
the platform already holds — it is not a host's party details and not a payment record. Marking
it sensitive would gate a surface the owner approved for use, so it was not changed here. It is
named in this journal because it is the one path that would keep working if the owner ever
closed the zero-retention gate: **that is the owner's call, not this feature's.**

**The guest-facing concierge was not built.** It will be its own feature once F-108 (Ticketing)
has landed.

## Checks actually run

- `npx vitest run src/features/ai src/features/planner` — 14 files / 148 tests passed.
- `npx tsc --noEmit` — clean.
- eslint — clean on `src/features/ai`, `src/features/planner`.
- `npm test` and `npm run test:load` — run at the end of the batch (see the changelog).
- `npm run memory:check` — current.

## What is **not** proven

- **The SQL is still unexecuted.** No migration was written this round, so nothing new is
  unapplied; but the F-107 migrations (`20261109180000`, `20261110203000`, `20261113120000`) and
  their suites have never run against a real Postgres — no Postgres 16 on this machine and
  Docker does not work here. The `ai_investigation_status` read the app now depends on is the
  function the existing migration already creates.
- **The provider is never called with a real key on this machine.** The ZDR refusal is proven
  by the test suite, not by a live call.
- **LG-01 is `in_review`, not satisfied.** Only the owner can close it, and two other hard
  blockers stand in the way of a `develop` → `main` promotion.
