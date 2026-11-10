# Repair SQL installation and planner sign-up

## Changes
- Make both payment SQL scripts safe to rerun: replace existing functions, retain existing tables and records, recreate only the named policies, and guard index creation. Run each script in a transaction so failures do not leave a partial installation.
- Explicitly include professional event planners/managers in the existing Vendor sign-up choice and clarify the Host choice for people arranging client events. Keep the two existing houses and permissions; do not create a third account type or claim unbuilt delegation features.
- Move embedded-preview sign-up/sign-in to the same app opened outside the preview before starting Auth0. Preserve the chosen destination, avoid placing Auth0 login inside an iframe, and offer an explicit open-page link if the browser blocks navigation.
- Document the exact Auth0 preview callback, logout and web-origin entries; do not introduce a broad wildcard or change Auth0 settings without access.

## Verification
- Run existing onboarding/authentication tests and add focused redirect regressions.
- Check sign-up on the current short viewport and a phone, including the outside-preview link and planner choices.
- Test SQL reinstallation on disposable Postgres if available; otherwise report that hosted SQL execution remains unverified.

## Remaining owner actions
- Rerun the corrected combined SQL script in the existing database.
- Add the exact preview URL to Auth0 application settings if it is still rejected. Full registration cannot be verified until Auth0 permits that callback.

## Technical scope
Repairs cover existing F-76/F-7 authentication/onboarding and F-13/F-20/F-21/F-48/F-60 installation scripts. No new dependencies, payment-rule changes, homepage edits, CI activation, or AGENTS.md edits.