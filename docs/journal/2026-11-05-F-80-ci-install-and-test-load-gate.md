# 2026-11-05 · F-80 CI: install path, and a gate that proves every test file loaded

Two things were asked before F-80 can be called complete. Sage 7 decision `73116bfb` (owner,
2026-11-05):

> "Keep the applied versions and the fix. Before we confirm this as complete, please resolve or
> clearly document the install conflict, and make CI check that all test files load — not just that
> the tests that did load pass."

Sage 7 question `53116a71` was answered the same day: **"Commit .npmrc with legacy-peer-deps=true"**.
This branch does exactly those two things, and nothing else.

## The install conflict, measured rather than remembered

| Fact | Evidence, read today |
|---|---|
| `package.json` pins what the owner chose | `ai@^6.0.184`, `@ai-sdk/openai@^3.0.64`, `@testing-library/dom@^10.4.0` (commit `3d89d2d`) |
| `package-lock.json` matches those pins | resolves `ai` 6.0.323, `@ai-sdk/openai` 3.0.137, `@testing-library/dom` 10.4.2, `vitest` 4.1.12 |
| The peer that aborted `npm install` | `@testing-library/react` declares a `peerOptional` on `@types/react@^18`; this app pins `^19` |
| **`bun.lock` — what CI actually used — is stale** | still records `ai@7.0.162` and `@ai-sdk/openai@4.0.108`, versions the registry does not publish (latest 6.0.184 / 3.0.64). File mtimes: `bun.lock` 2026-11-05 02:21, `package.json` 15:07 |

So the CI break was never only npm's peer graph: `bun install --frozen-lockfile` could not have
produced a tree matching `package.json` even with a working network, because the lockfile pins
versions that do not exist. That is why the application job moved to `npm ci` against
`package-lock.json`, the lockfile that does match.

`bun.lock` was **not** regenerated here. Every registry fetch from this machine fails through the
TLS-intercepting proxy — `bun install` returned `UNABLE_TO_VERIFY_LEAF_SIGNATURE downloading package
manifest ai / @ai-sdk/openai / @testing-library/dom` — and the owner's standing instruction is not to
turn the download security check off. Deleting or hand-editing a lockfile to fake a resolution would
be worse than leaving it, so it is left, flagged as `docs/open-questions.md` Q13.

## What changed

| File | Change | Why |
|---|---|---|
| `.npmrc` | new — `legacy-peer-deps=true` | the owner's chosen fix; the cost (npm stops warning about genuinely incompatible peers) is stated in the file, not hidden |
| `.github/workflows/verify.yml` | application job: `oven-sh/setup-bun` + `bun install --frozen-lockfile` + `bun run test` + `bun run build` → `actions/setup-node` (SHA-pinned, node 22, npm cache) + `npm ci` + `npm run test:load` + `npm run build` | install from the lockfile that matches `package.json`, and run the gate instead of a bare `vitest run` |
| `scripts/check-test-files-load.mjs` | new | the "all files loaded" check |
| `package.json` | added `test:load` | so CI and a person run the identical command |

The `database` job is untouched; it never used bun.

## The gate, and what it can actually see

Measured behaviour on vitest 4.1.12: an unloadable file **does** appear in the JSON report, with
`status: "fail"`, **zero** `assertionResults`, and a `message` naming the resolution error. A check
that only compared files-on-disk against files-in-report would therefore have passed. So the gate
judges four things:

1. every `src/**/*.{test,spec}.{ts,tsx}` on disk appears in the report — catches a crash that
   truncates the report;
2. **every reported file collected at least one test** — this is the case that hid four React suites
   behind "99 tests pass";
3. no failing test, `success: true`, vitest exit code 0, and no result for a file the config does not
   include;
4. the include pattern it mirrors is asserted against `vitest.config.ts` textually — if that pattern
   ever changes shape the script aborts with instructions instead of quietly checking fewer files.

Proved in both directions on 2026-11-05:

- **Negative** — added `src/test/zz-load-probe.test.ts` importing a nonexistent package. vitest's own
  line read `Test Files 1 failed | 15 passed (16)` and the totals still said `134/134 tests passed ·
  0 failed`; the gate then failed with exit 1 on
  `loaded but collected no test: src/test/zz-load-probe.test.ts — Failed to resolve import
  "definitely-not-a-package" …`, plus `success: false` and the nonzero exit. That headline line is
  exactly the trap this closes.
- **Positive** — probe removed, `npm run test:load` (the command CI runs):
  `15 of 15 test files loaded · 134/134 tests passed · 0 failed` → `OK`, exit 0.

The probe file was deleted after the run; it is not in the commit.

