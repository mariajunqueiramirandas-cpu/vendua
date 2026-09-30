# Venduá site

The marketing site for vendua.com.br: SvelteKit 2 + Svelte 5, prerendered with adapter-static, copy
in pt-BR. Sign-up isn't open yet.

The home page is **"um dia na loja"**: one day of a small shop, dawn to night, told by the sky
flowing continuously between sections (no hour labels): hero (`#inicio`), who it's for
(`#para-quem`), an order arrives (`#pedidos`), the store and its price (`#sua-loja`, `#preco`), the
day's recap (`#seu-dia`), how to start + FAQ (`#comecar`, `#perguntas`).
Other pages: `/privacidade/` and the 404.

## Launch decisions the copy encodes

- The only call to action is `<Soon/>` ("Em breve"): in the header, the price block and the closing.
  Not in the hero, where it would sit right under the header's. No sign-up or contact CTA; Instagram
  only in the footer (and at most one line near the closing "Em breve").
- Price is never a number: the price block's total reads "em breve".
- Every planned feature (`docs/merchant-admin.md` scope) is presented as available at launch.
  Nothing beyond that list.
- No custom software ("sob medida", software house, projects).
- One store only: the fictional **Bolos da Nena** (owner Nena). Numbers quoted in copy come from
  `src/lib/content.ts`, so they match the screenshots.

## Visual rules

- The product appears only as real admin screens of Bolos da Nena (`<Screen key=…>`, registry in
  `src/lib/screens.ts`) inside device frames drawn in CSS (`Phone`, `Tablet`). The only UI drawn in
  code is system UI: lock screen and push notifications, with Core's real push text.
- The only character is Duá (`static/dua/`, never mirrored or recolored), plus line drawings in the
  admin's illustration style. No photos, people, AI images, stock, or fake testimonials/numbers.
- Colors come from `src/lib/styles/theme.css`, copied from `apps/admin/src/ui/theme.css` (Creme,
  and Noite under `prefers-color-scheme: dark`). The admin is the source: `scripts/validate.ts`
  fails the build if a shared token drifts.
- Banned words (platform jargon, "sob medida", "sem taxa", "grátis", real store names) are checked
  on the rendered text of every page by `scripts/postbuild.ts`.
- Works without JavaScript; motion is CSS-only and respects `prefers-reduced-motion`.
- No generic template chrome: no eyebrow labels above headings, no all-caps labels, no `A · B`
  meta strings, no numbers on lists that aren't steps, no sparkle bullets, no pulsing dots, no single
  italic or highlighted word in a headline, no identical card grids. Instrument Serif appears only
  inside the admin screens (the greeting), not in site copy. See `.claude/skills/frontend-design/`.

## Run

```sh
bun run dev        # http://127.0.0.1:5173
bun run check      # svelte-check
bun run build      # validate.ts → vite build → postbuild.ts (404.html, sitemap, robots, copy rules)
bun run preview    # serves build/ on http://127.0.0.1:4173, real 404s
CHROMIUM=/opt/pw-browsers/chromium bun run test:e2e   # Playwright (tests/), starts preview itself
```

`bun scripts/shots.ts [route …]` takes screenshots of the dev server (`WIDTHS`, `THEMES`,
`SELECTOR`, `OUT`, `BASE`) and fails on horizontal overflow, console errors and failed requests.

## Regenerating images

Images are committed; `scripts/assets.ts` rebuilds them (no argument = all three):

- `bun scripts/assets.ts dua` — Duá poses from `brand/mascote/` → `static/dua/*.webp`.
- `bun scripts/assets.ts screens` — real admin screens in Creme and Noite → `static/screens/`, and
  `src/lib/screens.facts.json` (sales, orders, the day's recap) so the copy matches the screens.
  Needs the local stack (the `local-stack` skill): Postgres on :5433, Core started with
  `VENDUA_ADMIN_DEV_OTP=1`, the admin dev server on :5196. It rewrites the dev seed store into Bolos
  da Nena — dev database only.
- `bun scripts/assets.ts og` — the social card (`scripts/og.html`) → `static/og.png`; needs the
  screens.

## Structure

- `src/routes/`: home, `/privacidade/`, 404.
- `src/lib/sections/`: the six moments (`Hero`, `WhoFor`, `Orders`, `YourStore`, `YourDay`,
  `Night`).
- `src/lib/components/`: `Section`, device frames, `Screen`, `Notification`, `LockScreen`, `Dua`,
  `Soon`, header, footer, SEO, 404.
- `src/lib/content.ts`: site facts and the store's numbers; `src/lib/screens.ts`: screen registry.
- `src/lib/styles/`: `theme.css` (tokens) and `base.css` (layout and type classes).
- `static/`: `screens/`, `dua/`, `assets/brand/`, `og.png`.
- `scripts/`: assets, validate, postbuild, preview server, shots.

## Deploy

`build/` is the deliverable. The `site` stage of `storefronts/Dockerfile` builds it and copies it
into nginx with `nginx.conf`: each route is `route/index.html`, unknown paths get `404.html` with a
real 404 status, and there is no SPA fallback.
