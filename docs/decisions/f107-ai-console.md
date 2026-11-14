# F-107: A case the AI opened can now be worked

F-107 gave OwanbeAI a way to open a case and a way to answer a question, and it granted
`public.read_ai_cases` and `public.my_ai_interactions` to the `authenticated` role. Nothing in
the application called either function, and no function anywhere moved `public.cases.status`. A
case OwanbeAI opened therefore sat at `open` forever, and the only surface that showed OwanbeAI
at all was the panel mounted inside a **host house's** payments panel — so a staff member holding
the `ai_investigation` grant who was not in a host house had no way to reach it.

This record is the decisions behind the console that closes that gap.

**Decisions**

1. **The console is a staff surface, and the grant is the staff check.** The console reads the
   case queue and the answers behind the existing `ai_investigation` capability, which F-107
   already defined as a **platform-staff** capability — not a house capability. No new
   capability was invented for the console, and the database refuses a caller without it
   (42501 `forbidden: ai_investigation grant required`).

2. **The console lives outside both house shells, like `/observability`.** Platform staff are
   not in a host or vendor house. `/ai` is a standalone page with `RequireAuth`, so a grant
   holder does not need a house to see the queue. The database, not the page, decides.

3. **Working a case changes the case and nothing else.** `public.update_ai_case` writes the
   case's status and, optionally, a note. It touches no ledger, no fund pool, no booking and no
   payment. The SQL suite asserts it: a case worked from `open` to `closed` leaves the fund and
   the booking exactly as they were.

4. **The database owns the transition rule.** `app_private.ai_case_may_move(from, to)` is the
   single place the legal moves are written. The app mirrors the same table so the form only
   offers a move the server will accept — a mirror, not an authority. A move the console offers
   and the database rejects is a disagreement, and the database is right.

5. **A refused move writes nothing.** An illegal transition, an unknown status, an unknown
   case, an empty note and a note carrying a card-like number are each refused *before* any
   write. No status change, no note row, no audit row. The suite asserts the audit trail still
   holds exactly the moves that succeeded.

6. **Every read is audited; the answer read is a sensitive read.** Reading the case queue
   writes `ai.cases_viewed` against the grant id. Reading the answers writes a `sensitive.read`
   row against `ai_interactions`, with a purpose and the grant id — a list read has no single
   row to point at, so the grant is the target, exactly as `app_private.log_sensitive_read`
   does elsewhere.

7. **The note's text never reaches the audit trail.** The `ai.case_updated` row records the from
   status, the to status and the **length** of the note. `audit_events.details` holds identifiers
   only, so the note stays on the case where a person wrote it.

8. **The AI's own identity gets no path in.** F-46's `investigation_only` role has no
   `EXECUTE` on any of the console functions and no table grant on `cases`, `ai_interactions` or
   `ai_case_notes`. The console belongs to a person, not to the AI.

9. **Your own answers are readable by you, without the grant.** `public.my_ai_interactions()`
   returns the caller's own answers and nobody else's, with the request summary and the model
   that answered — so "what did the AI tell me?" is answerable by the person who asked, which is
   the whole point of the AI disclosure and the report control.

10. **The console names what it does not do.** The disclosure on the page says it plainly:
    *"OwanbeAI's own records. Working a case changes the case and nothing else: no payment, no
    hold and no booking is touched."*

**What the console still does not do**

It does not move money, it does not notify anyone (the house alert on a case move belongs to
the feature that owns notifications), it does not re-run an investigation, and it does not
resolve a dispute — F-16 owns the dispute flow and will extend the same `cases` table rather
than re-create it.

**Verification**: the console's application tests (server boundary, browser boundary and the
panel) pass, the TypeScript check and the lint of the touched files are clean, and the SQL
shape check is clean. The SQL suite itself has **not** been executed: this machine has no
PostgreSQL server and the owner has said Docker does not work on this system. The migration and
`supabase/tests/f107_ai_console.test.sql` are written to be read, not proven to run.
