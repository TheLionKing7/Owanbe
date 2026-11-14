# F-14: A host counter starts the vendor's 24-hour response deadline

The F-14 feature spec asks "What stops a vendor from ignoring a counter-offer?"
and answers it: *when a host counters, start a 24-hour vendor response deadline.
If the vendor does not revise or decline by then, expire the quote, release the
date lock, and show the host relevant alternatives.* That answer is now built.

`public.quotes.counter_response_due_at` holds the deadline. It is server time:
`counter_quote` sets it to `now() + 24 hours`
(`app_private.quote_counter_response_interval()`), the same fixed constant as the
offer deadline. No per-vendor or per-category override exists, and the browser
never owns a timer — it renders the deadline the database set.

Two deadlines, one owner each:

- While a quote is `sent`, the deadline the send set (`expires_at`) governs it.
- While a quote is `countered`, the deadline the counter set governs it. The
  original send deadline stops governing the moment the host counters: the
  counter is a fresh question, so the vendor gets a fresh window to answer it.
  A host therefore cannot make a vendor's offer outlive the window they were
  given by countering, and cannot shorten it either.
- The vendor's re-send after a counter clears `counter_response_due_at` and
  restarts the 24-hour offer deadline. A revision that is not re-sent does not
  answer the counter: the vendor has to put the revised offer back to the host.

`quotes_state_shape` now says which deadline governs a quote, so a row cannot
exist in a state where no deadline or the wrong one applies.

When the window closes the quote expires, the date lock is released with
`release_reason = 'expired'`, and the audit row records
`reason = 'vendor_response_overdue'` — distinguishable from an offer that ran
out of time on its own. The host also gets a house alert of kind
`counter_ignored`, so they learn their counter went unanswered rather than
finding a quote that quietly stopped being open.

**Not built:** the "relevant alternatives" the spec mentions. Listing other
vendors for that date needs vendor discovery and a relevance rule (F-13, F-35,
F-27), none of which exist; inventing a "similar vendors" query would be an
unapproved commercial ranking. The host is told the date is free again and that
they can ask the vendor or look for another vendor. This is the same gap
`docs/open-questions.md` Q5 records for F-38.

Verification: `supabase/tests/f14_counter_response.test.sql` (7 sections) is
written to run in the CI database job. It could not be executed on the authoring
machine, which has no PostgreSQL server and no running Docker daemon. Do not
describe the deadline as working until that suite and the audit have run.
