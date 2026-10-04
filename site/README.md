# Venduá site

The marketing site for vendua.com.br: SvelteKit 2 + Svelte 5, prerendered with adapter-static, copy
in pt-BR. Sign-up is open, in the merchant admin (not on this site).

The home page is **"um dia na loja"**, kept short (the owner, 2026-10-03: about half its old
length): one day of a small shop, dawn to night, told by the sky flowing continuously between five
sections (no hour labels): hero (`#inicio`), who it's for (`#para-quem`), the product working
(`#veja`, four interactive demos behind one tab bar), the plans (`#preco`), and the sunset into night
with how to start + FAQ (`#comecar`, `#perguntas`).

The hero is the name: "venduá." poster-size, with Duá standing behind the letters. On load the letters
spring up, the accent and the dot land, Duá climbs out and waves, the paragraph arrives word by word,
the two phones come up one after the other and the order push drops onto the front one; scrolling
plays it back (Duá ducks, the letters sink) while the header's logo takes over. All CSS (`linear()`
springs, scroll-driven animations); without support or with reduced motion it's the finished poster.
Other pages: one per kind of shop (`/para/doceiras/`, `/para/marmitarias/`,
`/para/hamburguerias/`, `/para/padarias/`), the guides (`/guias/` and four articles), `/sobre/`,
`/privacidade/` and the 404. See "Search" below for why they exist and the rules they follow.

## Launch decisions the copy encodes

- Sign-up is open. The only call to action is `<Start/>` ("Criar minha loja"), a plain link to
  `<PUBLIC_ADMIN_URL>/admin/comecar?plano=bandeira` (works without JS): in the header, and in the
  closing. Not in the hero, where it would sit right under the header's. The price block links each
  open plan to the same page with `?plano=mirim` or `?plano=bandeira` (and `?plano=pangolim` once it
  opens, see below). No form, contact
  or WhatsApp CTA on the site; Instagram only in the footer (and at most one line near the closing
  CTA).
- Three plans, the owner's decision (2026-10-03), shown exactly and cheapest first, with Bandeira in
  the middle as the recommended one ("Recomendado", raised, the section's main button, and the plan
  `<Start/>` preselects):
  - **Venduá Mirim, R$ 69,90/mês**: the store at `seunome.vendua.com.br`, the standard Venduá look,
    and everything on the receipt (menu, orders, Pix, coupons...). Copy says plainly what it leaves
    out: the kitchen screen, automatic printing, the loyalty card and Duá.
  - **Venduá Bandeira, R$ 169/mês**: everything in Mirim plus the kitchen screen (KDS), automatic
    printing of the comanda, the loyalty card and **Duá**, the AI seller (code name Vendedor, ADR 0031) that answers the store's customers on its WhatsApp, with 250 conversations a month (50
    during the trial).
  - **Venduá Pangolim, R$ 449/mês**: everything in Bandeira plus own domain, a site made by our AI
    agent, and 1.000 Duá conversations a month. **Shown but closed** (owner, 2026-10-03: Venduá
    can't offer own domains yet): the card keeps its price and perks, and its button is replaced by
    the quiet line "Ainda não está aberto para assinatura." (no date, never "em breve"); nothing
    links to `?plano=pangolim`, and the FAQ and closing don't offer it. Open/closed follows the CRM's
    `available` flag (Core answers 409 `PLAN_UNAVAILABLE`), mirrored in `available` in `plans`
    like the prices; `signup()` throws on a closed plan, so the prerender fails before a link ships.
  - Duá is the AI seller's only name, the same on every store (stores don't name it), and the
    grammar is masculine: o Duá, do Duá, ele. First mention: "o Duá, o vendedor com IA no WhatsApp
    da loja"; never "o Vendedor" as a product name. It tells shoppers it's the store's virtual
    assistant ("Oi! Sou o Duá, assistente virtual da Bolos da Nena."), never a person; in the chat
    demo the mascot is its face (`avatar-ola`, `avatar-pensando` while typing, `avatar-feliz` when the
    order is done) on a lit disc, while the header stays the store's WhatsApp.
  - A conversation is one customer talking to Duá, counted once every 24 hours (FAQ).
  - The plan is paid by Pix every month or by recurring card, through Mercado Pago. Venduá takes no
    per-order fee on any plan, but Mercado Pago keeps its own on each payment, so never "sem taxas".
