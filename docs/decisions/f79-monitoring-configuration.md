# F-79: Browser monitoring configuration

Use the approved Sentry service's React SDK v10, loaded after hydration, to capture
root-boundary and unhandled browser errors without Node-only server instrumentation.
This preserves SSR compatibility with workerd. Use a strict event-field allowlist
and disable replay, tracing, sessions and automatic breadcrumbs to prevent sensitive
application payloads from reaching monitoring. Expose only the public ingestion DSN
and approved environment label through a read-only server function.

Supabase connection diagnostics currently report no backend linked to this app.
No hosted migrations or authentication settings were changed. The owner must link
the existing project through Project Settings → General → External Supabase → Connect;
then verify the generated configuration before applying the pending migration.
Do not create another hosted database or replace Auth0 sign-in.

Verification: 25 application tests passed and the latest preview compilation is
successful. Sentry project creation and SENTRY_DSN storage succeeded, but the
configuration function currently reports no DSN in the preview runtime, so sample
event ingestion remains unverified. Do not describe monitoring as active yet.