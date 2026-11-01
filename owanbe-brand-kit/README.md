# Ówàńbè brand kit (SVG)

## How the logo files were made
The logo files are a vector trace of the original brand board artwork, not a redraw. The custom wordmark lettering (Ó w à ń b è), the gele Ó, the six characters and their poses are exactly those in the board. The "Plan • Source • Celebrate" and tagline lines are typeset in Montserrat and converted to outlines.

## Files
- `logo/owanbe-logo-primary.svg` – transparent, with the die-cut cream outline around the artwork (use on any background; the tagline text is dark, so on dark backgrounds remove or recolour it)
- `logo/owanbe-logo-primary-on-cream.svg` – same, on a cream background
- `logo/owanbe-logo-compact.svg` – gele Ó + wordmark + tagline, no characters
- `logo/owanbe-logo-mono-purple|black|white.svg` – one-colour versions
- `logo/owanbe-mark.svg`, `owanbe-mark-mono-purple.svg` – the gele Ó alone
- `logo/owanbe-app-icon.svg`, `owanbe-app-icon-dark.svg`, `owanbe-favicon.svg`
- `exports/` – PNGs (app icon 16–1024 px, favicon.ico, logo PNGs)
- `icons/`, `patterns/`, `tokens/` – supporting brand theme (icons, patterns, CSS/JSON/Tailwind tokens). The patterns and icons are my own interpretations of the board, not traces.

## Limits to know about
- The source was the 1254 px board image, so edges are slightly soft and painterly, and colours are quantised (they are close to, not identical to, the palette hex values). For print-grade artwork, trace again from a high-resolution original.
- The primary SVG is about 1.7 MB because of the illustration detail. For fast web pages, use the compact logo or the PNG exports; run SVGO if you need to shrink it.
- The six characters cannot be cleanly separated into individual files because they overlap in the original.
- The one-colour fold lines in the gele are approximated from the colour regions and are rougher than a hand-drawn mono mark.

## Palette (from the board)
Royal Purple #4B2E83 · Sun Gold #F7B500 · Yoruba Blue #0088A8 · Emerald Green #0E7D6B · Vibrant Red #E63946 · Fuchsia Pink #D81B8D · Cream #FFF9F0 · Charcoal #1A1A1A
(The Brand Story document lists slightly different values for four of them.)
