# F-126: The operations dashboard reads operational records, and only counts

The blueprint asks for a monitoring dashboard that reads operational records
(blueprint/architecture.md §Observability) and names nine things it should show
(blueprint/tech-spec.md §11). This platform can measure five of them today, because the other
four belong to features that are not built. The dashboard therefore does what the records
support and says plainly what it cannot yet measure, rather than showing a short list that
reads like a healthy platform.

**Decisions**

1. **Access is the existing `operations` capability, not a new one.** `operations` already
   exists and already means the platform-operations role (blueprint/tech-spec.md §14:
   "Operations: approvals, disputes, no-shows, replacements, subscriptions, timers and
   monitoring"). F-126 invents no capability and grants no permission that did not exist.

2. **The dashboard returns counters, never money and never people.** The function's result
   carries a key, a label, a count, a sentence explaining the count and a severity. No amount,
   no currency, no party name, no email address, no provider reference and no house identifier
   leaves the database through it. Reading the dashboard is therefore not a way to read a
   booking.

3. **Every read is audited.** The function writes one `observability.viewed` row naming the
   staff grant that was exercised. The grant is the target because there is no row for "the
   dashboard", and the grant is the thing that was actually used.

4. **Severity is a reading rule, not a threshold.** A signal that says money is unaccounted for
   is `critical`; a signal that is a queue of work is `attention`; a signal that only counts
   activity is `info`. No number on the dashboard decides whether money moves.

5. **Error tracking is read server-side and degrades quietly.** Sentry is the approved
   observability tool (ADR-14) and already receives scrubbed browser errors. The dashboard also
   asks Sentry how many unresolved issues it is holding, through the management API, using the
   server-only `SENTRY_AUTH_TOKEN` with `SENTRY_ORG` and `SENTRY_PROJECT`. The token is never
   logged, never returned and never put in a URL. When Sentry is not configured or cannot be
   reached, the dashboard still shows the platform's counters and says that error tracking was
   not available. The count is honest about its cap: Sentry pages its issue list, so the
   summary carries the maximum it counted up to.

6. **The page lives outside both house shells.** Platform staff are not in a host or vendor
   house, so `/observability` stands alone like `/planner`. The database refuses anyone who
   does not hold the capability, and the panel says so.

**What the dashboard cannot show, and why it says so**

Update latency (nothing records it), retry exhaustion (F-73 has no job records), verification
SLA (F-53 has no review queue), scanner conflicts (F-62 is not built), deletion backlog (F-58
is not built) and on-call alert delivery (F-73 owns it, and the blueprint calls it a launch
requirement). The panel lists these by name under "Not measured yet", so a gap is visible rather
than absent.

**Verification**: 22 new application tests passed (the route boundary, the panel and the Sentry
client), the TypeScript check and the lint of the touched files are clean, and the SQL shape
check is clean. The SQL suite itself has **not** been executed: this machine has no PostgreSQL
server and the owner has said Docker does not work on this system. The migration and
`supabase/tests/f126_observability_dashboard.test.sql` are written to be read, not proven to run.
The Sentry management call has never been exercised against a live Sentry project either, for
the same reason: no credentials exist on this machine.
