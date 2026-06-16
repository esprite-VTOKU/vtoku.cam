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

## TODO before launch

- [ ] Replace the placeholder screenshot frames in `index.html` with real App Store screenshots
      (drop images into `assets/screenshots/` and wire them into the `.shots` section).
- [ ] Confirm `support@vtoku.com` inbox/forwarding exists.
- [ ] Swap `assets/app-store-badge.svg` for Apple's official downloaded badge artwork if you want
      pixel-exact brand compliance (current badge is a faithful SVG recreation).
- [ ] Update footer social links if you want direct YouTube/X/Instagram/Discord URLs (currently
      routed through vtoku.com).
- [ ] Localize into the app's other languages (zh-Hans, ja, ko, es, id) when ready — English only
      for now.
