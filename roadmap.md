# Roadmap

- [x] Import Owanbe repo into TanStack Start (homepage unchanged)
- [x] F-78 Permission scoping (database migration pending Supabase connection)
- [x] F-79 Deployment, using Paystack instead of Stripe
- [ ] Apply F-78 migration + add secrets — blocked: owner must connect their Supabase project
- [x] Report F-78/F-79 to Sage7
- [x] Restore original right-side homepage artwork and update category labels
- [x] Add GitHub audit mirroring and verification workflows with activation instructions
- [x] Correct deployment guidance for one hosted Supabase project
- [ ] Activate GitHub audit mirror — blocked: owner must add OWANBE_MIRROR_TOKEN to source repository Actions secrets
- [x] Add Sentry browser configuration, privacy tests and Supabase managed-key compatibility without replacing Auth0
- [ ] Verify Sentry event ingestion — blocked: saved SENTRY_DSN is not yet present in preview runtime
- [ ] Verify Supabase and apply pending migration — blocked: project connection diagnostics report no linked backend
