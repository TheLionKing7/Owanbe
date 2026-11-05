# F-13: in-app chat comes first, under its own feature code

Sage 7 question `9b9bc628` (F-13 Direct Search & Book Flow) was answered by the owner on 2026-11-05:

> "Reassign In-app chat to its own feature code, build it first, then return to F-13"

What this settles:

- **F-13 stays blocked.** It is not to be built as a search-and-book flow on top of a chat that does
  not exist, and it is not to be quietly reduced to "search only" either.
- **In-app chat is a feature in its own right, not part of F-13.** `blueprint/prd.md:68` currently
  folds it into F-13's line ("Search → profile → chat → vendor quote → host acceptance → confirmed
  payment"), which is why the tracker reports F-13's prerequisites as satisfied while no chat exists:
  the capability string `chat` appears in `f77_data_model.sql:120`, `f78_permission_scoping.sql:18` and
  `src/lib/permissions.ts:5`, but there are no `conversations`/`messages` tables, no RPC and no UI. The
  blueprint already designs them (`blueprint/tech-spec.md:87`, route `/h/:houseId/conversations/:id`).
- **The feature code must come from the tracker.** Chat is not yet in the feature map with an `F-` code,
  and the repository rule is that IDs are obtained, never invented from a feature name. Until one is
  assigned, `get_next_task` still returns F-13.

Independent of the ordering decision, two of F-13's named dependencies remain unbuilt and gated:
Payment Router is F-48, blocked behind Q10 (whether Ówàńbè holds money, and under what licence), and
there is no bookings table — today a vendor is secured by `public.accept_quote` plus the F-38
`quote_payment_holds`, not by a booking. "Search → profile → instant book" therefore cannot be
presented as a current capability in any UI.
