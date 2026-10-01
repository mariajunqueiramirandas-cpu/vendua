# Menu import — "Cole o link do seu cardápio"

> Status: Proposed · Last reviewed: 2026-10-01 · Model gaps (§6) are being built first
> Roadmap: first tenant ([Phase 4](roadmap.md#phase-4--one-tenant-operated-for-real-weeks-1420-overlaps)) — Quero Pudim Gourmet moves from Instadelivery

Almost every merchant Venduá sells to already has a cardápio digital (Instadelivery, anota.ai,
Goomer, Cardápio Web…) or sells on iFood. Retyping 20–200 products, their photos, option groups,
hours, delivery fees and Pix is the biggest cost of switching, and the step most likely to stall
an onboarding. The merchant pastes the link to their store on the old platform; Venduá reads the
public menu the same way their customers' browsers do, shows what it found and what it couldn't
bring, and on confirmation builds the catalog and the store settings.

Feasibility was checked against nine platforms on 2026-10-01 ([§3](#3-platforms)), and the Quero
Pudim store was read and mapped end to end with a prototype ([§7](#7-quero-pudim--the-acceptance-case)).

## 1. Goals and non-goals

Goals:

- **One paste, the whole menu.** Categories, products, descriptions, prices, photos, option groups,
  stock and badges; plus the store: name, logo, cover, colours, WhatsApp, Instagram, address,
  hours, pickup/delivery, minimum order, prep time, delivery zones, payment methods and Pix.
- **Preview before writing.** Nothing is written until the merchant confirms, and existing
  settings are only replaced in the sections they tick.
- **Exact prices or nothing.** A product whose price Venduá would compute differently from the
  old store is imported hidden, with a note — never sold at a different price.
- **Say what didn't come over**, in the merchant's words, per product where it applies.
- Quero Pudim migrates with no hand edits to its catalog.

Non-goals (v1):

- Customers, order history, loyalty balances, reviews and coupons. None of it is on the public
  page, and the customer data is personal data (LGPD): moving it needs the merchant's export and a
  consent story, not an importer.
- iFood. It comes later through its official Merchant API with the merchant's authorization
  ([§9](#9-phases)).
- Keeping two stores in sync. The import is a one-shot copy.
- Reading screenshots or PDFs of a menu. Possible later as a fallback through the agent engine.
- Redirecting the old link or the QR codes printed with it.

## 2. What the merchant sees

The UI is designed separately, under `apps/admin/CLAUDE.md`; this section fixes the behaviour
and the API it consumes.

**Onboarding (`/bem-vindo`).** A new step `importar` right after `oi`
(`apps/admin/src/features/onboarding/Onboarding.tsx`, `ORDER`): "Já vende online? Cole o link do
seu cardápio", with a "Começar do zero" way out. While Core reads the store the step shows
progress; then a summary ("Encontramos 4 categorias, 23 produtos, 23 fotos, horários, Pix e 4
formas de pagamento") and the list of what won't come over. "Importar" applies it, and the later
steps (`nome`, `logo`, `whatsapp`, `frase`, `horarios`, `como`, `pix`, `produtos`) open prefilled,
so the merchant confirms instead of typing.

**Catálogo → "Importar cardápio"** for a store that already runs: the same preview, plus a choice
between adding to the current menu and replacing it. Replacing archives the current products
(orders keep referencing them) rather than deleting. The settings sections are checkboxes —
_Perfil e visual_, _Horários_, _Entrega e retirada_, _Pagamentos_ — on by default in onboarding,
off by default here.

**CRM (phase 2).** Lead discovery already classifies anota.ai, Instadelivery, Goomer and Takeat
URLs as listing evidence (`agent/channels/discovery.ts`, `LISTING_HOSTS`). On a lead with such a
URL, staff can import it into the store "criar loja" provisions, so the owner's invite lands on a
store that already has their menu. Same module, exposed on the control API with staff auth.

## 3. Platforms

Checked 2026-10-01, one or two public stores each, with a plain HTTP client and a headless browser.

| Platform        | Link the merchant pastes                        | How the menu is read                             | Verdict                                                   |
| --------------- | ----------------------------------------------- | ------------------------------------------------ | --------------------------------------------------------- |
| Instadelivery   | `instadelivery.com.br/<slug>`                   | 1 GET returns the whole store                    | Easy                                                      |
| Cardápio Web    | `app.cardapioweb.com/<slug>`, custom domain     | 2 GETs (profile; full menu with options inline)  | Easy                                                      |
| OlaClick        | `<sub>.ola.click`, custom domain                | host lookup, then 3–4 GETs                       | Easy                                                      |
| Delivery Direto | `deliverydireto.com.br/<brand>/<store>`         | 1 GET per category, plus fees and payment forms  | Easy                                                      |
| Takeat          | `pedido.takeat.app/<slug>`                      | 2–3 GETs                                         | Easy — filter dine-in-only data                           |
| Saipos          | `<slug>.saipos.com`, custom domain              | store lookup, then 1 GET (~500 KB)               | Easy — heavy filtering                                    |
| Goomer          | `<slug>.goomer.app`, custom domain              | info + menu, then 1 GET per product with options | Doable                                                    |
| anota.ai        | `pedido.anota.ai/loja/<slug>`                   | —                                                | Blocked from our test network ([§10](#10-open-questions)) |
| iFood           | `ifood.com.br/delivery/<city-uf>/<slug>/<uuid>` | —                                                | Blocked; later via the official API                       |

- Every readable platform served JSON to a plain HTTP client with no login, cookie or token —
  only ids the page itself sends (a store id header on Cardápio Web).
- anota.ai answered a hard Cloudflare block (403, "Sorry, you have been blocked") to both `curl`
  and a headless browser on the first request. iFood answered a Cloudflare managed challenge.
  Neither is worked around: no browser emulation, no challenge solving.
- These are the platforms' internal APIs: undocumented, unversioned, free to change any day.
  Adapters are expected to break, so a break must be cheap to notice and to fix
  ([§8](#8-testing)). [Appendix A](#appendix-a--platform-notes) records what each one returns.

## 4. Architecture

### 4.1 Module

A Core module per [ADR 0013](adr/0013-modular-monolith-core.md),
`packages/core/src/modules/menu-import/`:

| File                 | Job                                                                                     |
| -------------------- | --------------------------------------------------------------------------------------- |
| `doc.ts`             | The `MenuImportV1` type and `validateDoc()` — the one place Venduá's limits are applied |
| `adapters/<name>.ts` | One per platform, the `Adapter` contract below                                          |
| `http.ts`            | The module's only outbound HTTP: host allowlist, caps, pacing                           |
| `apply.ts`           | Writes a validated document into one tenant, in one transaction                         |
| `images.ts`          | Downloads, re-encodes and attaches photos, logo and cover                               |
| `routes.ts`          | `/admin/v1/imports/*` (and `/control/v1/…` in phase 2)                                  |
| `jobs.ts`            | `startMenuImportJobs()`, shaped like `startFleetJobs()` (`modules/fleet/jobs.ts`)       |

### 4.2 Adapter contract

```ts
interface Adapter {
  platform: Platform; // 'instadelivery' | 'cardapioweb' | …
  /** pure: is this pasted URL one of my stores? */
  match(url: URL): { ref: string } | null;
  /** every host http.ts may call for this adapter */
  hosts: { api: string[]; images: string[] };
  /** the only network step: reads the store through `http`, within its request budget */
  read(ref: string, http: ImportHttp): Promise<unknown>;
  /** pure: platform JSON -> Venduá document, including what was lost */
  map(raw: unknown, source: SourceInfo): MenuImportV1;
}
```

`map` is pure and carries the platform knowledge, so it is where the tests are
([§8](#8-testing)). Prices become integer cents here, in Core — Instadelivery and Goomer send
reais as floats, Takeat as decimal strings — through one `toCents()` that rounds floats
(`Math.round(x * 100)`) and parses `"12.90"`/`"12,90"` strings exactly. Nothing downstream
converts money again.

### 4.3 The import document

A platform-neutral document that mirrors the existing `/admin/v1` write payloads
(`routes-catalog.ts`, `routes-store.ts`, `routes-payments.ts`), so `apply` reuses their parsers.
Sketch — the code wins once it exists:

```ts
interface MenuImportV1 {
  v: 1;
  source: { platform: Platform; url: string; ref: string; readAt: string };
  store: {
    name?: string;
    tagline?: string;
    announcement?: string;
    whatsapp?: string;
    instagram?: string;
    address?: string;
    city?: string;
    coords?: { lat: number; lng: number };
    logoUrl?: string; // source CDN; re-hosted by images.ts
    coverUrl?: string;
    brandColor?: string; // one colour; tokens are derived, see below
  };
  hours?: { days: number[]; open: string; close: string }[];
  operations?: {
    minOrderCents?: number;
    prepTimeMinutes?: number;
    pickup?: boolean;
    delivery?: boolean;
  };
  zones?: ImportZone[]; // neighbourhood list, radius or polygon, with fee, per-km fee, ETA, free-over
  payments?: {
    methods: PaymentMethod[]; // includes 'meal_voucher'
    adjustments?: Record<PaymentMethod, { percentBps?: number; fixedCents?: number }>; // signed
    pix?: { key: string; type: string; beneficiary: string; city?: string };
  };
  categories: { name: string; description?: string; products: ImportProduct[] }[];
  lost: Lost[];
}

interface ImportProduct {
  name: string;
  description?: string;
  priceCents: number; // the selling price: a promo price lands here
  compareAtPriceCents?: number; // the old, struck-through price; must be > priceCents
  tags: string[]; // badges: "Novidade", "Mais vendido", …
  images: string[]; // source CDN URLs, at most 12
  status: 'active' | 'sold_out' | 'archived';
  stockQuantity?: number | null;
  availability?: { days: number[]; open: string; close: string }[];
  requiresPreorder?: boolean;
  optionGroups: {
    name: string;
    min: number;
    max: number;
    pricingRule?: 'sum' | 'average' | 'most_expensive'; // flavours; default 'sum'
    options: {
      name: string;
      priceDeltaCents: number;
      maxQty?: number; // "2x coco"; default 1
      description?: string;
      imageUrl?: string; // source CDN; re-hosted by images.ts
    }[];
  }[];
  kit?: ImportKit; // combo slots that reference other imported products
}

/** one thing that didn't come over; the admin owns the pt-BR copy for each code */
interface Lost {
  scope: 'store' | 'category' | 'product';
  subject?: string; // category or product name
  code: LostCode; // 'hidden_items' | 'loyalty' | 'delivery_by_address' | … (not the closed gaps in §6)
  detail?: string;
}
```

Colours: the admin's appearance screen derives the full token set from one accent with
`paletteFrom()` (`apps/admin/src/features/appearance/Colors.tsx`), and the token set must be
complete and pass `contrastProblems()` (`packages/templates/src/tokens.ts`). The import keeps one
`brandColor`; `paletteFrom` moves into `packages/templates` so Core and the admin derive tokens
the same way.

The seed (`packages/core/src/platform/seed-fixtures.ts`) has `SeedTenant`/`SeedProduct` shapes
close to this document. Once `apply` exists the seed builds a `MenuImportV1` and calls it — one
writer for "a whole menu", tested once.

### 4.4 Flow and endpoints

1. **`POST /admin/v1/imports` `{ url }`** — manager or owner, `Idempotency-Key` through the claim
   pattern (`platform/http.ts`). The URL is capped at 500 characters, must be `https`, and must
   match an adapter: otherwise 422 `IMPORT_UNSUPPORTED`, or `IMPORT_BLOCKED` with the platform
   name for anota.ai and iFood so the admin can say so. Inserts a `menu_imports` row in
   `reading` and answers 202 `{ id }`. At most one import in flight and five per hour per tenant.
2. **The job** claims `reading` rows (`for update skip locked`), runs `read` → `map` →
   `validateDoc` under the row's tenant, stores the document and its counts, and moves the row
   to `ready` — or `failed` with `NOT_FOUND`, `BLOCKED`, `UNREADABLE`, `TOO_LARGE` or `TIMEOUT`.
   The raw platform payload is never stored or logged ([§4.5](#45-outbound-requests)).
3. **`GET /admin/v1/imports/:id`** — status, counts, the preview (categories, product names,
   prices, source thumbnails) and `lost`. The admin polls it; an unknown id is a 404.
4. **`POST /admin/v1/imports/:id/apply` `{ mode: 'add' | 'replace', sections: Section[] }`** —
   `Idempotency-Key`; the transition `ready → applying` is a guarded update, so a double tap
   applies once and a second apply is a 409. One tenant transaction writes categories, products,
   option groups, kits, tags, stock and schedules, then each ticked section. _Pagamentos_ is
   owner-only, as `PATCH /payments` is; for a manager the section is off. Category names that
   already exist in `add` mode receive the products; slug collisions get a suffix; new categories
   sort after existing ones in source order. The row ends `applied` with the image work queued.
5. **Images** — for every product photo, the logo and the cover: download from the adapter's
   image hosts only (≤ 8 MB; JPEG, PNG or WebP), `processImage()` (`admin/media.ts`) to WebP
   plus variants, insert `media_objects`/`media_variants`, point `product_media` (or `logo_url`, or
   the home hero's `cover`) at `/v1/media/…`. Four at a time, at least 250 ms apart per host;
   progress is `images_done/images_total` on the row. A photo that fails becomes a `lost` entry
   and the product keeps its figure fallback. Source CDN URLs are never written into
   `product_media`: they disappear when the merchant cancels the old plan.
6. **Expiry** — a `ready` import not applied within 24 h becomes `expired` and its document is
   cleared; its prices would be stale.

`menu_imports` (one migration): `id`, `tenant_id` (RLS like every table), `created_by`,
`platform`, `source_url`, `status`, `error_code`, `doc jsonb` (≤ 2 MB), `counts jsonb`,
`mode`, `sections jsonb`, `images_total`, `images_done`, `created_at`, `applied_at`; index on
`(tenant_id, created_at desc)`.

### 4.5 Outbound requests

- `http.ts` only calls hosts the adapter declares, on URLs the adapter builds from the `ref` that
  `match` extracted. Redirects are handled manually and re-checked against the allowlist. No
  user-supplied host reaches a request in v1, so there is no SSRF surface. Custom domains
  (phase 2) need one fingerprinting GET to the merchant's own host, through a resolver that
  refuses private, loopback and link-local addresses after DNS.
- Caps: 10 s per request, 60 s per import, 5 MB per JSON response, 8 MB per image, 300 requests
  per import (Goomer reads options per product), at least 250 ms between requests to one host,
  at most two concurrent imports per platform.
- An honest `User-Agent` naming Venduá. No browser emulation, no cookies, no challenge solving.
  A 403, a 429 or a challenge page is `BLOCKED`, not a retry loop.
- **Allowlisted fields only.** `map` copies named fields and nothing else survives. At least one
  platform's public store payload carries what looks like a fiscal-API credential (reported to
  that vendor on 2026-10-01); a raw payload kept "for debugging" would put a third party's
  secret in our database and logs.

### 4.6 Limits: truncate, don't fail

`validateDoc` brings a document within Venduá's limits and records each cut in `lost`. Only an
oversized store fails the import.

| Field                 | Venduá limit                    | Import does                                               |
| --------------------- | ------------------------------- | --------------------------------------------------------- |
| Category name         | 60                              | truncate                                                  |
| Product name          | 2–120                           | truncate                                                  |
| Product description   | 1000                            | truncate on a word boundary                               |
| Tags                  | 12 × 30                         | keep the first 12                                         |
| Option groups         | 12 per product                  | product imported hidden + `lost`                          |
| Options               | 40 per group                    | product imported hidden + `lost`                          |
| Photos                | 12 per product                  | keep the first 12                                         |
| Price                 | 0–10,000,000 cents              | product imported hidden + `lost`                          |
| WhatsApp              | 10–13 digits                    | normalise (`+55`, drop formatting); drop if still invalid |
| Pix beneficiary, city | 25, 15                          | shorten + `lost`, so the merchant confirms the name       |
| Neighbourhoods        | 200 per zone                    | split into several zones with the same fee                |
| Store hours           | 28 windows                      | `lost` beyond 28                                          |
| Products per import   | 1000 (ours, not a Venduá limit) | fail `TOO_LARGE`                                          |

### 4.7 Invariants

- **Tenancy:** `menu_imports` has `tenant_id` and an RLS policy; the job and `apply` run under
  `withTenant` for the row's tenant. An import id from another tenant is a 404.
- **Money:** cents are computed in Core, in `map`; nothing else converts.
- **Idempotency:** both POSTs take an `Idempotency-Key` through the claim pattern; `apply` is
  additionally guarded by its status transition.
- **Bounded inputs:** URL, document and response sizes are capped; bad ids and wrong states are
  stable 4xx.
- **Storefronts and the Kernel:** untouched. The import writes the rows the admin writes, and
  stores read them through the Kernel as always.
- **Agent runs:** none. A future screenshot/PDF fallback would be requested through
  `requestAgentTx`.

## 5. Mapping onto Venduá today

| On the other platforms                                       | Venduá today                                                        | The import                                                                                |
| ------------------------------------------------------------ | ------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| Category and its order                                       | `categories` (name, sort)                                           | ✓                                                                                         |
| Category description                                         | `categories.description`                                            | ✓ — a category image is `lost`                                                            |
| Category / product hours by weekday                          | `products.availability_schedule` (≤ 7 windows)                      | ✓ — category hours are pushed down to its products                                        |
| Name, description, price, photo, badges                      | `products`, `product_media`, `tags`                                 | ✓ — badges become tags                                                                    |
| "A partir de" price                                          | base price + a required option group                                | ✓ when the options carry the price                                                        |
| Sizes / variants (Goomer, OlaClick, Saipos)                  | required group "Tamanho" (min 1, max 1)                             | ✓ exact: base = cheapest size, delta = size − cheapest                                    |
| Promo price with strike-through                              | `products.compare_at_price_cents`                                   | ✓ — sells at the promo price, the old price is struck through; promo schedules are `lost` |
| Option groups: min, max, required, price                     | `modifier_groups`, `modifiers`                                      | ✓                                                                                         |
| The same option more than once ("2x coco")                   | `modifiers.max_qty`, `cart_items.modifier_qty`                      | ✓ — priced × quantity in Core                                                             |
| Option description or image                                  | `modifiers.description`, `modifiers.image_url`                      | ✓ — image re-hosted                                                                       |
| Pizza: most expensive or average flavour                     | `modifier_groups.pricing_rule` (`sum`, `average`, `most_expensive`) | ✓ — computed by the cart                                                                  |
| Combos / kits                                                | `combo_slots`, `combo_slot_items` (≤ 8 slots)                       | ✓ when slots reference products; otherwise hidden + `lost`                                |
| Stock count, sold out                                        | `stock_quantity`, `sold_out`                                        | ✓                                                                                         |
| Hidden or paused items                                       | —                                                                   | absent from Instadelivery's payload, flagged elsewhere: skipped; empty categories noted   |
| Dine-in-only items and prices (Takeat, Saipos)               | —                                                                   | skipped; the delivery price wins                                                          |
| Hours with several shifts a day                              | `hours` windows (≤ 28)                                              | ✓                                                                                         |
| Delivery fee by neighbourhood                                | neighbourhood zones                                                 | ✓ — one zone per distinct fee                                                             |
| Delivery fee by km tier or per km                            | radius zones (smallest containing radius wins), `fee_per_km`        | ✓ — Venduá measures straight-line distance, platforms may use route distance: noted       |
| Delivery polygons (Delivery Direto, OlaClick, Saipos)        | `delivery_zones` kind `polygon`                                     | ✓ — neighbourhood, then polygon, then radius                                              |
| Fee only computed per address (Cardápio Web, Takeat, Saipos) | —                                                                   | `lost`; the merchant sets zones                                                           |
| Minimum order, prep time, pickup, ETA                        | `store_settings` operations, zone ETA                               | ✓                                                                                         |
| Payment methods                                              | `pix`, `cash`, `card_on_delivery`, `card_online`, `meal_voucher`    | ✓ by name; per-method discount or surcharge in `store_settings.payment_adjustments`       |
| Pix key and beneficiary                                      | `payments.pix`                                                      | ✓ (beneficiary ≤ 25)                                                                      |
| Logo, cover, colours                                         | `logo_url`, home hero `cover`, `storefront_tokens`                  | ✓ — re-hosted; one brand colour drives the token set                                      |
| Loyalty (points, cashback, stamps)                           | stamp card                                                          | `lost` — the merchant sets up the stamp card; balances aren't public                      |
| Coupons, referral, WhatsApp automations, upsell, time slots  | —                                                                   | `lost` (store-level notes)                                                                |

## 6. Model gaps — closed first

Decision (2026-10-01): the seven gaps below are closed **before** the importer, so no adapter ever
emits their `lost` codes. Each is additive and optional on every public surface (Contract 2): a Core
migration, the Core API, the admin editor, and one Kernel minor (1.11.0: `API.md`,
`CHANGELOG.md`; no new runtime export, so `test/api-surface.test.ts` is unchanged). Money stays
integer cents, computed in Core. Ranked by how many platforms need them:

| #   | Gap                                                                                                                            | Model                                                                                                                                                                                                                                                       | Migration |
| --- | ------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------- |
| 1   | **Promo price** — Instadelivery, Cardápio Web, OlaClick, Takeat, Saipos, anota.ai                                              | `products.compare_at_price_cents`, display only: the base price remains what the shopper pays; must exceed it                                                                                                                                               | 0065      |
| 2   | **Option quantity** — Instadelivery, Cardápio Web, OlaClick, Takeat, Delivery Direto                                           | `modifiers.max_qty` (1–20, default 1) and `cart_items.modifier_qty`; add-to-cart accepts `modifiers: [{id, qty}]`; group min/max count quantities; snapshots and reorder carry `qty`                                                                        | 0065      |
| 3   | **Flavour pricing rule** — Instadelivery, Cardápio Web, Delivery Direto, Saipos, Takeat, anota.ai. Makes pizzerias importable. | `modifier_groups.pricing_rule`: `sum` (today), `most_expensive`, or `average` (round half up over selected units); `unitPriceCents` is group-aware                                                                                                          | 0065      |
| 4   | **Category description** — Quero Pudim, Cardápio Web, OlaClick                                                                 | `categories.description` (≤ 500)                                                                                                                                                                                                                            | 0065      |
| 5   | **Option description and image** — Takeat, Cardápio Web, OlaClick                                                              | `modifiers.description` (≤ 200), `modifiers.image_url` (`https://` or `/v1/media/`)                                                                                                                                                                         | 0065      |
| 6   | **Delivery polygons** — Delivery Direto, OlaClick, Saipos                                                                      | zone kind `polygon`, `delivery_zones.polygon` (3–200 vertices); `resolveZone` order: neighbourhood, polygon (smallest area wins), radius; needs coordinates                                                                                                 | 0066      |
| 7   | **Per-payment discount or surcharge, meal vouchers** — Instadelivery, Cardápio Web, Delivery Direto                            | method `meal_voucher`; `store_settings.payment_adjustments` = `{ method: { percentBps?, fixedCents? } }`, signed, applied to subtotal minus coupon (never the delivery fee); `orders.payment_adjustment_cents`; the quote takes an optional `paymentMethod` | 0067      |

Once a gap lands, its adapter `lost` code (`promo_price`, `option_quantity`, `pizza_pricing`,
`category_description`, `option_details`, `delivery_polygon`, `payment_adjustment`) is retired.
Still `lost`: category image, promo schedules, per-option stock, fee computed only per address,
loyalty and the rest of §5.

## 7. Quero Pudim — the acceptance case

Read on 2026-10-01 from `instadelivery.com.br/queropudimgourmet` (one public request, 36 KB):

- **Comes over:** 4 categories and 23 products — prices, descriptions, one photo each, stock
  counts, "Novidade" and "Mais vendido" badges, two sold out; no option groups. Hours for all
  seven days, including Friday's two shifts. Pickup only (customers book their own Uber
  delivery, which the welcome message explains). Minimum order R$ 20, prep time 15 min. Pix,
  cash and card at pickup; the Pix key. Logo, cover, colours, WhatsApp, Instagram, address and the
  welcome message.
- **Doesn't:**
  - The items of _COMBOS_ and _PUDIM GOURMET_. Both categories are empty in the public payload
    because their items are hidden on Instadelivery today; the merchant re-enables them there
    before importing, or adds them in Venduá.
  - _PUDIM GOURMET_'s description ("Pudim lisinho, feito artesanalmente").
  - The points loyalty programme (six rewards) and the customers' balances, the referral
    programme, points for following on Instagram, the birthday and "saudade" WhatsApp messages,
    the checkout upsell and the 20-minute scheduling slots.
  - The Pix beneficiary is 38 characters; it is shortened to 25 for the merchant to confirm.
- Photos are 500×500 JPEG at quality 50 and the cover is 475×230: fine for product cards, thin
  for a hero. The preview should suggest a better cover.
- **Acceptance:** importing that URL into a fresh tenant yields a catalog that needs no edits, and
  a `lost` list that is exactly the above.

The quero-pudim seed fixtures are a hand-made approximation of the store and differ from it.

## 8. Testing

- **`map` per adapter**, on fixtures in `packages/core/test/fixtures/menu-import/<platform>.json`:
  the recorded payload shapes with synthetic content — no other merchants' names, phones or Pix
  keys. Quero Pudim's own payload with the owner's agreement. One fixture per hard case: pizza
  pricing rules, sizes, hidden items, option quantity, dine-in-only data, Saipos' option
  references that point at nothing.
- **`apply`** on the `vendua_test` database: fresh tenant, `add` and `replace`, a double apply
  writing once, another tenant's id answering 404, each truncation in [§4.6](#46-limits-truncate-dont-fail).
- **Images** against a local HTTP fixture server: off-allowlist host, oversized, wrong type.
- **No live calls in CI.** A staff script, `bun run import:probe <url>` in `packages/core`, runs
  `read` + `map` against the live platform and prints counts and `lost` — before a release, and
  when a merchant reports a failed import. Later, a weekly canary per platform from the fleet
  jobs can alert staff when an adapter starts failing.

## 9. Phases

1. **Model gaps** from [§6](#6-model-gaps--closed-first), first: Core migrations 0065–0067, the
   admin editors, and Kernel 1.11.0 with the storefront rendering (struck-through price, option
   quantity stepper and thumbnails, category description, payment adjustment line). Exit: each
   gap exercised end to end in Core tests and on a local store.
2. **Instadelivery end to end.** Core: document, `validateDoc`, `apply`, the image job, routes,
   the Instadelivery adapter; the seed writes through `apply`. Admin: the onboarding step and the
   Catálogo entry. Exit: Quero Pudim imported in production.
3. **More adapters**, one PR each with its fixtures: Cardápio Web, OlaClick, Delivery Direto,
   Takeat, Saipos, Goomer. Custom domains. The CRM import on a lead's store.
4. **iFood** through the official Merchant API: Venduá registered as an iFood app, the merchant
   authorizes it in the Portal do Parceiro ("Conectar iFood"), the catalog comes from
   `catalog/v2.0`. Its own design doc.

## 10. Open questions

1. **Terms of use.** The merchant consents to copying their own store; the platforms don't, and
   these are their internal APIs. Proposal: require the merchant's confirmation that the store is
   theirs, read nothing beyond the pasted store, and stop a platform if it asks.
2. **anota.ai** depends on where the block applies. One command on the production VPS decides it:
   `curl -sS -o /dev/null -w "%{http_code}\n" https://pedido.anota.ai/loja/<slug>`. A 200 means an
   adapter is worth building; a 403 means no server-side import, and the admin points those
   merchants to iFood (anota.ai belongs to iFood; many merchants have both) or manual entry.
3. **Ownership.** Anyone can paste anyone's link, but an import only writes into the paster's own
   store, so the harm is copying a competitor's menu. Proposal: warn, without blocking, when the
   source store's WhatsApp (exposed by Instadelivery, Cardápio Web and OlaClick) differs from the
   account's phone.
4. **Loyalty.** Should the import offer a stamp card derived from the old points programme? The
   default is no: a `lost` note and the merchant decides.

## Appendix A — platform notes

What a public store returned on 2026-10-01. Internal APIs; expect drift.

- **Instadelivery** — `GET app.instadelivery.com.br/api/stores/by-slug/<slug>`. `groups[]` (order,
  `is_pizza`, weekday flags, hours) → `itens[]` (`price1` in reais, `from_price`, `strike_price`,
  `image` + `image_2…5` on a DigitalOcean Spaces CDN, `stock_control`/`stock`, `is_best_seller`,
  `is_newest`, `custom_tag*`, `points`, weekday flags) → `complementos[]` (min, max, options with
  price; options can repeat; pizza groups charge the most expensive flavour). Store: `times`
  (per shift), `payment_methods[]` by name, `fees` (neighbourhood), `feesKm`, `minimum_order`,
  `wait_time`, `take_out`, `pix`/`pix_type`/`pix_infos`, `design` (logo, background, colours).
  Hidden items are absent.
- **Cardápio Web** — `GET integracao.cardapioweb.com/api/menu/company/profile?company=<slug>`,
  then `…/company/categories?only_available_for=delivery` with headers `company-id` and `company`.
  Promo price and its weekday schedule, badges, stock, `allowed_times`, `combo_steps`; add-ons
  SINGLE / MULTIPLE / SUMMABLE (quantity per option); `price_calculation_type` MAX or SUM for
  flavours. Store: colour, logo, cover, hours with several ranges, minimum order, prep time,
  payment methods with fees. Delivery fees are computed per address.
- **OlaClick** — `GET api.olaclick.app/ms-companies/public/hosts/<host>` → company id; then
  `ms-products/public/companies/<id>/categories` (menu with modifiers), the company,
  `ecommerce-settings` and `ms-orders/…/payment-methods`. Variants with `price` and
  `original_price`, per-variant stock, modifiers with min/max and a per-option `max_limit`.
  Delivery types: fixed, per km, districts, ranges, area.
- **Delivery Direto** — `GET <base>/categories`, then `<base>/categories/<id>?include=items,properties`
  per category, plus `<base>/delivery/fees` and `<base>/payment-forms`. `price_calculation_type`
  AVERAGE or HIGHER; options with `max_choices`; per-weekday availability; fees by circle or
  polygon.
- **Takeat** — `GET backend-delivery.takeat.app/public/restaurant/<slug>` → restaurant and brand
  ids; then `…/public/restaurants/menu/<id>?brand_id=<brand>` and `…/delivery-schedules/<id>`.
  `price` (dine-in) vs `delivery_price`, promo prices, tags, `complement_categories` with
  `use_average`/`more_expensive_only` and per-option limits. Includes dine-in-only categories and
  items that must be filtered. The store payload contains credential-like fields: map by
  allowlist only.
- **Saipos** — `GET delivery-api.saipos.com/v1/stores?filter={"domain_name":"<host>"}`, then
  `…/stores/<id>/sales/view-data` (~500 KB). Sizes as `variations[]`, `calc_method` 1 sum,
  2 average, 3 most expensive. Many items sit in disabled categories and many option references
  point at groups missing from `choices[]`: filter both.
- **Goomer** — `GET api-go.goomer.app/v2/establishments/<slug>/info`, then the menu URL it names,
  then one option-group request per product. Sizes as `prices[]`; option groups with min, max and
  `repeat`; settings as ~180 `mm_*` keys, many holding JSON strings. Many stores are dormant.
