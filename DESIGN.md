# DESIGN.md — vtoku.cam

Persistent design system for the **VTOKU Cam** website. Aesthetic: **Apple-style glass /
soft-futurism** — light canvas, frosted-glass cards, soft violet gradients, generous space,
rounded geometry. It mirrors the feel of an iOS 26 app and uses the app's own brand violet. The
tokens here are mirrored as CSS custom properties in `assets/style.css`. Read this before adding
pages.

## Principles

- Light and airy. Off-white canvas (`#FBFBFD`), white sections, lots of breathing room.
- Glass surfaces. Cards use a translucent white fill with `backdrop-filter: blur`, hairline
  borders, and soft layered shadows rather than hard outlines.
- Soft depth. Gentle radial violet/blue gradients behind the hero; nothing harsh or neon.
- One brand color. Violet (`#6C5CE7`, from the app icon) for accents, buttons, and icon tiles.
- Apple typography. System font stack (SF Pro), large semibold headings in sentence case,
  comfortable body at ~68ch for reading pages.
- Quiet motion. Small hover lifts and a single fade-in. Respect `prefers-reduced-motion`.
- Accessible. Dark text on light meets WCAG AA; visible focus rings; semantic HTML.

## Color tokens

| Token | Value | Use |
|---|---|---|
| `--bg` | `#FBFBFD` | Page canvas |
| `--bg-2` | `#FFFFFF` | Raised sections, footer |
| `--bg-tint` | `#F4F2FB` | Faint violet wash (hero, tinted sections) |
| `--surface` | `rgba(255,255,255,.65)` | Glass card fill (over a blur) |
| `--border` | `rgba(0,0,0,.08)` | Hairline borders |
| `--text` | `#1D1D1F` | Primary text |
| `--text-dim` | `#56565B` | Secondary text |
| `--text-faint` | `#86868B` | Muted / captions |
| `--accent` | `#6C5CE7` | Brand violet |
| `--accent-bright` | `#5B49E0` | Links / hover |
| `--accent-deep` | `#4B3BC2` | Code, deep hover |

Shadows: `--shadow-sm` for resting cards, `--shadow-md` for hover and the hero icon.

## Type

- Stack: `-apple-system, BlinkMacSystemFont, "SF Pro Display", "Inter", system-ui, sans-serif`.
- Display: 700 weight, tight tracking, clamp-scaled hero up to ~4.2rem.
- Body: 400, 1.0625rem, line-height 1.62, reading column ~720px.
- Mono (ports, code): `ui-monospace, "SF Mono", monospace`.

## Shape & spacing

- Radius: 20px cards, 26px phone mocks, 999px buttons, 12px small.
- Spacing scale (px): 4, 8, 12, 16, 24, 32, 48, 72, 96.
- Container 1080px; reading column 720px.

## Components

- Buttons: pill. Primary = violet fill + soft glow shadow; ghost = translucent white + hairline.
- Cards: glass fill + blur + hairline + soft shadow; hover lifts and deepens the shadow. Icon
  tiles use a violet gradient with a white glyph.
- Nav: sticky, translucent light with blur, hairline bottom border.
- Hero: centered, the real app icon up top, soft gradient wash behind, App Store badge CTA.
- Callouts: hairline note boxes with a left accent bar (info / caution) for docs.

## Brand assets

- `assets/app-icon.png` — the real app icon (chrome "VT" on violet). Used as the nav mark, hero
  icon, favicon, and apple-touch-icon.
- `assets/ndi-logo.png` — official NDI logo for the acknowledgements area.

## Iconography

Feature icons are original SVGs drawn to echo the **SF Symbols the app actually uses** (`scope`,
`person.crop.square`, `face.smiling`, `figure.dance`, `film.stack`, plus a broadcast glyph for
streaming), so the site and app read as one product. (SF Symbols themselves are an Apple asset and
aren't embedded directly; these are look-alike SVGs.)

## Voice (copy)

De-AI'd per the humanizer rules: plain verbs (is/has, not "serves as"/"boasts"), few or no em
dashes, no forced triads, no significance inflation or promo filler ("nestled", "seamless",
"the whole pipeline"), sentence-case headings, straight quotes. Ground every claim in what the app
actually does. Keep brand/protocol names (VTOKU, Warudo, VMC, FreeD, NDI, SRT, VRM) in English.
