# DESIGN.md — vtoku.cam

Persistent design system for the **VTOKU Cam** website. Aesthetic family: **Cinematic Dark**
(RunwayML / NVIDIA lineage), tuned to the VTOKU brand (vtoku.com — dark + violet). Keep new pages
on-system by reading this file first; the tokens here are mirrored as CSS custom properties in
`assets/style.css`.

## Principles

- **Cinematic, not busy.** Near-black canvas, generous negative space, one confident violet accent
  with a soft glow. Imagery (AR/avatar) carries the drama; chrome stays quiet.
- **Editorial legibility.** Docs and legal pages must read effortlessly — measured line length
  (~68ch), strong heading hierarchy, calm body color.
- **Restraint in motion.** Subtle hover transitions and a gentle fade-in only. No parallax, no
  autoplay, no heavy JS. Respect `prefers-reduced-motion`.
- **Accessible.** Body text meets WCAG AA on the dark canvas; visible focus rings; semantic HTML.

## Color tokens

| Token | Value | Use |
|---|---|---|
| `--bg` | `#08070A` | Page canvas (near-black) |
| `--bg-2` | `#0E0B14` | Raised sections |
| `--surface` | `#141019` | Cards |
| `--surface-2` | `#1B1622` | Card hover / inputs |
| `--border` | `#2A2335` | Hairline borders |
| `--text` | `#EDEAF2` | Primary text |
| `--text-dim` | `#A79FB5` | Secondary text |
| `--text-faint` | `#6F6880` | Muted / captions |
| `--accent` | `#7C5CFF` | Primary violet |
| `--accent-bright` | `#9D7BFF` | Hover / highlights |
| `--accent-soft` | `rgba(124,92,255,.16)` | Tints, glows |
| `--good` | `#4ADE80` | Success notes |
| `--warn` | `#FBBF24` | Caution notes |

Violet **glow** = `box-shadow: 0 0 40px rgba(124,92,255,.35)` on CTAs and the hero.

## Type

- Stack: `"Inter", -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif`.
- Display: 700–800 weight, tight tracking (`-0.02em`), clamp-scaled hero up to ~4rem.
- Body: 400/500, 1.0625rem, line-height 1.7, max width ~68ch.
- Mono (ports, code): `"SF Mono", ui-monospace, "JetBrains Mono", monospace`.

## Spacing & shape

- Spacing scale (px): 4, 8, 12, 16, 24, 32, 48, 64, 96.
- Radius: 12px cards, 999px pills/buttons, 8px small.
- Container max-width: 1080px; reading column 720px.

## Components

- **Buttons:** pill. Primary = violet fill + glow; secondary = transparent + hairline border.
- **Cards:** `--surface`, hairline border, 12px radius; on hover lift + border brightens to accent.
- **Nav:** sticky, translucent dark with blur (`backdrop-filter`), hairline bottom border.
- **Hero:** centered, radial violet glow behind headline, App Store badge CTA.
- **Callouts:** left accent-bar note boxes (info/caution) for docs.
- **Footer:** muted, social links (YouTube/X/Instagram/Discord), © VTOKU LLC, legal links.

## Anti-slop guardrails

- No generic gradient-purple-on-everything; accent is a spotlight, surfaces stay neutral dark.
- No emoji as iconography in chrome. No drop-shadow stacking. No filler lorem on shipped pages.
- Real content only (grounded in the app's actual features/permissions).
