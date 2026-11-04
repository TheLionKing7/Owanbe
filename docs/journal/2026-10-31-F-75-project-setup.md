# 2026-10-31 · F-75 Project setup

**What changed**
- Scaffolded the React 18 + Vite 5 + TypeScript SPA (Lovable-compatible), with Tailwind CSS 3, React Router 6 and lucide-react.
- Built the homepage `/` from the owner's mockup: header with dropdown navigation, hero with AI planning search and popular searches, six-pillar feature strip, Explore Categories, Featured Vendors, the "Experience the Ówàńbè Difference" CTA, ankara band and the Need Help button. Responsive from 360 px to 1536 px and wider.
- Added route-level code splitting: only the public shell and homepage ship in the initial bundle (≈77 kB gzipped JS). The Host house, Vendor house and placeholder pages are lazy chunks.
- Scaffolded the separate Host House (`/host/*`) and Vendor House (`/vendor/*`), each with its own navigation (`src/lib/houses.ts`).
- Added `APP_ORIGIN` (`.env.example`, `src/config/env.ts`, exposed via Vite `envPrefix`).
- Brand assets: the wordmark is derived from the compact logo, recoloured to the mockup's purple. Favicons and app icons come from the brand kit. The photos were cut from the mockup.
- Tests: route rendering, hero search → `/host/plan?q=`, dropdown, house separation, unknown section → 404, and APP_ORIGIN resolution (8 tests). Added a bundle budget script.

**How it was checked**
`npm run ci` passes (typecheck, 8 tests, build, bundle budget). Compared visually against the mockup at 1536 × 1024 with an overlay, and checked at 1280, 1024 and 390 px.

**Follow-ups**
- Replace the mockup-derived photography with high-resolution originals.
- Sign In / Get Started, Discover and the Host/Vendor house tools are filled in by later features (F-76 Authentication onward).
