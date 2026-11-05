# Vendor profiles: save, publish, public directory (owner request, outside Sage 7 order)

- Owner asked to wire the Profile & Showcase writer end to end. No Sage 7 feature ID was assigned; this touches F-2 (Become a Vendor) and F-5 (Unified Vendor House), both still blocked in Sage 7.
- Database script: `supabase/pending/20261105080000_vendor_profiles.sql` (run once in the SQL Editor).
  - `open_vendor_house` — caller becomes owner of their single Vendor house.
  - `vendor_profiles` — one per vendor house; members read via RLS; writes only via `save_vendor_profile` (requires 'profile' capability).
  - `public_vendor_profiles` — published profiles only, safe columns (no brief).
- App: Vendor house shows "Open your Vendor house" when missing; studio loads/saves drafts, publishes/hides; public `/vendors` and `/vendors/$slug`.
- Open question: homepage "Featured vendors" cards still link to sample IDs (homepage is frozen), so those links show "vendor isn't available".
