# Open questions

Unanswered questions that block or shape work. Each entry names the owner, the
affected feature, the status and the release impact. Approved answers move to
`docs/decisions/`.

## F-14 Quote Lifecycle & Date Lock

### Q1. What stops a vendor from ignoring a counter-offer?

- **Owner:** Ola (product owner)
- **Status:** open — asked in the F-14 feature spec, still unanswered
- **Affected:** F-14 (counter path), F-23 Quote Counter-Offer Controls (`planned`),
  F-22 Trust Score System (blocked), F-24 Multi-channel Notification Delivery (blocked)
- **Release impact:** a host can counter, and the vendor's 24-hour clock keeps
  running, but nothing in F-14 pressures the vendor to respond. The quote simply
  expires. No reminder, penalty or ranking consequence was implemented, because
  inventing one would put an unapproved business rule into the database.
- **What was built instead:** the counter is recorded as a host-authored revision
  with a required message, it does not restart the vendor's deadline, and the
  vendor can revise and re-send (which does restart it). That is the whole
  behaviour; the enforcement question is left to F-23/F-22.

### Q2. Where does a vendor get the host house ID to quote for?

- **Owner:** Ola
- **Status:** open — dependency, not a design choice
- **Affected:** F-14 (vendor quote builder), F-19 Unanswered Enquiry Fallback
  (blocked), F-13 Direct Search & Book Flow (blocked)
- **Release impact:** the quote builder at `/vendor/quotes` asks the vendor to
  paste a host house ID, and says on screen why. It also accepts
  `?host=<uuid>&date=<yyyy-mm-dd>` so an enquiry rail can prefill it later. No
  mock enquiry list was built. Until F-19 or F-13 lands, a vendor cannot start a
  quote from inside the product without knowing the host house ID.

### Q3. When does `app_private.member_can` become `app_private.house_can`?

- **Owner:** Ola
- **Status:** open — sequencing
- **Affected:** F-14, F-78 Permission Scoping (`supabase/pending/`)
- **Release impact:** F-78's migration is still pending, so F-14 ships a local
  mirror of the same role matrix under a different name. When the pending F-78
  file is applied, the mirror must be dropped and F-14's policies and functions
  switched to `app_private.house_can` / `require_house_capability`, otherwise two
  copies of the permission rules drift apart.

### Q4. Which vendor services may a quote line name?

- **Owner:** Ola
- **Status:** open — dependency
- **Affected:** F-14 (typed line items), F-5 Unified Vendor House, vendor service
  catalogue (no feature code yet)
- **Release impact:** quote lines are free text with a checked length and a
  non-negative minor-unit amount. There is no catalogue to validate them against,
  so "Best price" or a misspelt service is accepted. Nothing was invented to fill
  the gap.
