# ADR 0001: UI foundation libraries and design authority

**Status:** proposed (reported to Sage 7 for owner confirmation)

## Decision
1. The UI uses Tailwind CSS 3 for styling, React Router 6 for routing, lucide-react for icons, and Vitest with Testing Library for tests.
2. The owner's approved homepage mockup and `owanbe-brand-kit` are the visual authority: royal purple/plum, sun gold, Playfair Display + Figtree. They override the Sage 7 "Aso-Oke Ledger" tokens (orange primary, Fraunces/Source Serif) wherever the two conflict.

## Why
- These libraries are Lovable's default React + Vite toolchain, so the code stays editable in Lovable. All of them are tree-shaken and small.
- The owner asked for the mockup to be reproduced exactly. The Sage 7 tokens describe a different palette and different fonts.

## Alternatives considered
- CSS Modules / vanilla CSS: slower to iterate on and not Lovable's default.
- Following the Sage 7 tokens: contradicts the owner's explicit design direction.
