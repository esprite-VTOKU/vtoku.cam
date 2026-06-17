# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Marketing + support website for **VTOKU Cam** (`com.vtoku.cam`), a native iOS/iPadOS
virtual-production camera app by VTOKU LLC. It is a **static site** (plain HTML + CSS, no
framework, no build step, no JS toolchain) served on **GitHub Pages** at https://vtoku.cam.

The site also doubles as the source of the App Store Connect URLs: Marketing (`/`),
Support (`/support.html`), and Privacy (`/privacy.html`).

## Workflow

There is no build, lint, or test step. Edit a file, commit, push to `main` — GitHub Pages
redeploys automatically.

Local preview:

```bash
python3 -m http.server 8080   # then open http://localhost:8080
```

## Architecture

Each page is a standalone, fully hand-written HTML file that links the single shared
stylesheet `assets/style.css`. There are no templates and no partials, so the `<nav>` and
`<footer>` markup is **duplicated in every page** — when changing navigation or footer, update
all pages consistently (top-level `*.html` plus everything under `docs/`).

- Top-level pages: `index.html` (landing), `beta.html` (waitlist CTA), `support.html`,
  `privacy.html`, `terms.html`, `404.html`.
- `docs/` — user documentation, one file per topic (getting-started, warudo, pose-streaming,
  ndi, avatars, recording, streaming) with its own `docs/index.html`.
- `assets/` — `style.css` plus brand images (`app-icon.png`, logos, `app-store-badge.svg`,
  NDI logo, screenshots).
- SEO/hosting files that must be kept in sync when pages are added or removed:
  `sitemap.xml` (explicit `<loc>` list), `robots.txt`, `llms.txt`, `CNAME` (the
  `vtoku.cam` custom domain). Each page also carries its own `<title>`, meta description,
  canonical link, Open Graph/Twitter tags, and JSON-LD.

## Design system — read DESIGN.md before adding or restyling pages

`DESIGN.md` is the authoritative design spec and its tokens mirror `assets/style.css`. The
aesthetic is **Liquid Glass / glassmorphism**: translucent frosted panels (the `.glass`
primitive) floating over a fixed pastel mesh gradient, with one brand color, violet `#6C5CE7`.
Reuse existing CSS tokens and the `.glass` / `.reading` / `.section-tint` patterns rather than
introducing new colors or one-off styles.

## Voice and copy rules (from DESIGN.md)

- Tagline is **"Go VRL"** (VR + IRL), paired with the plain descriptor "virtual production
  camera." Say **"perform as a VTuber"**, not "perform a VRM avatar" (VRM stays only as the
  file-format term in docs).
- "De-AI'd" humanizer style: plain verbs, **no em dashes**, no forced triads, no promo filler,
  **sentence-case headings**, straight quotes. Keep brand/protocol names in English
  (VTOKU, Warudo, VMC, FreeD, NDI, SRT, SRTLA, VRM).
- English only for now; the app itself also ships zh-Hans, ja, ko, es, id (not yet localized here).

## Project-specific notes

- Pre-launch, the primary CTA is **Join the beta** (`beta.html`), which embeds a Tally form
  feeding a Notion "Beta Waitlist" database. The form id placeholder `REPLACE_WITH_TALLY_FORM_ID`
  in `beta.html` still needs the real Tally form id (see README "Beta signups" + "TODO before launch").
- "Pro" pricing copy describes a one-time Pro unlock (NDI|HX + commercial-use license); the
  binding definition lives in `terms.html`.
- Contact / support inbox: `support@vtoku.com`.
