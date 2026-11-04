# Owanbe: import, then F-78 Permission scoping and F-79 Deployment

## Before I can start (your actions)
1. Make the GitHub repo TheLionKing7/Owanbe public. You can make it private again once I've imported it.
2. Connect your own Supabase project: Project Settings, then General, then External Supabase, then Connect.
3. When I ask, enter the service role key in the secure form that appears in chat. Please don't paste it into the chat.

## Step 1: Import the existing code
- Download the repo into this project. Leave out repository history and dependencies.
- Keep the homepage exactly as it is. It is treated as finished.
- Keep the TanStack Start setup this project runs on. If the repo uses a different router or entry files, I'll convert them without changing how anything looks.
- Check what F-75, F-76 and F-77 need (setup, Auth0 sign-in, data tables). F-78 depends on them. If any are missing, I'll tell you and set up only the parts F-78 needs.

## Step 2: F-78 Permission scoping
Acceptance criteria from Sage7:
- Permissions match the role matrix for host, vendor owner, vendor staff and support.
- Vendor staff can't change payouts or manage members.
- Every sensitive read by support staff or managers gets logged.

Work:
- Add a `validateToken` server check. It verifies Auth0 tokens (signature, issuer, audience, expiry) and finds the matching app user.
- Add access rules on `memberships`, `staff_grants` and related tables, enforcing the role matrix.
- Add a `sensitive_access_log` table. Sensitive support and manager reads write to it.
- Use `SUPABASE_SERVICE_ROLE_KEY` only in server code, and only after the caller has been verified.
- Add one test per permission rule.

## Step 3: F-79 Deployment
- Set up configuration names: SUPABASE_URL, SUPABASE_PUBLIC_KEY, SENTRY_DSN, STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET.
- Write a runbook covering:
  - separate dev, staging and prod projects, each with its own credentials
  - order of releases: compatible migrations go out before the app update
  - restore and rollback checks before each release
- Separate dev, staging and prod projects have to be created in your Supabase account. I'll document the steps, and you'll need to create those projects yourself.

## Step 4: Report to Sage7
- Report F-78 and F-79 to Sage7 with the changed files and any blockers.

## Open questions from Sage7 (I'll go with these defaults unless you say otherwise)
- Auth0 to Supabase token path: tokens are verified on the server, then database calls run under that verified user.
- Sage7's context is out of date (sources changed after the last compile). I recommend recompiling it in Context Compiler.
