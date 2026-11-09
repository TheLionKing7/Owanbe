# 05 · Design system

## Authority (owner-confirmed in Sage 7; ADR 0001)
1. The owner's homepage mockup: `docs/design/homepage-mockup.png` (1536×1024). The homepage reproduces it.
2. The brand kit: `owanbe-brand-kit/` (logos, icons, patterns, `tokens/`).
3. The Sage 7 "Aso-Oke Ledger" tokens in `blueprint/design-system.md` are **overridden** where they conflict (orange primary, Fraunces/Source Serif). Their structural rules still apply: 48px tap targets, a focus ring on every control, and empty, loading and error states for every view.
4. The rebuild brought **shadcn/ui** (`src/components/ui`, 45 generated components, style `new-york`) plus Radix primitives. Nothing in `08` approves a UI kit, and `AGENTS.md` forbids adding one without an owner decision — the homepage deliberately does not use them; house pages currently do not either. Ask the owner to ratify or strip them (see `09`) before building new screens on those components.

## Tokens — Tailwind 4, declared in `src/styles.css` (there is **no** `tailwind.config.ts`)
`@import "tailwindcss" source(none);` + `@source "../src";` + `@import "tw-animate-css";` then one `@theme` block; a second `@theme inline` maps the shadcn semantic vars (`--color-background/foreground/primary/muted-foreground/border/input/accent`) onto the `:root` values (`--background #fff6ee`, `--foreground #1c1224`, `--primary #410b52`, `--accent #f3e8f7`, …).

