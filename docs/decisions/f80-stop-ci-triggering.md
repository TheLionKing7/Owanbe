# F-80: stop triggering CI (owner answer 40cf8a8e, 2026-11-06)

**Status:** in effect. Both copies of the workflow are disabled in GitHub.

## The decision

Question `40cf8a8e-c09a-4ad4-b358-492f2cef8150` asked whether `verify.yml` should also run on pushes
and pull requests to `develop`, now that all new work lands there. The owner answered on
2026-11-06T23:14:17Z:

> We should stop the CI, since its not working, there is no need to be triggering it.

So the answer to the question is **no**: the triggers are not widened. The workflow stops running until
the account billing lock is cleared. This supersedes the earlier plan to add `develop` to
`push`/`pull_request`.

## What was done

The first attempt to disable it was blocked by the host permission classifier as a CI bypass, citing an
earlier owner instruction to run the checks on a suitable machine before merging. Nothing executed and
no workaround was attempted. The owner then authorised it explicitly in chat on 2026-11-07 ("yes
disable the workflow"), and both copies were disabled:

| Repository | Workflow id | State after |
|---|---|---|
| `TheLionKing7/Owanbe` | `406422326` | `disabled_manually` |
| `TheLionKing7/owanbe-project-studio` | `406392296` | `disabled_manually` |

`PUT repos/<repo>/actions/workflows/<id>/disable`, exit 0, state confirmed by re-reading the workflow
list in each repository. The audit mirror (`mirror-to-owanbe.yml`, ids `406422324` / `406392295`) is
**left active** — it is the Sage 7 push-sync mirror, not the CI this decision is about.

`.github/workflows/verify.yml` and `scripts/check-test-files-load.mjs` are **unchanged and kept**: F-80's
audit evidence is the workflow file itself, so deleting it would remove the thing audited as built. The
file still declares `push: [main]`, `pull_request: [main]`, `workflow_dispatch`; GitHub simply will not
run it while disabled.

## To start it again

Clear the account billing lock, then re-enable in each repository (Actions → "Verify application and
database rules" → Enable workflow, or `PUT …/workflows/<id>/enable`). Decide the trigger question at that
point: as written it runs only on `main`, while work lands on `develop`.

## Still true

No CI gate has ever executed. The one dispatch (run `42299060308`, 2026-11-06) failed in 2 s per job with
"The job was not started because your account is locked due to a billing issue." `npm ci`, the test-load
gate, `npm run build` and `bash supabase/tests/run-local.sh` remain unproven in CI and must not be
described as green.