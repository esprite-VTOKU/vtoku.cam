# DESIGN.md — vtoku.cam

Persistent design system for the **VTOKU Cam** website. Aesthetic: **soft frosted panels** with
bright edge highlights and real depth, over a calm off-white background. It echoes iOS 26 Liquid
Glass and uses the app's brand violet. Tokens here mirror `assets/style.css`. Read this before
adding pages.

## Principles

- Calm background. The page sits on a single soft off-white solid (`#F5F3FB`), no gradient.
  Panels read as light frosted cards held by their borders, inner top highlight, and soft shadow.
- Frosted, layered, lit. Cards use ~40-60% white fill, a light hairline border, a bright inner top
  highlight (`inset 0 1px 0`), and a soft violet-tinted drop shadow.
- Readable first. Long text (legal, docs) sits inside a stronger frosted "sheet" (`.reading`) so it
  stays legible. Dark text (`#1A1726`) throughout.
- One brand color. Violet (`#6C5CE7`, from the app icon) for accents and buttons. The VRL wordmark
  uses a violet-to-pink gradient text fill.
- Apple typography. System font stack (SF Pro), large bold headings in sentence case.
- Quiet motion. Small hover lifts, one fade-in. Respect `prefers-reduced-motion`.
- Not everything is glass. Glass should feel chosen, not automatic. Keep some plain
  surfaces (flat or transparent) so the frosted panels have something to contrast against,
  and never stack glass on glass. Content sitting on a `.section-tint` band uses plain cards.

## Color tokens

| Token | Value | Use |
|---|---|---|
| body bg | `#F5F3FB` soft off-white solid | The canvas behind all panels |
| `--glass` | `rgba(255,255,255,.42)` | Default panel fill |
| `--glass-strong` | `rgba(255,255,255,.60)` | Reading sheet, ghost button, eyebrow pill |
| `--glass-edge` | `rgba(255,255,255,.75)` | Inner top highlight |
| `--glass-border` | `rgba(255,255,255,.55)` | Panel hairline |
| `--text` | `#1A1726` | Primary text |
| `--text-dim` | `#4C4860` | Secondary text |
| `--accent` | `#6C5CE7` | Brand violet |
| `--accent-deep` | `#4226A8` | Links/code/hover on glass |

Blur token: `--blur: saturate(180%) blur(22px)`. Glass shadow: `--shadow-glass` (drop + inner
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

## Brand assets

- `assets/app-icon.png` — the real app icon (chrome "VT" on violet). Nav mark, hero icon, favicon.
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