| Token (Tailwind class form) | Value | Use |
|---|---|---|
| `cream` / `cream-50/100/200` | #FFF6EE (#FFFBF7 / #FFF6EE / #FDEFE4) | page background; radial pink/peach washes are fixed on `body` |
| `plum-950` / `plum-900` | #1E0A2B / #2A0F38 | headline ink |
| `plum-800` (+ `-700` #4F0E63) | #410B52 | primary buttons, `btn-primary`, shadcn `--primary` |
| `plum-600` | #5C1272 | wordmark, links |
| `plum-500` / `plum-100` | #6B1E8E / #F3E8F7 | "Celebrate." accent / soft fill |
| `gold` (+ `gold-300` #FFD27A, `gold-100` #FDE7B5) | #F8AC00 | CTA, stars, badges, focus outline |
| `ink` / `ink-muted` / `ink-subtle` | #1C1224 / #62566E / #9A90A3 | body, secondary, tertiary text |
| `cat-venues` `cat-catering` `cat-decoration` `cat-photo` `cat-fashion` `cat-music` | #FCB10C · #073891 · #FB6335 · #0587B5 · #E30974 · #168AA1 | category icon circles |
| `verified` | #0A3BD6 | vendor verified badge |
| `owanbe-royal-purple` `owanbe-sun-gold` `owanbe-yoruba-blue` `owanbe-emerald-green` `owanbe-vibrant-red` `owanbe-fuchsia-pink` `owanbe-cream` `owanbe-charcoal` | #4B2E83 · #F7B500 · #0088A8 · #0E7D6B · #E63946 · #D81B8D · #FFF9F0 · #1A1A1A | brand-kit palette, reserved for brand assets |

- **Fonts**: `--font-display` = "Playfair Display" 600–800 (headings), `--font-sans` = Figtree 400–700 (UI, with Montserrat/system-ui fallbacks). They load from Google Fonts via links in `src/routes/__root.tsx` (the old `index.html` is gone), with preconnects.
- **Shadows**: `--shadow-card`, `--shadow-search`, `--shadow-pill`. **Radii**: `--radius-4xl` = 1.25rem (also sm/md/lg/xl/2xl/3xl). **Page width**: `--container-page` 1536px → `max-w-page`.
- **Component classes**: no longer `.btn-primary` CSS rules — Tailwind 4 `@utility btn-primary`, `@utility btn-outline`, `@utility surface`, used as bare class names (`className="btn-primary h-12 px-6"`).
- Base layer: body gets `bg-cream font-sans text-ink antialiased` + the fixed radial gradients; `:focus-visible` outline `#F8AC00`; `prefers-reduced-motion` honoured globally.

## Homepage layout (`src/pages/Home.tsx` + `src/components/home/*`)
`SiteHeader` floats over the hero at wide sizes → `Hero` (photo `public/images/hero.webp` right, left fade mask, preload in the route) → `FeatureStrip` → the three-column band `lg:grid-cols-[minmax(0,290fr)_15fr_minmax(0,793fr)_23fr_minmax(0,351fr)]`, `xl:auto-rows-[318px]` (`ExploreCategories` · `FeaturedVendors` · `DifferenceCard`) → `AnkaraBand` → fixed `HelpButton` pill. Below `lg` it stacks. `src/data/home.ts` holds nav, categories and placeholder vendor copy.

## Messaging UI pattern (F-100, `src/features/chat/`)
The chat thread follows the familiar messaging-app shape, built only from the tokens above — no new library, no hardcoded colours:
- The thread is a fixed-height card (`max-h-[calc(100vh-11rem)] min-h-[30rem]`, `rounded-3xl`, `shadow-card`): a header row (avatar initial, counterparty name, privacy line), a scrolling message area on `bg-cream-100`, and a composer pinned to the bottom.
- The caller's own message is a right-aligned bubble (`ml-auto`, `bg-plum-950 text-cream-50`, `rounded-br-md`); the other side is left-aligned (`bg-white text-ink`, `rounded-bl-md`, hairline border). A `<Check>` marks a message the caller sent.
- Days are separated by a centred `chat-day` label ("Today", "Yesterday", else the date).
- The composer auto-grows, sends on Enter (Shift+Enter adds a line) and carries a paperclip menu offering **document** or **photo**. A chosen file waits as a chip above the composer and can be removed before sending.
- A shared document is a card in the bubble (file name, kind label, size, open action); a shared photo renders inline as an image.
- The conversation list (`ChatPanel`) uses the same card and radius, one row per conversation with an avatar initial, the counterparty name, the time and a preview. A message that carries only a document previews as "Sent a document".

## Planner UI pattern (F-101, `src/features/planner/PlannerPanel.tsx`)
The planner is a form that becomes an answer, built only from the tokens above — no new library, no hardcoded colours:
- The form is a `surface` card: celebration type, city, guest count, budget with a currency select (NGN, GBP, USD, EUR), and the brief. A **persistent** `AI-generated plan` badge sits on the form itself, so the disclosure is on the page before any answer exists.
- Each option carries its own disclosure line (`Option 1 · AI-generated plan`) next to the title, so a screenshot of one option still shows the label.
- Grounding is stated, not hidden: a note under the plan says how many vendors could not be confirmed and were left out, and how many prices could not be read from the vendor's own note.
- Every vendor line shows the price label (`PRICE_UNKNOWN_LABEL` = "Price unknown — request a quote" when the vendor published no readable price), the availability label (always unknown — the platform holds no per-date calendar) and the budget fit ("Within your budget" / "Above your budget" / "Budget fit unknown", unknown when the currencies differ).
- The answer ends with "This is a starting point, not a quote." and a **Report this answer** control: a category select (wrong facts, not relevant, missing vendor, price or availability, harmful, other), an optional note, submit and cancel, and a thank-you state once the report is recorded.
- States: `planner-loading` (button busy), `planner-error` (the brief stays in the form so the host can retry), `planner-no-options` ("nothing to build on yet" with the empty-plan copy).

## Assets
- `public/images/`: `hero.webp`, `vendor-1..3.webp`, `cta.webp`, `ankara-band.webp`, `owanbe-logo-wordmark.webp` (brand-kit logo recoloured so the letters after the Ó are plum). These originated as mockup crops at 1536px; the roadmap records a "restore original right-side homepage artwork" pass — confirm the current files are high-resolution before shipping (follow-up in `09`).
- Icons: `public/icons/app-icon-*.png`, `public/favicon.*` from the brand kit. `public/robots.txt` is served.

## UI rules
- Prefer lucide-react icons; custom SVG only for brand marks (e.g. `BurstIcon` in `ExploreCategories`).
- Every interactive element ≥ 44–48px on touch, `:focus-visible` gold outline, aria label when icon-only.
- Never hardcode a colour — use the tokens above (`AGENTS.md` design rules still bind, even though the token file moved).
- House pages must ship loading, signed-out, blocked, error and empty-house states.
- `src/components/house/` exists but is empty; house UI currently lives in `src/layouts/HouseLayout.tsx` and `src/pages/HousePage.tsx`.
- `components.json` registers **no registries** (`"registries": {}`), so `AGENTS.md`'s "search the registries listed in components.json" step cannot run as written.
