# F-108: The offline door cache is bounded by the door window

The owner approved this on 2026-11-13, answering `docs/open-questions.md` Q19
("How long may an offline door device keep admitting guests from its cache?").
It is the decision behind the scanner rules in
`src/features/tickets/scanner.ts` and behind the door app in `mobile/src/door/`.

## The rule

A door device may admit a guest from its cache **only** when all of the
following hold:

1. **The platform put the cache there.** The cache carries the moment it was
   fetched (`synced_at`). A device that has never reached the platform has no
   truth to answer with.
2. **The door window is still open.** The window is the grant's own expiry,
   which the platform returns with every cache row as `cache_expires_at`. The
   window is the host's decision, not a number this codebase invented.
3. **The card itself has not expired** (`expires_at`), and the card is not
   marked revoked in the cache.

A cache that fails 1 or 2 answers `needs_sync`: the door tells the operator to
reach the platform and admits nobody.

## Why the window and not a shorter number

The exposure this closes is real and cannot be closed any other way: while a
device is offline it cannot know that the host revoked an invitation. The
bound is therefore the door window itself, and the host is the one who sets it
— the grant's expiry should match the window in which the door is open. Inside
that window a revocation takes effect at the device's next sync; it cannot take
effect while the device is dark.

No threshold was invented for this. Anything shorter (an hour, a number of
admissions, a count of syncs) would be a number nobody approved.

## Reconciliation

The door has one action for this: **sync the door**. It sends the waiting
check-ins to the platform and fetches the guest list again, in that order, and
records the new `synced_at`. There is no separate "refresh the list" and
"send the queue" button, because a device that refreshed the list but never
sent its queue would keep a guest list the platform does not agree with, and
one that sent the queue but never refreshed would keep admitting on a list the
platform has already changed.

The platform's answer always wins when the platform can be reached. The cache
only ever answers when it cannot.

## What this leaves open

- While the device is offline, a revocation is not visible to it. The window is
  the bound on that exposure, and the host controls the window.
- A device that was offline and comes back is only in step again after it has
  synced. The door says so on the screen rather than pretending.

## Verification status

The rules are covered by `src/features/tickets/scanner.test.ts`. The phone app
has never been installed or run on a device (the npm registry is unreachable
from the authoring machine), so the door's behaviour is code only until it runs
on a real phone against a real platform.
