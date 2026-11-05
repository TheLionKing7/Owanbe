# F-80: CI installs with npm, and must prove every test file loaded

Owner decisions applied 2026-11-05, both recorded in Sage 7 (`53116a71` answered, `73116bfb`
confirmed):

1. **`.npmrc` carries `legacy-peer-deps=true`.** Chosen over pinning/overriding the conflicting peer.
   Accepted cost: npm stops warning when a dependency genuinely is peer-incompatible, so
   `package-lock.json` — not the peer graph — is the authority on what a CI install produces. Keep the
   versions the owner pinned (`ai@^6.0.184`, `@ai-sdk/openai@^3.0.64`, `@testing-library/dom@^10.4.0`).
2. **CI checks that all test files load, not only that the loaded tests pass.** A `vitest run` prints
   the passing total even when a file never collected, which is how "99 tests pass" once hid four
   React suites that were missing a peer dependency. `scripts/check-test-files-load.mjs` is the gate;
   it fails a suite that collects zero tests, a file present on disk but absent from the report, an
   unhandled error outside any test, and a nonzero vitest exit.

Consequential and still open: the application job no longer uses bun, because `bun.lock` pins AI SDK
versions the registry does not publish and cannot be regenerated from a machine whose registry access
is intercepted. `bun.lock` is left untouched pending an owner call — regenerate it with real registry
access or drop it and lose the 24-hour `minimumReleaseAge` supply-chain guard it enforces (Q13). CI has
no lint or format step because `.prettierrc` declares `printWidth: 100` while the code is written to
roughly 120 (Q14); adding one would fail on formatting, not correctness.

Verification actually run on 2026-11-05: `npm run test:load` (15/15 files, 134/134 tests), the gate's
own negative test against a deliberately unloadable file (exit 1, file named), `npx tsc --noEmit` (0
errors), `npm run build` (green). `npm ci` and GitHub Actions were **not** run — registry blocked here,
account behind a billing lock — so do not describe CI as green until a workflow has executed.
