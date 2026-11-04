# GitHub audit sync (F-79)

Lovable syncs to `TheLionKing7/owanbe-project-studio`. The included
`mirror-to-owanbe.yml` forwards its `main` history to `TheLionKing7/Owanbe/main`
after every push. Original commit hashes and messages remain intact for Sage7.
It does not deploy the app, apply migrations, or automatically initiate an audit.

## One-time activation

1. In GitHub, create a fine-grained personal access token with access only to
   `TheLionKing7/Owanbe`. Grant **Contents: Read and write** and
   **Workflows: Read and write**, because mirrored commits include workflow files.
   Choose an expiry and renew the token before it expires.
2. In **owanbe-project-studio → Settings → Secrets and variables → Actions**,
   add repository secret **OWANBE_MIRROR_TOKEN** with that token. Do not paste it
   into chat, commit it, or store it in a remote URL.
3. Ensure GitHub Actions is enabled. After the workflows reach the source
   repository, open **Actions → Mirror commits to Owanbe for audit → Run workflow**
   for the first run. Later `main` pushes trigger it automatically.
4. Confirm the run is green and the latest commit hash matches in both repositories.
   Sage7 must continue watching `TheLionKing7/Owanbe/main`.

## Failure handling

- **Non-fast-forward:** the destination has independent history. The workflow
  stops rather than overwriting it. Reconcile the histories in a reviewed merge;
  do not force-push. Make future changes in the Lovable source repository only.
- **Permission denied:** check token expiry, destination access and workflow-write
  permission. Repository branch rules may require an authorized identity or a
  reviewed PR; do not disable protections just to make the mirror green.
- **Source renamed or reconnected:** update the exact source repository guard in
  the mirror workflow, and add the secret to the new source repository.
- **Mirror green, audit missing:** a push is evidence, not an audit. Check Sage7's
  repository subscription and request its audit; this workflow does not report
  that a feature passed.

`verify.yml` runs application tests, a production compilation, and SQL permission
tests against a disposable local database. It uses no hosted Supabase credentials
and performs no deployments. Mirroring is independent of checks so every source
commit remains available to audit, including commits whose checks fail.