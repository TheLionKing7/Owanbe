# 2026-11-12 · F-23 Counter-offer embedded in the chat thread

## What the audit found

The audit on the F-23 claim graded the feature **partial**: *"QuotesPanel, QuoteCard,
QuoteBuilder exist; counter-offer controls unconfirmed"*. The three files it cited are
real and they do offer a counter — but that counter lives in the quotes panel, one
screen away from the conversation it belongs to. The F-23 design note says
*"Counter-offer embedded as structured message within chat"*, and nothing in the repo
made the offer and the conversation one history: a host could write "can you include
the lighting?" in the thread and counter the same offer in the panel, and the two
events had nothing to tie them together. Nothing in the chat thread knew a quote
existed.

## What was delivered

- `supabase/migrations/20261112110000_f23_counter_offer_in_chat.sql`
  - **A message says what it carries.** `public.messages` gains `kind` (`text`,
    `document`, `quote_offer`, `counter_offer`), `quote_id` and `revision`, with
    `messages_quote_shape` insisting that a structured message points at both a quote
    and a revision, and that a plain message points at neither. `messages.quote_id` is
    deliberately **not** a foreign key: `public.messages` is append-only, so a
    cascading delete would raise the append-only trigger instead of removing the row.
  - **A revision knows the thread it was made in.** `public.quote_revisions` gains
    `conversation_id` (a plain uuid, same reason). `public.counter_quote` is re-created
    with a fourth argument `p_conversation`: it resolves the thread (a named thread must
    be this quote's thread, otherwise `forbidden: conversation`; an unnamed counter
    lands in the pair's thread), inserts the host's revision **with** that thread, sets
    `status = 'countered'`, `current_revision` and — unchanged from F-14 —
    `counter_response_due_at = now() + app_private.quote_counter_response_interval()`,
    and posts a `counter_offer` message into the thread carrying the host's words and
    the revision they made. The audit row records `quote.countered` with the thread.
  - **The vendor's offer is announced too.** `public.send_quote` finds the pair's
    conversation and, when there is one, posts a `quote_offer` message. No thread, no
    message: the quote still stands on its own. The date lock, the offer deadline and
    the clearing of the counter window are untouched.
  - **`public.thread_quotes(p_conversation)`** — the new projection the thread reads:
    the pair's quotes with their status, deadlines, version, which side is the vendor's,
    and their revisions as jsonb. Only a participant may read it
    (`app_private.load_conversation`), and **only an offer that was sent** — a draft is
    the vendor's own business until they send it, so it never reaches the thread. It
    runs `app_private.apply_expiry` for both houses first, so the deadline the reader
    sees is the one the database holds.
  - `public.conversation_messages` is re-created to carry `kind`, `quote_id` and
    `revision`; `public.send_document` now writes `kind = 'document'`.
  - **F-60's rule is honoured in the same migration**: *"The next feature that adds a
    free-text column a person can type into adds it to this list, in the same
    migration."* A counter's words are typed by a person and land in `public.messages`,
    so `messages_body_no_credentials` covers the chat body too.
- `src/features/chat/contracts.ts`: `MessageKind`, `ThreadQuote`, `ThreadQuoteRevision`,
  `ConversationThread.quotes`, and the helpers `threadRevision` (the revision a
  structured message points at) and `liveThreadQuote` (the quote still open — `sent` or
  `countered`).
- `src/features/chat/server.ts` and `src/features/chat/api.ts`: the thread reads
  `conversation_messages`, `conversation_attachments` and `thread_quotes` together and
  returns the quote alongside the messages.
- `src/features/chat/ThreadQuoteCard.tsx`: the live quote band inside the thread. The
  host gets "Counter this offer", writes what would change, and sends it into the
  thread; the vendor sees the offer, its deadline and a note that the counter will
  come back through this thread. The countdown is rendered from the server deadline —
  the counter deadline while the quote is countered, the offer deadline otherwise.
- `src/features/chat/ChatThread.tsx`: the band is mounted between the header and the
  messages, the structured messages render as quote cards ("Offer sent" / "Counter
  sent" with the revision's title and total), and the quote can be countered in place.
- `src/features/quotes/api.ts`: `QuoteApi.counter` takes the thread, so the same
  counter works from the panel and from the thread.
- `supabase/tests/f23_counter_offer_in_chat.test.sql`: 7 sections over its own
  fixtures (a host, two vendors, an outsider).

## How it was checked

- `npx vitest run src/features/chat`: 5 files / 63 tests passed (7 new for the
  counter-offer, plus the existing chat suites).
- `npx vitest run` (whole suite): 57 files / 529 tests passed.
- `npx tsc --noEmit`: clean.
- `npx eslint src/features/chat src/features/quotes/api.ts`: clean.
- `node scripts/sql-shape-check.mjs` on the new migration and the new suite: shape OK.
- `npm run memory:check`: ✓ memory bank current.
- **Not run here:** `supabase/tests/run-local.sh`. This machine has no PostgreSQL
  server and the owner has said Docker does not work on this system, so the SQL suite
  could not be executed. It runs in the `database` job of `.github/workflows/verify.yml`,
  which installs PostgreSQL 16 and applies every migration to a disposable database.
  The SQL in this change is therefore **unexecuted**: it has been written to be read,
  not proven to run.

## Not done, and why

- **The vendor does not revise from the thread.** The spec says *"the vendor must issue
  a revised quote, which the host can then accept or decline"*, and the vendor's
  revision is authored in the quotes panel (`QuoteBuilder`), where the price and the
  line items are edited. The thread shows the revision coming back — a `quote_offer`
  message with the new revision and total — but the vendor does not edit the offer in
  the thread itself. Building a second authoring surface would duplicate the pricing
  rules, and the quote's price is the vendor's alone to set.
- **A counter is still authored by the host** (`authored_by_role = 'host'` on the
  revision). That is the pre-existing F-14 behaviour, kept deliberately: the counter
  records the host's words against the current offer and does not restate the price.
  The vendor's exclusive right to author the *price* is untouched — `send_quote`
  remains the only way a number becomes an offer.
- **Accepting and declining stay in the quotes panel.** The thread shows the quote and
  its deadline; it does not add a second set of accept/decline buttons, because the
  decision carries the payment and booking consequences F-13/F-38 own, and one place
  to make it is safer than two.
- **No round limit.** The owner's answer in the feature's technical notes is *"Allow
  host counters while the quote thread is active"*, so a counter is refused once the
  quote is accepted, declined or expired, and repeated counters are allowed while it is
  open. Each counter starts a fresh vendor window, and the vendor's re-send is what
  ends it.
- **The draft offer never reaches the thread** — `thread_quotes` filters on
  `sent_at is not null`. That was a real leak while the projection was being written:
  the vendor's unsent draft would have shown its total to the host.

## Open

- The SQL suite has not run. F-23's counter is unverified until the CI database job
  and the audit have run.
