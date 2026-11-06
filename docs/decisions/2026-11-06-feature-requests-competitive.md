# Feature requests from competitive review (2026-11-06)

**Status:** requested by the owner and pending Sage 7 intake. They were written here because the Sage 7 MCP was not authorized in the session; per AGENTS.md, files in `docs/decisions/` are picked up on push.
**Requested by:** owner (Ówàńbè). **Prepared by:** Claude (Cowork).

## Competitors reviewed
| | owanbe.app ("Owanbe Central") | OwambeHub (owambehub.ng) | **Ówàńbè (us)** |
|---|---|---|---|
| Positioning | Planner SaaS: "OS for Nigerian event planners" | "Nigeria's Celebration Intelligence Platform": directory, guides, AI | Two-sided celebration commerce: Host and Vendor houses |
| Vendor marketplace | No (vendors only appear in a planner's list) | Directory: 1,800+ listings claimed, 25+ categories | Verified vendors, quotes, bookings |
| Booking / quotes | No | Enquiries only | Quote lifecycle, date lock, booking |
| Payments / escrow | Tracking only | "Vendor wallet" line only | 70/30 escrowed release, refunds, disputes |
| Trust | No | "Verified badge" (paid tier) | NIN/BVN/CAC vetting, trust score, verified-completion reviews |
| Guests / RSVP | No | RSVP and invites claimed | Invitation tiers, claim links, QR/NFC check-in |
| AI | Summaries and drafts | "Ask Owambe AI", AI planner, AI search | OwanbePlanner (budget plan with vendor options), AI payment investigation |
| Culture | No | Cultural guides, news, Aso-Ebi category, Memogram archive | Brand heritage plus planned culture section |
| Pricing | ₦20,000 per event | Vendors: free, ₦10k/mo Pro, ₦20k/mo Premium; 20% affiliate | Vendor subscriptions plus host transaction/AI fees |
| Apps | None | "Coming soon" | Expo app planned |

**Our edge:** we're the only one that completes the transaction. A host can plan, get a quote, book, pay into escrow, get guests in and leave a verified review. Neither competitor moves money or verifies identity. We should lead with *Plan → Book → Pay safely → Celebrate*.

## Requested features (please add to the Sage 7 feature map)
| # | Feature | Source of idea | Priority (proposed) | Why |
|---|---|---|---|---|
| FR-1 | **Planner workspace + client portal:** a professional planner manages several clients' events; each client sees progress, decisions and approvals but never the planner's costs or margins | owanbe.app | should | Turns planners into a supply channel instead of competitors; extends the existing book-on-behalf flow |
| FR-2 | **Shared event-day run-of-show:** one timeline for all booked vendors (decorator, caterer, MC, DJ) with confirmations and day-of updates | owanbe.app | should | Coordination tool that keeps vendors active on the platform after booking |
| FR-3 | **Lead-capture link + pipeline for vendors and planners:** a shareable enquiry link (Instagram bio, WhatsApp) that turns enquiries into tracked deals and conversations | owanbe.app | should | Brings vendors' existing off-platform demand onto Ówàńbè |
| FR-4 | **Aso-ebi ordering:** a host sets the fabric, colour and price; guests order and pay; the vendor fulfils; the host tracks who ordered | OwambeHub (category + "ordering" line) | must (cultural differentiator) | Core Yoruba celebration ritual and a payment flow we can escrow |
| FR-5 | **Celebration memory archive ("Memories"):** a shared guest photo/video album per event, collected through the invitation link | OwambeHub (Memogram) | could | Retention and virality after the event; feeds the media section and Event of the Week |
| FR-6 | **Cultural guides hub:** ceremony guides (introduction, engagement, naming, burial), etiquette and budget benchmarks, plus "Ask OwanbePlanner" about traditions | OwambeHub (guides, Ask AI) | should | SEO, trust and cultural authority; grounds the AI planner |
| FR-7 | **Public budget calculator** (no sign-in) by event type, city and guest count, which hands off to the AI planner | OwambeHub (Budget Calculator) | should | Top-of-funnel acquisition tool |
| FR-8 | **Vendor referral / affiliate programme:** vendors and planners earn fee discounts or commission for referring others | OwambeHub (20% affiliate) | could (Referral Program already in map; extend to planners) | Supply growth |
| FR-9 | **Per-event pricing option** for planners and hosts (flat fee per event, e.g. a ₦20k anchor) alongside vendor subscriptions | owanbe.app | could | Simple, familiar pricing in this market |

## Risks noted
- **Name and domain:** owanbe.app is owned by Owanbe Central Tech Ltd, and OwambeHub uses a close variant. Before launch: confirm the trademark position, choose our own domain, and replace the placeholder `owanbe.app` values in the code (Auth0 claim namespace `https://owanbe.app/*`, audience `https://api.owanbe.app`).
- **Unverified competitor claims:** the counts and features on both sites are marketing copy; we did not test their products.

## Sources
- https://owanbe.app/
- https://owambehub.ng/ and https://owambehub.ng/Pricing
- OwambeHub launch release (Aug 5, 2025): https://stocks.observer-reporter.com/observerreporter/article/marketersmedia-2025-8-5-owambehub-launches-as-nigerias-first-all-in-one-party-and-events-ecosystem
