# 05 · Design system

## Authority (owner-confirmed in Sage 7; ADR 0001)
1. The owner's homepage mockup: `docs/design/homepage-mockup.png` (1536×1024). The homepage reproduces it pixel for pixel at that size.
2. The brand kit: `owanbe-brand-kit/` (logos, icons, patterns, `tokens/`).
3. The Sage 7 "Aso-Oke Ledger" tokens in `blueprint/design-system.md` are **overridden** where they conflict (orange primary, Fraunces/Source Serif). Their structural rules still apply: 48px tap targets, a focus ring on every control, and empty, loading and error states for every view.

## Tokens (`tailwind.config.ts`; colours sampled from the mockup)
| Token | Value | Use |
|---|---|---|
| `cream` | #FFF6EE | page background (plus radial pink and peach washes in `index.css`) |
| `plum-950` / `plum-900` | #1E0A2B / #2A0F38 | headline ink |
| `plum-800` | #410B52 | primary buttons, Home pill, `btn-primary` |
| `plum-600` | #5C1272 | wordmark, links |
| `plum-500` | #6B1E8E | "Celebrate." accent |
| `gold` | #F8AC00 (100: #FDE7B5) | CTA button, stars, badges |
| `ink` / `ink-muted` | #1C1224 / #62566E | body and secondary text |
| `cat.*` | venues #FCB10C · catering #073891 · decoration #FB6335 · photo #0587B5 · fashion #E30974 · music #168AA1 | category icon circles |
| `verified` | #0A3BD6 | vendor verified badge |
| `owanbe.*` | brand kit palette | reserved for brand assets |
Fonts: **Playfair Display** 600–800 (`font-display`: headings) and **Figtree** 400–700 (`font-sans`: UI). Both load from Google Fonts in `index.html`.
Shadows: `shadow-card`, `shadow-search`, `shadow-pill`. Radius `rounded-4xl` = 1.25rem. Page max width `max-w-page` = 1536px.
Component classes (`src/index.css`): `.btn-primary`, `.btn-outline`, `.surface` (white card).

## Homepage layout (1536 reference; `xl` ≥ 1280 uses the overlay layout, below that it stacks)
Header floats over the hero (`SiteHeader`, absolute at xl) → hero band 492px (photo `public/images/hero.webp` at right with a left fade mask; copy starts at 162px) → `FeatureStrip` (112px card) → three-column grid `minmax(0,290fr) 15fr minmax(0,793fr) 23fr minmax(0,351fr)`, 318px tall (Categories · Featured Vendors · Difference CTA) → `AnkaraBand` (80px) → fixed "Need Help?" pill.

## Assets
- `public/images/owanbe-logo-wordmark.webp`: the brand-kit compact logo, recoloured so the letters after the Ó are plum (matches the mockup).
- `hero.webp`, `vendor-1..3.webp`, `cta.webp`, `ankara-band.webp`: **cut from the mockup at 1536px**. Replace them with high-resolution originals using the same names and aspect ratios (follow-up in `09`).
- Favicons and app icons: `public/favicon.*`, `public/icons/app-icon-*.png` (from the brand kit).

## UI rules
- Icons: lucide-react only. Custom SVG only for brand marks (e.g. `BurstIcon` in `ExploreCategories`).
- Every interactive element is ≥ 44–48px tall on touch, uses `:focus-visible` (gold outline) and has an aria label when it shows an icon only.
- Respect `prefers-reduced-motion` (global rule in `index.css`).
- House pages: user-facing states must exist (loading, signed out, blocked, error, empty house).
