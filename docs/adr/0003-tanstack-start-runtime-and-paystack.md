# ADR 0003: TanStack Start runtime and Paystack payments

**Status:** accepted by the owner (2026-11-04), and now ratified by Sage 7 itself. The owner
directed that this be committed so Sage 7 records the current runtime and payments provider as
approved architecture; the context v4 sync (`2929081`, compiled 2026-11-04T02:06:19 UTC) rewrote
`AGENTS.md` to say "Web frontend: TanStack Start", "Payments: Paystack" and "Do not introduce a
standalone React/Vite SPA or Stripe because historical excerpts mention them". Reported through
`docs/decisions/` for Sage 7 pickup on push (the Sage 7 MCP was unreachable when this was written).

## Decision
1. **Runtime: TanStack Start**, not the React Router 6 SPA described in ADR 0001.
   - `@tanstack/react-start` 1.168.60 + `@tanstack/react-router` 1.170.41, React 19.2, Vite 8.1, TypeScript 5.8.
   - File routes in `src/routes/`, generated `src/routeTree.gen.ts`; SSR through a **nitro** 3.0 (Cloudflare target) build. `nitro` and `@lovable.dev/vite-tanstack-config` 2.26.5 (which owns the plugin list) are devDependencies — build-time only, nothing from them ships to the browser.
   - Tailwind CSS 4 (`tailwindcss` + `@tailwindcss/vite` ^4.2.1; tokens in `@theme` inside `src/styles.css`, so there is no `tailwind.config.ts`) and the template's shadcn/ui + Radix components in `src/components/ui/`.
   - **Bun** is the package manager (`bun.lock`, `bunfig.toml`; CI pins bun 1.4.4). `package.json` declares no `engines` or `packageManager` field, so nothing enforces bun outside CI — npm still works but resolves a second lockfile. Tests are Vitest 4 (jsdom) plus the Postgres 16 SQL suites in `supabase/tests`.
   - Ported pages keep their React-Router-shaped imports through the compat layer in `src/lib/router.tsx`, so the migration did not rewrite the page components.
2. **Payments: Paystack replaces Stripe** (owner instruction, commit `9b4dec5`).
   - `PAYSTACK_SECRET_KEY` / `PAYSTACK_PUBLIC_KEY` replace `STRIPE_SECRET_KEY` / `STRIPE_WEBHOOK_SECRET`.
   - Webhooks are verified with HMAC-SHA512 over the raw body against the `x-paystack-signature` header, in `src/lib/payments/paystack.server.ts`; the receiver is `POST /api/public/paystack/webhook` and a bad signature returns 401.
   - `checkEnvIsolation()` in `src/config/server-env.ts` requires `sk_live_`/`pk_live_` in production and rejects them anywhere else. **Only the tests call it today** (`src/test/deployment.test.ts`); no route or handler runs it, so a live/test key mix-up is not yet blocked at runtime.

## Why
- **Runtime:** Lovable builds and publishes this project, and its current workspace template is `tanstack_start_ts_current` (`.lovable/project.json`). When the workspace was recreated, `main` was rebuilt from that template root (`4c3b15c`) and the previous history was orphaned. Staying on the platform's template is what keeps the app editable and publishable in Lovable; fighting it would fork the app away from its hosting path. The unrelated histories are expected behaviour of fresh cloud workspaces, and porting files onto the new `main` is the accepted way to move repo-owned artefacts across.
- **Payments:** Paystack is the approved local processor for Nigerian cards, bank transfers and Naira settlement; Stripe Checkout/Connect does not cover the local banking router the platform needs. The owner asked for the switch explicitly, and it is already implemented and tested (`src/test/deployment.test.ts`).
- **CI workflows** (`.github/workflows/verify.yml`, `mirror-to-owanbe.yml`) were built at the owner's explicit request, so they are approved infrastructure, not an unrequested stack addition.

## Consequences
- ADR 0001 is partly overtaken: Tailwind and lucide-react survived, React Router did not; Vitest survived at v4. The **design authority is unchanged** — the owner's mockup and `owanbe-brand-kit` still override the Sage 7 "Aso-Oke Ledger" tokens, and the token *values* were carried into Tailwind 4 `@theme`.
- `AGENTS.md`'s stack table now reads "Web: TanStack Start (React 19 + Vite, SSR through nitro)" and "Payments: Paystack", both pointing at this ADR.
- Anything written against the old SPA layout (lazy SDK split through `vite.config.ts` `PUBLIC_ENV`, `src/test/fakeAuth.tsx`, the `renderApp()` test helper) needs a TanStack equivalent; the deleted UI auth tests must be restored before F-76 can be re-audited on the UI side.
- SSR changes the security model for env handling: `import.meta.env` is public by construction and server names are declared in `src/config/server-env.ts`; the old `PUBLIC_ENV` allowlist no longer exists.

## Still open after this ADR
- **Stripe is not approved and must not be introduced** — in dependencies, spec text, env names, table or function names. The repo now names Paystack everywhere (`AGENTS.md` stack table, `blueprint/*`, `src/config/server-env.ts`, `src/lib/paystack*`); if a later file or sync reintroduces a Stripe reference, treat it as a defect to fix against this ADR, not a new decision to weigh.
- **shadcn/ui + Radix as the ratified component library.** They arrived with the template; ADR 0001 never covered them and `AGENTS.md` requires an owner decision before adding a UI kit. `components.json` ships with empty registries. Owner to confirm or scope back to hand-built components.
- The Sage 7 blueprint (`blueprint/architecture.md`, `blueprint/context.md`, `prd.md`, `tech-spec.md`) named Stripe in 18 places; the repo copy now says Paystack, and `AGENTS.md`'s stack table says Paystack. **`blueprint/` is rewritten by Sage 7 syncs**, so this edit is provisional: the durable fix is `report_decision` (mirrored in `docs/decisions/2026-11-04-tanstack-start-and-paystack.md`) so the next blueprint compile carries Paystack. If a sync restores Stripe, re-apply from this ADR rather than treating the spec as a new decision.

## Alternatives considered
- Rebuild the SPA on the pre-recreate branch and abandon the Lovable workspace: keeps ADR 0001 literally true, but loses the platform the app is hosted and edited on, and discards the rebuilt UI. Rejected — the owner chose to align with the platform.
- Keep Stripe as the recorded provider and treat Paystack as a temporary substitution: rejected. The webhook and env guards are already Paystack-only, and a spec that names an unimplemented provider invites an accidental re-introduction.
