# 2026-11-09 · F-106 Market benchmark data

- **Feature:** F-106 Market benchmark data (`0ff04bec-31a1-47e2-892e-1c198d574773`, must, category Core
  Workflows, stage `structure`, acceptance state `confirmed`). `get_next_task` served it with no
  dependencies and no open questions, so it was built on its own.
- **Acceptance criteria (confirmed):**
  1. Benchmark data sourced from verified external providers, never fabricated
  2. Data freshness and provenance are logged for audit
  3. Access restricted to planner/analytics consumers only
- The plan was agreed with the owner before any code was written.

## Owner decisions taken before the build (2026-11-09)

1. **Where the prices come from** — "Provenance = quote id + vendor + observed_at = quote sent
   date. Nothing fabricated, no new service needed." The benchmark source is the **verified vendor
   quote**, not an outside price feed: the only price statement the platform can prove is a quote a
   vendor sent, and no new provider was introduced.
2. **Who may read it** — "Add 'analytics' to the platform-staff capability check constraint on
   `public.staff_grants` (a migration), plus the existing planner-host house path." A new
   **`analytics`** staff capability, alongside the F-101 planner Host-house path.
3. **The first consumer** — "Show a market benchmark range with its source, observed_at and
   freshness next to the vendor options in PlannerPanel." The planner panel.

## What the feature delivers

1. **One observed market price per place.** `public.market_benchmarks` holds the price a vendor
   actually asked for: the category and the places from the vendor's own published profile, the
   amount as `price_minor` bigint beside an ISO `currency`, the quote behind it (`source_ref`,
   `source_revision`), the moment it was seen (`observed_at`), and whether the platform publishes
   that vendor (`verification_status`).
2. **A trigger is the only writer.** `app_private.capture_market_benchmark()` fires on
   `public.quotes` when a quote is sent, and takes the newest **vendor-authored** revision — a host
   counter is the host's words, not a vendor price. There is no function that writes a price, so
   there is no path that can invent one.
3. **A range names no vendor.** `public.read_market_benchmarks(categories, location)` gives the
   count, the vendor count, the min/median/max **only when two or more vendors hold a current
   price**, and the window the prices were observed in. With one vendor the prices stay null and
   the panel says "Not enough published prices yet", so a host can never read one vendor's private
   quote back out of an average.
4. **Freshness is relative, and it is audited.** An observation stays current until the same vendor
   states a newer price for the same category, place and currency. The price it replaced is
   audited as `benchmark.superseded` with the id of the observation that replaced it, and the
   history is never rewritten — the table is append-only.
5. **Provenance is behind its own gate.** `public.read_market_benchmark_sources(category, location)`
   shows the vendor, the quote, the revision, the price, the moment it was seen and whether it is
   still current. It needs the **`analytics`** grant; the host-facing read never names a vendor.
6. **The panel beside the plan.** `BenchmarkPanel` renders inside each planner option, with the
   categories that option's vendors are in and the city the host is planning in: the price band,
   the median, the source line ("Prices vendors quoted"), the vendor count and the observation
   window.

## The rules that live in the database

- `public.read_market_benchmarks(p_categories, p_location)` — `authenticated` only. A caller who is
  in no Host house and holds no `analytics` grant is refused (`forbidden: market benchmarks`,
  42501). A quote the vendor withdrew is not a market price, and an unverified vendor's price never
  reaches the range.
- `public.read_market_benchmark_sources(p_category, p_location)` — `authenticated` only, and only
  with an `analytics` grant (`forbidden: analytics grant required`, 42501).
- `public.market_benchmarks` has RLS **enabled and forced**, no policies and `revoke all` from
  `public`, `anon` and `authenticated`: nobody selects the table, and the app's own route forwards
  the caller's token so the database decides.
- `audit_events.action` is checked as `domain.verb`, so the trail reads `benchmark.observed`,
  `benchmark.superseded`, `benchmark.range_read` and `benchmark.sources_read`. The read audits
  name the anchor observation, so a read is as auditable as the write.
- The `analytics` capability is added to `staff_grants_capability_check`; the six capabilities that
  already existed keep their meaning and their scope rules.

## What changed

- `supabase/migrations/20261109160000_f106_market_benchmarks.sql` — the `analytics` capability; the
  `market_benchmarks` table with its append-only trigger and its two indexes; the observation
  trigger on `public.quotes`; the two read functions and the three helpers behind them.
