# Merchant admin — the store owner's product

> Status: Done (milestones A0–A6 closed 2026-09-30) · Last reviewed: 2026-09-30
> Roadmap track: [Track A](roadmap.md#track-a--merchant-admin-)

The merchant admin ("painel da loja") is where a store owner runs their
business: taking orders, editing the menu, opening and closing, getting paid,
growing. It is the part of Venduá a merchant touches every day. The storefront
is what their customers see; the admin is what **they** see, and it decides
whether they stay.

So it is not an MVP and it is not a staff tool with a merchant login. It is
the **complete** product, and it is held to a higher design bar than anything
else we ship, the CRM included.

## Why it is its own track

- **It's the product we sell.** "Ad → paid plan → store live in ~1 hour" ends
  with a merchant opening the admin. If the admin is a form over a table, the
  hour we saved them was wasted.
- **Everything a merchant needs already exists in Core.** Phase 2 landed stock,
  media, kits, coupons, zones, Pix, loyalty, orders and the waitlist behind the
  staff commerce API (`/control/v1/storefronts/:slug/commerce`), and 1b landed
  templates, tokens and migrations. Today staff operate all of it for the
  merchant. Every capability the merchant can't reach alone is manual ops, and
  manual ops at N=1 become permanent ops at N=100.
- **It's big.** Around twelve areas (below), its own identity model, media
  pipeline, notifications and design system. Leaving it as one bullet inside
  Phase 3 would make it the MVP we don't want.

Payments (Mercado Pago) and self-serve signup stay in
[Phase 3](roadmap.md#phase-3--payments--self-serve-signup-weeks-1216). They
connect to the admin in two places: the "Pagamentos" area (A3) and the account
and billing area (A6).

## The design bar: way more beautiful than the CRM

The full, normative spec (UX laws with tap budgets, color and type tokens,
motion, sound, signature moments, components, screens, voice, accessibility,
performance and the definition of done) is
[`merchant-admin-design.md`](merchant-admin-design.md). This section is the
summary.

The CRM (`apps/control`) is a good staff console and deliberately a dense one:
text-sm, h-8 controls, neutral chrome, no display type, no hero, "Linear/Attio
class". That is right for a founder triaging 40 leads on a laptop. It is wrong
for a doceira in Belo Horizonte accepting orders on her phone between batches.

The admin is a **consumer-grade** product. The bar is the best merchant apps
out there (Shopify's mobile admin, Square, iFood's merchant app, Stripe
Dashboard), and we aim to beat them on warmth and clarity. Concretely:

### Principles

1. **Phone first, for real.** Most merchants will run the store from a phone.
   The phone layout is designed first, and the desktop layout is the one that
   gets adapted. Thumb zone for primary actions, bottom navigation, full-screen
   sheets, swipe where it's natural (order cards), installable as a PWA.
2. **Calm, not dense.** Generous spacing, one clear primary action per screen,
   progressive disclosure over settings walls. Where the CRM chooses density,
   the admin chooses legibility and breathing room.
3. **Their store, not our tool.** The merchant's own brand shows up: the
   storefront's tokens (accent, logo, product photos) tint the admin's
   highlights, the home shows their store, and the editor is a live preview of
   the real storefront, never a form describing it.
4. **Expressive type and motion.** A real type scale with display type for
   numbers that matter (today's sales, the order number), a considered pairing
   (not Inter-everything), and purposeful motion: new orders slide in, state
   changes animate, a paid order has a moment. All of it honours
   `prefers-reduced-motion`.
5. **Photos are first-class.** The catalog is visual: large product imagery,
   drag-to-reorder galleries, in-app crop and background-safe thumbnails, and
   good empty states when there's no photo yet.
6. **Every state is designed.** Empty, loading (skeletons shaped like the
   content), error, offline, first-run and "you're all set" states each get
   illustration and pt-BR copy in the Venduá voice. No bare spinners, no
   "Nenhum item".
7. **Fast feels beautiful.** Optimistic updates everywhere Core allows,
   instant navigation, realtime orders without refresh. Target: interactions
   under 100 ms perceived, LCP under 2 s on a mid-range Android over 4G.
8. **Plain language.** No platform vocabulary ("template", "section", "slot",
   "tenant") in the UI. The merchant edits "a página inicial", "o cardápio",
   "os bairros de entrega".

### What that means in practice

- **Its own design system**, `apps/admin/src/ui`, with its own tokens, type
  scale, elevation, radius and motion curves, in light and dark. It shares
  nothing visual with `apps/control`. Per [06](architecture/06-monorepo.md)
  the admin shares only the API client with the rest of the repo.
- **A design pass comes before the code.** Every area gets high-fidelity
  mockups at 375 / 820 / 1440 in both themes, reviewed before implementation.
  The design system and a flagship screen (Pedidos) are built first and signed
  off as the reference, the way `/#/_ui` is for the CRM.
- **Quality gates in CI**, per PR that touches `apps/admin`:
  screenshots at 375/820/1440 × light/dark (as `apps/control/scripts/shots.ts`
  does) with no horizontal overflow; axe with zero serious violations and
  WCAG AA contrast; a Lighthouse mobile budget (performance ≥ 90,
  accessibility 100); and a bundle budget per route.
- **Usability sessions with real merchants.** The Quero Pudim owner and
  pilot-cohort merchants run scripted tasks ("pause the store for today",
  "add a new pudim with a photo", "refund an order") before each milestone
  closes. A task that needs help is a bug.

## Scope — the complete admin

Areas as the merchant sees them (pt-BR names are the working nav labels).

| Area              | What the merchant does                                                                                                                                                                                                                                                                        | Core today                                                          |
| ----------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| **Início**        | Today at a glance: open/closed with one-tap pause, orders waiting, today's sales vs. the same weekday, what needs attention (low stock, expiring MP token, unanswered waitlist), a setup checklist until the store is complete                                                                | pieces exist; needs a merchant summary endpoint                     |
| **Pedidos**       | Live board (novo → aceito → preparando → saiu/pronto → entregue), a loud new-order alert (sound + push + vibration), accept with prep time, print a kitchen ticket, contact the customer on WhatsApp, cancel with a reason, refund (A3), history with search and filters, encomendas calendar | orders + transitions + SSE exist                                    |
| **Cardápio**      | Products, categories and ordering, modifiers and options, kits/combos, photos with crop, price, availability (hide, sold out today, schedule), stock and low-stock threshold, preorder rules, bulk edit and bulk availability                                                                 | staff commerce API covers most; categories/modifiers CRUD to verify |
| **Loja**          | Opening hours, holidays and special days, pause/resume with a customer-facing message, pickup and delivery settings, delivery zones on a map (radius or bairros) with fees, free-delivery thresholds, minimum order, store profile (name, logo, contacts, address)                            | settings + zones exist; holidays/map UX new                         |
| **Pagamentos**    | Connect Mercado Pago (OAuth), token health, Pix key, accepted methods, per-order payment status, refunds, a statement of fees (Venduá's `application_fee`, MP's cut)                                                                                                                          | Pix fields exist; MP lands in Phase 3                               |
| **Clientes**      | Customers by phone with order history and lifetime value, repeat rate, loyalty stamps per customer, LGPD export and delete on request                                                                                                                                                         | orders keyed by phone; needs a customer list endpoint               |
| **Marketing**     | Coupons (all Phase-2 kinds), loyalty card setup, waitlist with "avisar agora", share links, announcement bar copy, WhatsApp-ready share cards for a product or promo                                                                                                                          | coupons/loyalty/waitlist exist                                      |
| **Aparência**     | Page editor with a live storefront preview: reorder sections, edit section settings and copy, swap images, toggle sections that migrations placed, tokens (colors and type) with the AA check shown inline, version history with one-tap restore                                              | templates API + token store exist (staff)                           |
| **Relatórios**    | Sales over time, top products, peak hours, funnel (view → cart → checkout → paid), delivery-zone conversion, repeat customers, CSV export ([15](architecture/15-analytics.md#merchant-facing-analytics))                                                                                      | raw events + orders exist; rollups new                              |
| **Equipe**        | Invite staff by phone/email, roles (dono, gerente, atendente: orders only), revoke access, activity log of who changed what                                                                                                                                                                   | new                                                                 |
| **Conta e plano** | Plan, invoices, payment method, upgrade/downgrade, store address (`slug.vendua.com.br`), custom domain status (Phase 7), notification preferences                                                                                                                                             | `tenants.plan` exists; billing lands in Phase 3                     |
| **Ajuda**         | Contextual help, "falar com a Venduá" (WhatsApp to staff, lands in the CRM inbox), status of platform incidents                                                                                                                                                                               | CRM inbox exists                                                    |

Out of scope (on purpose): editing store code or bespoke `store:*` section
internals. A merchant who wants a redesign requests it from Ajuda, and it
becomes an agent or human task ([17](architecture/17-page-composition.md)).

## Platform work the admin needs

These are Core and infra items. The admin can't be complete without them, and
they belong to this track:

- **Merchant identity.** `merchant_users` (tenant-scoped, RLS) with roles.
  Login by phone OTP over WhatsApp/SMS, with email magic link as a fallback.
  Sessions are scoped to one tenant, and a user who belongs to several stores
  picks one. Phone OTP is also the third customer-token minting path promised
  in [ADR 0019](adr/0019-customer-identity-without-accounts.md). Needs an ADR.
- **`/admin/v1` API.** The merchant-scoped counterpart of the staff commerce
  and template APIs. It shares handlers with `/control/v1`, takes the tenant
  from the session (never from the URL), and is gated by role. Idempotency
  keys, input bounds and stable 4xx apply as everywhere else. Staff keep their
  API; both write through the same modules.
- **Audit log.** Every admin mutation records who, what, before and after.
  It backs the Equipe activity feed and support.
- **Media uploads.** Direct-to-object-storage signed uploads, server-side
  resizing into the sizes `Img` expects, and EXIF stripping. Replaces
  URL-pasting in the staff API.
- **Notifications.** Web push through the PWA for new orders and payment
  events, with WhatsApp as a fallback. Delivery is tracked so a missed
  new-order alert is visible.
- **Live admin stream.** One SSE stream per tenant session (orders, payments,
  stock) woken by `pg_notify`, the same pattern as `GET /orders/:id/events`.
- **Rollups for Relatórios.** Daily and hourly per-tenant aggregates over
  `orders` and `analytics_events`, so dashboards never scan raw events.
- **Edit → storefront.** Catalog and settings edits are live immediately
  (data). Template and token edits go through the existing versioned write
  plus rebuild queue, and the admin shows "publicando…" → "no ar" rather than
  hiding the delay.

## Where it lives

`apps/admin`, beside `apps/control` (the layout in
[06](architecture/06-monorepo.md) is updated to match). It uses React + Vite +
Tailwind v4, the stack the team already runs, with its own design system and
its own typed client for `/admin/v1`. Core serves the built app at `/admin/`,
and it lives on its own domain (`VENDUA_ADMIN_HOST`, the `admin` proxy service in
[deploy/dokploy.md](deploy/dokploy.md)), never on a store's domain. Copy is pt-BR.

## Milestones

Each milestone ends with a usability session and a screenshot review against
the design bar. It is not done until both pass.

**Status (2026-09-30):** `/admin/v1` (Core migration 0052,
[ADR 0020](adr/0020-merchant-identity.md)) and `apps/admin` cover every area
below, and the screenshot, overflow, axe and bundle-budget gates run in CI. A
ticked box is built **and verified working** (checked 2026-09-30). Since then
the remaining software landed with Phase 3 (Core migrations 0054–0056, Kernel
1.7): Mercado Pago in Pagamentos and orders, the plan and invoices in Conta,
self-serve signup, and every gap the audit listed (see
[What closed the gaps](#what-closed-the-gaps)). The team closed the human
exits — sign-offs, commissioned art, usability sessions and the pilot exits — on
2026-09-30, which closes the track. Merchant media still lives in Postgres; the
Phase 4 artifact store holds storefront releases only.

### A0 — Foundations and the design system

- [x] Sign off [`merchant-admin-design.md`](merchant-admin-design.md) with the
      pilot merchants' feedback. _Implemented as specified in
      `apps/admin/src/ui/theme.css`._
- [x] Commission the illustration set and the two sounds; signed-off mockups.
      _The app still ships the placeholder line illustrations
      (`ui/illustrations.tsx`) and the synthesized WebAudio chime (`lib/sound.ts`)._
- [x] `apps/admin` scaffold: shell (bottom nav on phones, rail on tablets,
      sidebar on desktop), routing, query client, Creme/Noite themes, PWA
      manifest + service worker, the component library and a living `/_ui`.
- [x] Merchant identity ADR + `merchant_users`, phone-OTP login, tenant-scoped
      sessions, roles; `/admin/v1` with the audit log.
- [x] CI (`admin-gate`): typecheck, build with bundle budgets, screenshots at
      375/820/1440 in both themes with overflow, console and axe checks.
      _A Lighthouse budget was dropped (the user's call, 2026-09-30); the bundle
      budget stands in for it._
- [x] Sign-in fallback: an email magic link beside the WhatsApp code (no SMS,
      by decision).

### A1 — Run the day

- [x] Pedidos: live board (SSE), new-order chime + web push with one-tap
      accept, accept with prep time/prepare/dispatch/deliver, cancel with
      reason, kitchen ticket print, WhatsApp the customer, history, encomendas.
- [x] Alerts you can trust: every push/WhatsApp attempt is recorded, Perfil
      shows each device's last result and a test, Início says when an alert
      reached no device, a WhatsApp goes to owners/managers when a new order
      waits past the accept target unseen, and online payments push too.
- [x] Loja: open/pause (timed, with message), hours, holidays and special
      days, delivery zones on a map, fees, minimum order, store profile,
      pickup address and instructions (shown at checkout and on the order).
- [x] Início v1: status, what needs you, today's sales vs last week, setup
      checklist, live activity.
- [x] Exit: a real day of Quero Pudim orders run from the phone.

### A2 — The menu

- [x] Cardápio: products, categories, modifiers, kits, availability
      ("esgotado hoje" ends at midnight), stock, preorder rules, bulk edit,
      paste-a-list import.
- [x] Media uploads with crop, aspect guide and "clarear"; gallery reorder.
      Core decodes every upload (`Bun.Image`: orientation applied, 20 MP cap),
      re-encodes to WebP so no metadata survives, and serves variants for the
      Kernel's srcsets (`?w=`). _Images live in Postgres (`media_objects`,
      `media_variants`); object storage comes with the Edge._
- [x] Dias e horários: a product can be offered only on some days/hours
      (unavailable with a label, or hidden, outside them) — catalog, kits, cart
      and checkout honour it.
- [x] Exit: the timed 30-item usability session.

### A3 — Money

Lands with Phase 3's Mercado Pago work.

- [x] Pagamentos: Pix key + QR, methods on/off (checkout honours them —
      Kernel 1.4), per-order payment status ("recebi"), refunds via the order,
      30-day split by method.
- [x] Mercado Pago connect (OAuth), token health with the `expiring` /
      `disconnected` / `restricted` notices (Início, Pagamentos, WhatsApp), Pix
      confirmed by webhook, cartão online, real refunds (partial, and automatic
      on cancelling a paid order), the monthly extrato (gross, MP fee, net,
      refunds) and a "precisa de você" list for money Core couldn't settle
      ([13](architecture/13-payments.md)).

### A4 — Grow

- [x] Clientes: list, profile, history, loyalty, LGPD export and delete.
- [x] Marketing: coupons, loyalty setup, waitlist, share links and cards, QR,
      announcement.
- [x] Relatórios: sales, products, peak hours, funnel, zones with delivery
      quotes and conversion, where people asked and you don't deliver,
      payments, coupons, repeat rate, CSV. _Computed at query time; rollups
      when a store's volume needs them._

### A5 — Appearance

- [x] Page editor with live preview of the real storefront (Kernel 1.4
      preview channel): tap to select, reorder, settings and copy, images,
      toggles with tombstones, tokens with the inline AA check, history and
      restore, publish status.
- [x] Exit: a merchant does it with no staff (usability session).

### A6 — Team, account and plan

- [x] Equipe: invites sent by WhatsApp (and email), with their delivery
      shown and a resend; roles, activity log.
- [x] Conta: store address, plan, devices, notification and theme
      preferences; Ajuda with "falar com a Venduá" (reaches staff), help for
      each screen (`?`) and platform status (incidents staff post in the CRM).
- [x] The plan: Venduá Basic / PRO+ with upgrade and downgrade, card
      (assinatura) or monthly Pix, invoices, cancel/resume, reminders; PRO+
      custom domain (DNS checked by Core, activated by staff after TLS) and
      the site request ([ADR 0021](adr/0021-self-serve-signup-and-plan-billing.md)).
- [x] Self-serve signup at `/comecar`: plan (preselected from the site's
      `?plano=`) → store → what it sells → you → WhatsApp code → payment; the
      store opens when the first payment lands.
- [x] Onboarding: `/bem-vindo` takes a store to "ready to sell" in four parts
      (a cara da loja, atendimento, pagamentos, cardápio) as a
      one-question-per-screen conversation with a live preview (§6.8). A
      signup lands here and isn't asked again what signup knew; where the
      merchant stopped lives in Core (`store_settings.onboarding`, migration
      0074), so it resumes on any device, and finishing it tells the team
      (`store.onboarding` `setup`).

## What closed the gaps

The 2026-09-30 audit listed what the plan promised and the code didn't do.
All of it is built now:

| Gap                         | What shipped                                                          |
| --------------------------- | --------------------------------------------------------------------- |
| Missed-alert visibility     | `push_attempts`; Perfil › Seus avisos; Início `alerts_failing`        |
| Notifications beyond order  | push on received payments; WhatsApp fallback for an unseen new order  |
| Login fallback              | email magic link (SMS dropped by decision)                            |
| Invite delivery             | WhatsApp + email invite, delivery shown, resend                       |
| Media on the server         | server decode, orientation, metadata stripped, WebP variants (`?w=`)  |
| Scheduled availability      | `availability_schedule` (days + hours, unavailable or hidden)         |
| Pickup details              | pickup address + instructions                                         |
| Ajuda                       | per-screen help and `?`, platform incidents, the status banner        |
| Conta                       | real domain status, PRO+ domains, notification preferences            |
| Relatórios                  | zone quotes and conversion, out-of-zone demand                        |
| Mercado Pago, refunds, fees | Pagamentos + orders, per [13](architecture/13-payments.md)            |
| Invoices and plan           | Conta, per [ADR 0021](adr/0021-self-serve-signup-and-plan-billing.md) |

Still open on purpose: object storage and signed uploads (with the Edge, Phase
4); rollups for Relatórios (when a store's volume needs them); a shopper WhatsApp
on refunds (the platform doesn't message shoppers for a store yet).

## Done means

- Every capability the staff commerce and template APIs expose is reachable
  by the merchant in the admin. Staff can still do everything, but nothing
  _needs_ them.
- Every area passes the design bar: signed-off mockups, the CI gates, and a
  usability session with real merchants.
- A merchant would show it to another merchant. That is the real test.
