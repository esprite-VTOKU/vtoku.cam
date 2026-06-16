# vtoku.cam

Marketing + support website for **VTOKU Cam** (`com.vtoku.cam`), the native iOS/iPadOS
virtual-production camera by VTOKU. Served as a static site on **GitHub Pages** at
**https://vtoku.cam**.

## What's here

- `index.html` — landing page
- `privacy.html` — Privacy Policy (App Store **Privacy URL**)
- `terms.html` — Terms of Use & EULA
- `support.html` — Support + FAQ + contact (App Store **Support URL**) + Acknowledgements
- `docs/` — user documentation (getting started, Warudo, pose streaming, NDI, avatars, recording)
- `assets/` — `style.css`, `logo.svg`, `favicon.svg`, `app-store-badge.svg`, `screenshots/`
- `DESIGN.md` — the design system (Cinematic Dark + violet). Read before adding pages.
- `CNAME`, `robots.txt`, `sitemap.xml`, `404.html`

No build step — plain HTML + CSS. Edit a file, commit, push; GitHub Pages redeploys.

## Local preview

```bash
cd vtoku.cam && python3 -m http.server 8080
# open http://localhost:8080
```

## App Store URLs (paste into App Store Connect)

- Marketing URL: `https://vtoku.cam`
- Support URL: `https://vtoku.cam/support.html`
- Privacy Policy URL: `https://vtoku.cam/privacy.html`

## Custom domain / DNS

The repo's GitHub Pages custom domain is `vtoku.cam` (see `CNAME`). At the domain registrar, set:

| Type | Host | Value |
|------|------|-------|
| A | `@` | `185.199.108.153` |
| A | `@` | `185.199.109.153` |
| A | `@` | `185.199.110.153` |
| A | `@` | `185.199.111.153` |
| AAAA | `@` | `2606:50c0:8000::153` |
| AAAA | `@` | `2606:50c0:8001::153` |
| AAAA | `@` | `2606:50c0:8002::153` |
| AAAA | `@` | `2606:50c0:8003::153` |
| CNAME | `www` | `esprite-vtoku.github.io` |

After DNS propagates, enable **Enforce HTTPS** in the repo's Pages settings.

## Beta signups (Tally → Notion)

Pre-launch, the primary CTA is **Join the beta** (`beta.html`), which embeds a Tally form that feeds
the **"VTOKU Cam — Beta Waitlist"** Notion database
(<https://app.notion.com/p/b4a35f50a4ba463c9aa16cb5ac5f200e>).

To finish wiring it:
1. Create a form in Tally (tally.so) with fields matching the Notion DB: Name, Email, Device, Role,
   "Interested in Pro", and an optional revenue band.
2. In Tally, add the **Notion integration** and map the form to the Beta Waitlist database.
3. Copy the Tally form id and replace `REPLACE_WITH_TALLY_FORM_ID` in `beta.html`.
4. Optional: set the Tally post-submit redirect/thank-you to your public TestFlight link so approved
   testers get the invite immediately.

The "Pro" pricing on the landing reflects a one-time Pro unlock (NDI|HX + commercial-use license for
companies or creators earning $100k/yr or more). The full definition lives in `terms.html`.

## TODO before launch

- [ ] Finish the Tally form and paste its id into `beta.html` (see "Beta signups" above).
- [ ] Set the real public TestFlight invite link (Tally thank-you redirect, or swap CTAs back to a
      direct link once the App Store build is live).

- [ ] Replace the placeholder screenshot frames in `index.html` with real App Store screenshots
      (drop images into `assets/screenshots/` and wire them into the `.shots` section).
- [ ] Confirm `support@vtoku.com` inbox/forwarding exists.
- [ ] Swap `assets/app-store-badge.svg` for Apple's official downloaded badge artwork if you want
      pixel-exact brand compliance (current badge is a faithful SVG recreation).
- [ ] Update footer social links if you want direct YouTube/X/Instagram/Discord URLs (currently
      routed through vtoku.com).
- [ ] Localize into the app's other languages (zh-Hans, ja, ko, es, id) when ready — English only
      for now.
