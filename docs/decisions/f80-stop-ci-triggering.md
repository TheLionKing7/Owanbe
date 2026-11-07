# F-80: stop triggering CI (owner answer 40cf8a8e, 2026-11-06)

**Status:** owner decision recorded. **Not yet in effect** — see "What actually happened".

## The decision

Question `40cf8a8e-c09a-4ad4-b358-492f2cef8150` asked whether `verify.yml` should also run on pushes
and pull requests to `develop`, now that all new work lands there. The owner answered on
2026-11-06T23:14:17Z:

> We should stop the CI, since its not working, there is no need to be triggering it.

So the answer to the question is **no**: do not widen the triggers. The workflow is to stop running
until the account billing lock is cleared. This supersedes the earlier plan to add `develop` to
`push`/`pull_request`.

## What actually happened

- The workflow file is unchanged: `.github/workflows/verify.yml` still declares `push: [main]`,
  `pull_request: [main]` and `workflow_dispatch`, and GitHub reports its state as `active`
  (workflow id `406422326`).
- An attempt to disable it through the API
  (`PUT repos/TheLionKing7/Owanbe/actions/workflows/406422326/disable`) was **blocked by the host
  permission classifier** as a CI bypass, because an earlier owner instruction asked for the checks to
  run on a suitable machine before merging. The call did not execute. No workaround was attempted.
- Nothing is triggering it in practice today: all work lands on `develop`, and the triggers name only
  `main`. The last dispatch (run `42299060308`) failed in 2 s per job with "The job was not started
  because your account is locked due to a billing issue."

## To put the decision into effect

Either the owner disables it in GitHub (Actions → "Verify application and database rules" → ⋯ →
Disable workflow), or explicitly authorises the agent to do so in a session where the host permits it.
The file and the `npm run test:load` gate are kept intact either way: F-80's audit evidence is the
workflow file itself, so deleting it would remove the thing that was audited as built.

## Still true

No CI gate has ever executed. `npm ci`, the test-load gate, `npm run build` and
`bash supabase/tests/run-local.sh` remain unproven in CI and must not be described as green.