## Gates run here, and the ones that were not

| Gate | Result |
|---|---|
| `npm run test:load` | **pass** — 15/15 files, 134/134 tests, 27.7 s |
| negative test of the gate itself | **fails as designed**, exit 1, names the unloadable file |
| `npx tsc --noEmit` | **pass** — 0 errors. The `copy.server.ts` errors from Q11 are gone now that `ai` 6 and `@ai-sdk/openai` 3 are installed |
| `npx eslint scripts/check-test-files-load.mjs`, `npx prettier --check` on the changed files | **pass** — the new script was reformatted to the declared config; eslint and prettier run at all only because the owner's install brought them |
| `npm run build` | **pass** — vite + nitro `.output` built |
| `npm ci` | **NOT RUN.** The registry is unreachable from this machine through the TLS-intercepting proxy and certificate verification was not disabled. `test:load`, `tsc` and `build` all ran against the tree the owner installed *from this lockfile*, so the package set is proven; a from-scratch `npm ci` is not |
| GitHub Actions | **dispatched 2026-11-06, and the jobs never started** — see "First real CI attempt" below. Still no verified run |
| `bash supabase/tests/run-local.sh` | **NOT RUN** — still no `initdb`/`psql` here. The F-14 / F-38 / F-60 SQL suites remain unexecuted everywhere |

## Found while measuring, deliberately not changed

- Repo-wide `npx eslint .` reports **743 `prettier/prettier` errors** (plus 11 `react-refresh`
  warnings), and `prettier --check .` fails, for one configuration reason: `.prettierrc` carries the
  template's `printWidth: 100` while the code in the repo is written to roughly 120 —
  `prettier --print-width 120 --check .` flags 0 files. So CI has no lint/format step: it would be
  red on its first run over formatting, not correctness. Choosing the house width, or rewrapping the
  tree, is a separate decision (Q14). Every file this stack touched is clean at 100 except one line in
  `src/routes/api/public/paystack/webhook.ts` (1 error), left alone so this branch's diff stays about
  CI.
- `.prettierignore` does not list Markdown, so `prettier --check .` also flags documentation files
  (`src/routes/README.md` among them). Same follow-up.

## First real CI attempt (2026-11-06)

Answering the owner's question "is the CI not a github action which is blocked through billing issue?"
with measurement rather than the old note.

- `gh api repos/TheLionKing7/Owanbe/actions/permissions` → `{"enabled":true,"allowed_actions":"all",
  "sha_pinning_required":false}`. The repository has Actions switched on.
- `gh workflow run "Verify application and database rules" --ref develop` → run
  [42299060308](https://github.com/TheLionKing7/Owanbe/actions/runs/42299060308) (run_number 46,
  event `workflow_dispatch`, head branch `develop`). The workflow file parsed and both jobs were
  created, so the YAML — including the new `npm ci` + `npm run test:load` steps — is accepted.
- Both jobs ended `failure` after **2 seconds** with zero steps and no retrievable log
  (`gh run view --log-failed` → `log not found: 128171784442`). The check-run annotation says why:
  **"The job was not started because your account is locked due to a billing issue."** — on
  `application` and on `database`.

So the billing lock is real and is the only thing standing between this branch and a verified run.
Enabled-at-the-repo-level and allowed-to-run-at-the-account-level are different switches. **Nothing in
`.github/workflows/verify.yml` has executed yet**: `npm ci`, the test-load gate, `npm run build` and
`bash supabase/tests/run-local.sh` remain unproven in CI, and none of them may be described as green.

Secondary finding, for the same decision: the workflow triggers are `push`/`pull_request` on `main`
only, while work now lands on `develop` (owner decision `d843e3d7`). Once billing is settled, a commit
to `develop` still would not run it, and `main` currently carries the pre-F-80 **bun** variant of
`verify.yml` (`oven-sh/setup-bun@v2`, `bun install --frozen-lockfile`), which is the version known to
fail on the unpinned AI SDK ranges. Adding `develop` to the triggers is an owner call, not assumed here.

**Answered 2026-11-06T23:14:17Z (`40cf8a8e`): "We should stop the CI, since its not working, there is no
need to be triggering it."** So the triggers are not widened. The first disable attempt was blocked by
the host permission classifier as a CI bypass and did not execute; no workaround was attempted. The
owner then authorised it in chat on 2026-11-07, and `verify.yml` is now `disabled_manually` in both
repositories (`TheLionKing7/Owanbe` id `406422326`, `TheLionKing7/owanbe-project-studio` id `406392296`).
The audit mirror is left active and the workflow file is kept intact. Details in
`docs/decisions/f80-stop-ci-triggering.md`.
