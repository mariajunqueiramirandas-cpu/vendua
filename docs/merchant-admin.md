# Merchant admin — the store owner's product

> Status: In progress (planning) · Last reviewed: 2026-09-27
> Roadmap track: [Track A](roadmap.md#track-a--merchant-admin-the-current-focus) — the current focus

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
its own typed client for `/admin/v1`. Until the Edge lands (Phase 4) Core
serves the built app at `/admin/` like the CRM; afterwards it moves to
`admin.vendua.com.br`. Copy is pt-BR.

## Milestones

Each milestone ends with a usability session and a screenshot review against
the design bar. It is not done until both pass.

### A0 — Foundations and the design system

- [ ] Brand and visual direction for the admin: type pairing, palette, motion,
      illustration style; mockups for Início, Pedidos, Cardápio and Aparência
      at 375/820/1440 in both themes, signed off.
- [ ] `apps/admin` scaffold: shell (bottom nav on phones, sidebar on desktop),
      routing, query client, theme, PWA manifest, the component library and a
      living `/_ui` reference.
- [ ] Merchant identity ADR + `merchant_users`, phone-OTP login, tenant-scoped
      sessions, roles; `/admin/v1` skeleton with the audit log.
- [ ] CI: typecheck, build, screenshot + overflow, axe, Lighthouse budget.

Exit: a merchant logs in on their phone and lands on a designed, empty Início.
The design system is the reference every later screen is built from.

### A1 — Run the day

- [ ] Pedidos: live board, new-order alert with push, accept/prepare/dispatch/
      deliver, cancel, kitchen ticket print, WhatsApp the customer, history.
- [ ] Loja: open/pause with message, hours, holidays, delivery zones on a map,
      fees, minimum order, store profile.
- [ ] Início v1: status, waiting orders, today's sales, setup checklist.

Exit: the Quero Pudim owner runs a full day of real orders from the admin on
their phone with no staff help.

### A2 — The menu

- [ ] Cardápio: products, categories, modifiers, kits, availability,
      stock, preorder rules, bulk edit.
- [ ] Media uploads with crop and resizing; drag-to-reorder galleries.

Exit: a merchant builds a 30-item menu with photos from scratch on a phone in
under 30 minutes (timed in a usability session).

### A3 — Money

Lands with Phase 3's Mercado Pago work.

- [ ] Pagamentos: MP connect and token health, Pix, methods, per-order payment
      status, refunds, fee statement.
- [ ] Admin notices for `expiring` / `disconnected` / `restricted`
      ([13](architecture/13-payments.md)).

Exit: [Phase 3's exit](roadmap.md#phase-3--payments--self-serve-signup-weeks-1216).
A merchant edits their catalog and hours and receives paid PIX orders with no
engineer involved, entirely through the admin.

### A4 — Grow

- [ ] Clientes: list, profile, history, loyalty, LGPD export and delete.
- [ ] Marketing: coupons, loyalty setup, waitlist, share links, announcement.
- [ ] Relatórios: rollups + sales, products, peak hours, funnel, zones, repeat
      rate, CSV.

Exit: a merchant creates a coupon, shares it and sees its redemptions and
revenue in Relatórios the same day.

### A5 — Appearance

- [ ] Page editor with live preview: reorder, settings and copy, images,
      migration-placed toggles (removals recorded as tombstones), tokens
      with the inline AA check, history and restore, publish status.

Exit: a merchant changes their home page and colors and sees it live, with
no staff and no agent. Post-launch agent-minutes stay at ~0
([metrics](roadmap.md#metrics-that-gate-growth)).

### A6 — Team, account and plan

- [ ] Equipe: invites, roles, activity log.
- [ ] Conta e plano: plan and invoices (Phase 3 billing), store address,
      notification preferences; Ajuda with "falar com a Venduá".
- [ ] Onboarding: a first-run flow that takes a freshly provisioned store
      (Phase 4) to "ready to sell" (profile, hours, zones, MP, first products).

Exit: a self-serve signup reaches its first paid order through the admin with
zero staff involvement. This is the admin's half of the First-store gate.

## Done means

- Every capability the staff commerce and template APIs expose is reachable
  by the merchant in the admin. Staff can still do everything, but nothing
  _needs_ them.
- Every area passes the design bar: signed-off mockups, the CI gates, and a
  usability session with real merchants.
- A merchant would show it to another merchant. That is the real test.
