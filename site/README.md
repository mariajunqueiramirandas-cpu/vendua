# Venduá site

The marketing site for vendua.com.br: SvelteKit 2 + Svelte 5, prerendered with adapter-static, copy
in pt-BR. Sign-up is open, in the merchant admin (not on this site).

The home page is **"um dia na loja"**: one day of a small shop, dawn to night, told by the sky
flowing continuously between sections (no hour labels): hero (`#inicio`), who it's for
(`#para-quem`), an order arrives (`#pedidos`), the store and its price (`#sua-loja`, `#preco`), the
day's recap (`#seu-dia`), how to start + FAQ (`#comecar`, `#perguntas`).

The hero is the name: "venduá." poster-size, with Duá standing behind the letters. On load the letters
spring up, the accent and the dot land, Duá climbs out and waves, the paragraph arrives word by word,
the two phones come up one after the other and the order push drops onto the front one; scrolling
plays it back (Duá ducks, the letters sink) while the header's logo takes over. All CSS (`linear()`
springs, scroll-driven animations); without support or with reduced motion it's the finished poster.
Other pages: `/privacidade/` and the 404.

## Launch decisions the copy encodes

- Sign-up is open. The only call to action is `<Start/>` ("Criar minha loja"), a plain link to
  `<PUBLIC_ADMIN_URL>/admin/comecar` (works without JS): in the header, and in the closing. Not in
  the hero, where it would sit right under the header's. The price block links each plan to the same
  page with `?plano=basic` or `?plano=pro_plus`. No form, contact or WhatsApp CTA on the site;
  Instagram only in the footer (and at most one line near the closing CTA).
- Prices are the user's decision, shown exactly: **Venduá Basic, R$ 39,90/mês** (store at
  `seunome.vendua.com.br`, the standard Venduá look, no own domain, no custom site) and **Venduá
  PRO+, R$ 99/mês** (own domain + a site made by our AI agent). The plan is paid by Pix every month
  or by recurring card, through Mercado Pago. Venduá takes no per-order fee, but Mercado Pago keeps
  its own on each payment, so never "sem taxas".
- Venduá Basic starts with a **14-day free trial, no card** (the user's decision, 2026-10-02); PRO+
  pays the first month. "14 dias grátis" is the only "grátis" the site says: no other free offer, no
  discount, and no date for the custom site. Plan names, prices and the trial live in `plans` in
  `src/lib/content.ts`.
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
  and Noite under `prefers-color-scheme: dark`). The header's switch (`ThemeToggle`) can override
  the system: it sets `<html data-theme>` (applied before paint by `app.html`), and a PostCSS step in
  `vite.config.ts` makes every `@media (prefers-color-scheme: dark)` block obey it, so keep writing
  dark styles that way. Screens follow it through `Screen`. The admin is the source: `scripts/validate.ts`
  fails the build if a shared token drifts.
- Banned words (platform jargon, "sob medida", "sem taxa", "grátis" other than "14 dias grátis", "em breve", real store names) are checked
  on the rendered text of every page by `scripts/postbuild.ts`.
- Works without JavaScript; motion is CSS-only and respects `prefers-reduced-motion`.
- No generic template chrome: no eyebrow labels above headings, no all-caps labels, no `A · B`
  meta strings, no numbers on lists that aren't steps, no sparkle bullets, no pulsing dots, no single
  italic or highlighted word in a headline, no identical card grids. Instrument Serif appears only
  inside the admin screens (the greeting), not in site copy. See `.claude/skills/frontend-design/`.

## Settings

- `PUBLIC_ADMIN_URL` (build time, default `https://painel.vendua.com.br`): the merchant admin the
  sign-up links point to. `vite.config.ts` bakes it into the build; the Playwright suite reads the
  same variable, so set it for both.

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
  `Start` (the sign-up link), header, footer, SEO, 404.
- `src/lib/content.ts`: site facts and the store's numbers; `src/lib/screens.ts`: screen registry.
- `src/lib/styles/`: `theme.css` (tokens) and `base.css` (layout and type classes).
- `static/`: `screens/`, `dua/`, `assets/brand/`, `og.png`.
- `scripts/`: assets, validate, postbuild, preview server, shots.

## Deploy

`build/` is the deliverable. The `site` stage of `storefronts/Dockerfile` builds it and copies it
into nginx with `nginx.conf`: each route is `route/index.html`, unknown paths get `404.html` with a
real 404 status, and there is no SPA fallback.