- `supabase/tests/f106_market_benchmarks.test.sql` — 8 sections: a sent quote becomes one observed
  price with its provenance (and one per place the vendor serves); one vendor is not a range; a
  second vendor makes it a range; an unpublished vendor is observed but never counted; a withdrawn
  quote leaves the market; a new price supersedes the old one and the audit says so; the access
  rules (a vendor and a support-only staffer are refused, an analyst is not, `anon` is refused);
  and nobody writes the observations directly.
- `src/features/benchmarks/contracts.ts` — the request schema, the range shape, the source and
  disclosure labels and the freshness wording.
- `src/features/benchmarks/api.ts` — the browser boundary: the route, the refusal copy and the
  range shapes.
- `src/features/benchmarks/server.ts` — the server boundary: the caller's token is forwarded to
  the database; a `sb_secret_` key is refused.
- `src/features/benchmarks/BenchmarkPanel.tsx` — the market range beside a plan's vendors.
- `src/routes/api/benchmarks.ts` — `POST /api/benchmarks`.
- `src/features/planner/PlannerPanel.tsx` — the panel is mounted inside each option, and the
  benchmark API can be injected in tests.
- `src/features/planner/PlannerPanel.test.tsx` — the panel is asked about the option's categories
  and the host's city.

## Checks run

- `npx vitest run src/features/benchmarks src/features/planner` — 9 files, 82 tests passed.
- `npx vitest run` — the whole suite: **42 files, 416 tests passed**.
- `npx tsc --noEmit` — clean.
- `npx eslint --fix src/features/benchmarks src/routes/api/benchmarks.ts src/features/planner` —
  clean afterwards.
- `npx eslint .` — the whole project still reports 777 pre-existing errors in files this feature
  did not touch (`src/test/permissions.test.ts`, `src/test/validate-token.test.ts`,
  `src/test/monitoring.test.ts`). They were left alone: a whole-tree rewrap is an unrelated
  refactor and CI is disabled (F-80, owner instruction 2026-11-06).
- A static shape check over the new SQL (parentheses balanced inside function bodies, string
  literals terminated, dollar quotes closed) — clean. The same check found three real defects in
  F-101/F-102 files that had never been executed, so it was run over the F-106 files too.
- `npm run memory:update` and `npm run memory:check` — the map rows and fingerprints are current.
- `bash supabase/tests/run-local.sh` — **not run**: this machine has no Postgres 16+ binaries and
  the Docker daemon does not work here (the owner stopped it on 2026-11-08), so
  `f106_market_benchmarks.test.sql` has **never been executed**. It needs a machine with
  `initdb`/`pg_ctl`/`psql`, or `PG_BIN` pointing at them.
- CI is **disabled** in both repositories on the owner's instruction (2026-11-06, `40cf8a8e`), so
  no workflow has run for this feature.
- The work is committed as `09a242e` and pushed to both remotes; Sage 7 `report_progress`
  `50850d50-02a4-4b03-b55b-04d80a6d74ca` records F-106 as **awaiting audit**. Only an audit marks
  a feature built.

## Not done / limits

- **The migration has not been applied to any database.** There is no database password or
  connection string in this repository, so the file was written and reviewed but never run.
- **The SQL suite has never been executed.** Every database-side claim in this entry is a claim
  about the SQL, not a test result.
- **A quote is the price statement, not a market index.** A benchmark is what one vendor asked one
  host for. It is a floor and a reference, not a recommended price, and the panel says where it
  came from and when it was seen.
- **A range needs two vendors in the same place and category.** A new market will show "Not enough
  published prices yet" for a long while, and that is the honest answer rather than a made-up
  number.
- **The price band is a total, not a per-guest price.** The quote total is what was observed; the
  panel does not divide it by the guest count, because the quote's own lines say what the total
  covers.
- **An expired or declined quote still counts**; only a **cancelled** quote (the vendor withdrew it)
  leaves the market. A stale price is handled by the freshness window the panel shows, not by a
  threshold nobody has approved.
- **There is no external market-data provider.** The blueprint lists "benchmark sources" as an open
  question, and the owner's answer was to derive the prices from quotes for now. The question is
  recorded in `docs/open-questions.md` (Q17) for a future feature.
- **The `analytics` capability is granted by hand.** The migration adds it to the check
  constraint; nobody in the app grants it, and the analytics panel is not built — the provenance
  read is a database function for platform staff tooling.

## Open questions raised by this build

1. **An external market-data provider.** The PRD and the tech spec both treat "benchmark sources"
   as a policy gate. The owner chose the derived-from-quotes path for F-106, so a paid or
   scraped price feed is still an open decision for a later feature — see
   `docs/open-questions.md` Q17.