- Bandeira starts with a **14-day free trial, no card**; Mirim (and Pangolim, once open) pays the
  first month.
  "14 dias grátis" is the only "grátis" the site says: no other free offer, no discount, no price
  beyond the three plans (the +100-conversation pack is sold in the admin, not quoted here), and no
  date for the custom site. Plan names, prices, conversations and the trial live in `plans` in
  `src/lib/content.ts`.
- **Prices follow the CRM by themselves.** On the home page (and in the closing of every inner
  page), `src/lib/plans/live.svelte.ts` reads `/precos.json` once. In production the site's nginx
  answers it from Core's public catalog (`/site/v1/plans`, a minute of cache), and the plan cards,
  the comparison table, the calculator, the trial strip, the FAQ and the closing line update in
  place.
  - It covers the price (any the CRM takes), the trial, Duá's conversations, `available`, the
    name and the features. The cards' perks, the "Sem …" line, the "Tudo do …" lines and the
    comparison table come from the feature flags, so a feature switched on or off in the CRM
    shows.
  - The request is first-party, like the visit counter (the privacy page's "Tudo vem daqui
    mesmo" names Google Analytics as the only other service, in a build that has it).
  - The built page carries `content.ts`'s values, which crawlers, readers without JavaScript and a
    Core that's down get. The build prerenders the same values as `/precos.json`, for the preview
    and the tests.
  - Keep `content.ts` close to the CRM, and update it when a decision changes. The SEO description
    ("A partir de R$ 69,90") and the copy check read the build, not the CRM.
  - A trial set to 0 in the CRM removes the trial line, the strip and the FAQ's mention. A closed
    plan loses its button.
- Every planned feature (`docs/merchant-admin.md` scope) is presented as available at launch.
  Nothing beyond that list.
- **The plans pitch** (owner, 2026-10-03): the trial up front ("Comece pelo Venduá Bandeira: 14 dias
  grátis, sem cartão"), the three cards (perks with a demo link to it), a full comparison table
  closed in a `<details>`, and a commission calculator. The calculator is the site's only mention of
  another company: iFood's own published commissions (12% Plano Básico, 23% Plano Entrega,
  `blog-parceiros.ifood.com.br/taxas-ifood`, updated 15/09/2026), cited under it with what they
  leave out (3,2% online payment fee, the monthly fee) and that Mercado Pago charges its own fee on
  Venduá too. Re-check the rates before changing that copy; no other competitor claims.
- No custom software ("sob medida", software house, projects).
- One store only: the fictional **Bolos da Nena** (owner Nena). Numbers quoted in copy come from
  `src/lib/content.ts`, so they match the screenshots.

## Visual rules

- The product appears as real admin screens of Bolos da Nena (`<Screen key=…>`, registry in
  `src/lib/screens.ts`) inside device frames drawn in CSS (`Phone`, `Tablet`), and in the four
  **demos** (`src/lib/demos/`, the owner's decision 2026-10-03): drawn in code, scripted (no
  network, no model), each mirroring the real admin or storefront screen it shows (labels, states
  and Core's card wording copied from the source named at the top of each file) and labelled an
  example by `DemoFrame`. Any other UI drawn in code is system UI: lock screen and push
  notifications, with Core's real push text.
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
- Works without JavaScript: the demos render their finished state, still, and the calculator its
  R$ 8.000 example; with JavaScript they become interactive (the visitor drives every step). All
  other motion is CSS-only, and everything respects `prefers-reduced-motion` (demo waits become
  instant).
- Page views are counted first-party and cookieless (`src/lib/analytics.ts` → nginx
  `/analytics/v1/collect` → Core, ADR 0028); `/privacidade/` describes exactly what is kept, so
  keep the two in step.
- **Google Analytics, for Google Ads** (owner, 2026-10-04: Google Ads' credit needs it, with the
  sign-up confirmed on this domain). Only in a build with a Google tag id (see Settings), and only
  for a visit the counter would count (no automation, no Do Not Track / GPC, not localhost).
  `/loja-criada/` is the confirmation page: when a sign-up ends, the admin (in production, on
  `painel.<storeDomain>`) sends the owner there instead of straight to its `/bem-vindo`; the page
  sends GA4's `sign_up`, then forwards to `<PUBLIC_ADMIN_URL>/admin/bem-vindo` (2,5 s at most;
  without JS, a meta refresh). noindex and linked from nowhere. Deploy the site before an admin
  carrying that redirect, or new stores land on the 404.
- No generic template chrome: no eyebrow labels above headings, no all-caps labels, no `A · B`
  meta strings, no numbers on lists that aren't steps, no sparkle bullets, no pulsing dots, no single
  italic or highlighted word in a headline, no identical card grids. Instrument Serif appears only
  inside the admin screens (the greeting), not in site copy. See `.claude/skills/frontend-design/`.

## Search

The site is found two ways: by the name, and by what a shop owner types ("cardápio digital para
marmitaria", "como vender pelo WhatsApp"). Both have rules.

- **The name without the accent.** People type "vendua", as in the address, and Google used to
  correct it to another brand. Every indexable page carries JSON-LD (`src/lib/seo.ts`, rendered by
  `Seo`): an `Organization` and a `WebSite` named Venduá with `alternateName` Vendua, plus what the
  page is (`SoftwareApplication` with the open plans on the home, `Article` on guides, `FAQPage`
  on the pages per kind of shop, `BreadcrumbList` on every inner page). `/sobre/` says it in words:
  "Venduá, ou vendua". noindex pages carry none.
- **Pages that answer a search.** `/para/<kind>/` (layout `NichePage`, each page only its words)
  and `/guias/<slug>/` (layout `Article`, text styled by `Prose`). `src/lib/pages.ts` lists them:
  the home's "para quem" tiles, the footer, `/guias/` and each page's closing read it, so a page
  added there is linked from everywhere.
- Their copy follows the launch decisions above, and states only what the admin does (its help
  topics in `apps/admin/src/features/help/topics.tsx` are the source). Prices appear only in
  `Closing`, which reads the live catalog like the home; the body names plans, never prices or
  dates. A screen shows Bolos da Nena, so on the pages for other kitchens its `alt` says so.
- `postbuild.ts` builds `sitemap.xml` from the build (every page without noindex) and fails the
  build when an indexable page has a canonical that isn't its own URL, JSON-LD that doesn't parse,
  or a title or description another page already uses.
- Outside the repo, and the owner's to do: the domain verified in Google Search Console with the
  sitemap submitted, and the Instagram profile linking to vendua.com.br.

## Settings

- `PUBLIC_ADMIN_URL` (build time, default `https://painel.vendua.com.br`): the merchant admin the
  sign-up links point to. `vite.config.ts` bakes it into the build; the Playwright suite reads the
  same variable, so set it for both.
- `PUBLIC_GA_ID` (`G-…`) and `PUBLIC_GOOGLE_ADS_ID` (`AW-…`), build time, both optional: the Google
  tag (`src/lib/gtag.ts`). Unset, the site loads nothing from Google; set (in the Dokploy `.env`,
  which `docker-compose.yml` passes to the site's build), it loads gtag.js and `/privacidade/` switches to the copy that names Google Analytics.

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

- `src/routes/`: home, `para/<kind>/`, `guias/` and its articles, `/sobre/`, `/privacidade/`, 404.
- `src/lib/sections/`: the five moments (`Hero`, `WhoFor`, `Demos`, `Plans`, `Night`).
- `src/lib/demos/`: `DemoFrame` (example note, recomeçar, reduced motion, hydration) and the four
  demos (`Vendedor` (Duá's chat, tab "Duá"), `Pedido`, `Cozinha`, `Loja`, each with its parts in a folder). `Demos.svelte`
  opens one from `?demo=<id>` or `#demo-<id>`.
- `src/lib/plans/`: the cards, the comparison table, the calculator and its cents math.
- `src/lib/components/`: `Section`, device frames, `Screen`, `Notification`, `LockScreen`, `Dua`,
  `Start` (the sign-up link), header, footer, SEO, 404; for inner pages `Band` (the dawn intro),
  `Closing` (the sunset call to action), `NextReads`, `KindArt` (the four shop drawings),
  `NichePage`, `Article` and `Prose`.
- `src/lib/pages.ts`: the inner pages; `src/lib/seo.ts`: the JSON-LD.
- `src/lib/content.ts`: site facts and the store's numbers; `src/lib/screens.ts`: screen registry.
- `src/lib/styles/`: `theme.css` (tokens) and `base.css` (layout and type classes).
- `static/`: `screens/`, `dua/`, `assets/brand/`, `og.png`.
- `scripts/`: assets, validate, postbuild, preview server, shots.

## Deploy

`build/` is the deliverable. The `site` stage of `storefronts/Dockerfile` builds it and copies it
into nginx with `nginx.conf`: each route is `route/index.html`, unknown paths get `404.html` with a
real 404 status, and there is no SPA fallback.
