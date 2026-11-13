# 2026-11-12 · F-1 Dual workspace switcher (Host ↔ Vendor)

- **Feature:** F-1 Dual Workspace Switcher (`2dad19ba-ae23-4d88-b86d-22fa1849065b`, must, stage
  `rooms`). Reported built; the 2026-11-13 audit marked it *partial* — "Host/vendor routes and
  HouseLayout exist; workspace switcher component unconfirmed".
- **Feature description (Sage 7):** _"A single account can hold a Host workspace and a Vendor
  workspace, with a switcher to move between them; data stays separated by house."_
- **Design notes (Sage 7):** _"Switcher needs unread badges per house; no auto-switch on cross-house
  links, user must confirm."_

## What the audit found, and what was actually there

The audit was right about the component: there was none. What existed was a single link inside the
desktop-only sidebar — `src/layouts/HouseLayout.tsx`, `hidden … lg:flex`, so **on a phone the
account had no way to change house at all** — and it navigated straight across, with no
confirmation, which is the one thing the spec forbids.

## What the feature delivers now

1. **`src/features/workspace/HouseSwitcher.tsx`** — the switcher itself. It lists the caller's own
   houses (`public.my_houses()`), marks the one they are in with `aria-current="page"`, and offers
   the other one.
2. **Confirmation before the house changes.** Choosing the other house opens a dialog that says
   where they are going and what does not move ("Each house keeps its own celebrations, quotes and
   payments, so nothing moves between them and nothing is shared"). The switch happens only when
   the person confirms; cancelling leaves them exactly where they were. The switch is never
   automatic — there is no code path that changes house without that confirmation.
3. **A badge per house.** Each house's unread count comes from that house's own notification
   projection (`public.my_notifications`, the F-38 projection) — the badge says which house is
   waiting and carries nothing from the other one. A house whose alerts cannot be read shows no
   badge rather than blocking the switch.
4. **Visible on small screens.** The switcher replaced the desktop-only link in the sidebar, so it
   renders at every width.
5. **Deep links still resolve to the right house.** The house is in the path (`/host/*`,
   `/vendor/*`), so a link into one house can never land in the other.

## Checks run

- `npx vitest run src/features/workspace` — 1 file, 6 tests passed: both houses listed with the
  current one marked; a badge per house from the notification projection; the confirmation dialog
  opening before any switch and the switch firing only on confirm; cancelling leaving the person
  in place; an account that holds one house only getting no switcher at all; and a house whose
  alerts refuse to load still being switchable, badge-free.
- `npx tsc --noEmit` — clean.
- `npx eslint src/features/workspace src/layouts/HouseLayout.tsx` — the two new files are clean.
  `src/layouts/HouseLayout.tsx` still reports the **five** prettier violations it already carried at
  `HEAD` (the sixth was the old switch link this change removed). A whole-file rewrap was not
  done: it is an unrelated refactor of a legacy file, and CI is disabled (F-80, owner instruction
  2026-11-06).

## Not done, and why

- **No unread badge for chat.** The chat (F-100) carries no read receipts and no per-house unread
  state; the badge counts the alerts the platform already produces. Adding chat read state is a
  change to F-100, not to the switcher.
- **The unread count is only as good as the notifications.** Nothing creates a notification for
  every kind of house event; the badge counts what `my_notifications` returns.
