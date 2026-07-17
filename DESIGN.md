# DESIGN.md — vtoku.cam

Persistent design system for the **VTOKU Cam** website. Aesthetic: **frosted dark panels** with a
faint lit top edge and real depth, over a near-black indigo ground. It echoes iOS 26 Liquid Glass
and shares vtoku.com's dark theme: the same neutral ramp and indigo accent, so the two sites read
as one brand. Tokens here mirror `assets/style.css`. Read this before adding pages.

## Principles

- Dark ground. The page sits on a single near-black solid (`#0B0E14`, shared with vtoku.com), no
  gradient. Panels read as dark frosted cards held by their borders, a faint inner top highlight,
  and a soft black drop shadow.
- Frosted, layered, lit. Cards use a dark translucent fill (~55-74% of `#1C212E`), a faint white
  hairline border, a subtle inner top highlight (`inset 0 1px 0`), and a black drop shadow.
- Readable first. Long text (legal, docs) sits inside a stronger frosted "sheet" (`.reading`) so it
  stays legible. Light text (`#F2F3F8` headings, `#A7AFC2` body) throughout.
- One brand color. Indigo (`--accent #7C82D8`, shared with vtoku.com) for accents; solid fills use
  the deeper `#5E63B6`. On glass, brand text uses the lighter `--accent-deep` so it reads on dark.
- Type. Display headings (h1/h2) use **Archivo** — the wide face vtoku.com uses, self-hosted from
  `assets/fonts/`, so the two sites share a headline voice. Body and card labels (h3) stay on the
  SF Pro system stack for an Apple-native feel. Sentence case throughout.
- Feature icons are **bare brand glyphs**, not gradient tiles. The rounded gradient icon-chip is the
  most templated SaaS component; a plain stroked mark reads as drawn for this page.
- Quiet motion. Small hover lifts, one fade-in. Respect `prefers-reduced-motion`.
- Not everything is glass. Glass should feel chosen, not automatic. Keep some plain
  surfaces (flat or transparent) so the frosted panels have something to contrast against,
  and never stack glass on glass. Content sitting on a `.section-tint` band uses plain cards.

## Color tokens

Mirrors vtoku.com's dark palette (ground / raise / ink / dim / brand).

| Token | Value | Use |
|---|---|---|
| body bg | `#0B0E14` near-black solid | The canvas behind all panels |
| `--glass` | `rgba(28,33,46,.55)` | Default panel fill |
| `--glass-strong` | `rgba(28,33,46,.74)` | Reading sheet, ghost button, eyebrow pill |
| `--glass-edge` | `rgba(255,255,255,.08)` | Inner top highlight (faint on dark) |
| `--glass-border` | `rgba(255,255,255,.10)` | Panel hairline |
| `--text` | `#F2F3F8` | Primary text (headings) |
| `--text-dim` | `#A7AFC2` | Secondary text (body) |
| `--accent` | `#7C82D8` | Brand indigo, lifted for the dark ground |
| `--accent-fill` | `#5E63B6` | Brand as-is, for solid button/icon fills |
| `--accent-deep` | `#A9AEEA` | Brand text ON glass: light, so it reads on dark |

Blur token: `--blur: saturate(140%) blur(12px)`. Glass shadow: `--shadow-glass` (black drop + inner
highlight + faint inner border).

## Components

- `.glass` primitive: fill + blur + border + `--shadow-glass`. Cards, nav, footer, sheet, notes,
  shots all build on it.
- Nav: sticky translucent glass bar with a hairline.
- Hero: app icon on top, eyebrow as a glass pill, big headline. `Go VRL.` with `.vrl` gradient text.
- Cards: frosted panels that lift on hover; violet gradient icon tiles with a white glyph.
- `.card-plain`: a flat, non-glass card (transparent, hairline top divider, no blur or shadow).
  Used for content on a `.section-tint` band so the band reads as the surface and the glass
  feature grid above it stays the standout, not one of three stacked glass layers.
- `.section-tint`: a faint extra frosted band (via `::before`) to vary rhythm between sections.
- `.reading`: a centered frosted sheet wrapping legal/docs prose for readability.
- `.eyebrow-label`: small uppercase indigo label над a display heading (the section-head pattern
  vtoku.com uses), so sections announce themselves instead of starting cold on a grid.
- `.showcase` / `.feature-row` / `.device`: the homepage feature tour. Real app screenshots sit in a
  phone `.device` frame with a faint viewfinder bracket (`.vf`), alternating left/right against the
  copy. This replaced the uniform icon-card grid, which read as a generic template. Prefer showing a
  real screenshot in a device over inventing another card.
- The hero mascot is a **hero-only** character (not sticky down the page): she scrolls away and the
  sections below start on clear ground, the way vtoku.com keeps its character to the hero.

## Brand assets

- `assets/vtoku-logo-white.png` — white VTOKU wordmark, used as the nav brand mark on the dark ground.
- `assets/app-icon.png` — the real app icon (chrome "VT" on violet). Hero icon and favicon.
- `assets/ndi-logo.png` — official NDI logo for acknowledgements.

## Iconography

Feature icons are original SVGs that echo the **SF Symbols the app uses** (`scope`,
`person.crop.square`, `face.smiling`, `figure.dance`, `film.stack`, plus a link/bond glyph for
SRTLA). SF Symbols can't be embedded directly on the web, so these are look-alikes.

## Voice (copy)

- Tagline: **Go VRL** (VR + IRL), decoded as "virtual real life streaming." Brand line, paired with
  the plain descriptor "virtual production camera" for clarity and App Store search.
- Say **perform as a VTuber**, not "perform a VRM avatar" (VRM stays as the file-format term in docs).
- Highlight the real **SRTLA bonded streaming** (Wi-Fi + cellular link aggregation).
- De-AI'd per the humanizer rules: plain verbs, no em dashes, no forced triads, no promo filler,
  sentence-case headings, straight quotes. Keep brand/protocol names (VTOKU, Warudo, VMC, FreeD, NDI,
  SRT, SRTLA, VRM) in English.
