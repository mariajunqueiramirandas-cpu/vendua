# Menu import — "Cole o link do seu cardápio"

> Status: Phase 2 built (Instadelivery end to end: Core 0069 + `modules/menu-import`, admin onboarding step and Cardápio › Importar, CRM import on a lead's store) · Last reviewed: 2026-10-01 · Model gaps (§6) are built (Core 0065–0067, Kernel 1.12.0, admin) · Next: phase 3, planned step by step in [menu-import-phase3.md](menu-import-phase3.md)
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

**Onboarding (`/bem-vindo`).** A step `importar` right after `oi`
(`apps/admin/src/features/onboarding/Onboarding.tsx`, `ORDER`): "Já vende online? Cole o link do
seu cardápio", with a "Começar do zero" way out. While Core reads the store the step shows
progress; then a summary ("Encontramos 4 categorias, 23 produtos, 23 fotos, horários, Pix e 4
formas de pagamento") and the list of what won't come over. "Importar" applies it, and the later
steps (`nome`, `logo`, `whatsapp`, `frase`, `horarios`, `como`, `pix`, `produtos`) open prefilled,
so the merchant confirms instead of typing.

**Catálogo → "Importar cardápio"** (`/cardapio/importar`; header button, empty state, and a row
under the list on phones) for a store that already runs: the same preview, plus a choice
between adding to the current menu and replacing it. Replacing archives the current products
(orders keep referencing them) rather than deleting. The settings sections are checkboxes —
_Perfil e visual_, _Horários_, _Entrega e retirada_, _Pagamentos_ — on by default in onboarding,
off by default here.

Both use one component, `apps/admin/src/features/import/ImportFlow.tsx`: paste → "Lendo o
cardápio…" (polls, and the live stream's `import` topic refreshes it) → preview (counts, the menu
with source thumbnails, the section toggles, "o que não vem igual" split into products that come
over hidden for review and everything else) → "Essa loja é minha" (§10.1) → "Importar" → photos
progress. The pt-BR line for every `lost` code lives in `features/import/copy.ts`. An unfinished
import (reading, or a preview not applied within a day) is picked up again when the screen opens.

**CRM.** Lead discovery already classifies anota.ai, Instadelivery, Goomer and Takeat
URLs as listing evidence (`agent/channels/discovery.ts`, `LISTING_HOSTS`). On a lead with such a
URL, staff can import it into the store "criar loja" provisions, so the owner's invite lands on a
store that already has their menu. Same module, exposed on the control API with staff auth.
Built: "importar cardápio" in the lead's _loja_ panel (`apps/control/src/features/lead/LeadImport.tsx`,
prefilled from the lead's site when it is an Instadelivery link) over
`/control/v1/stores/:slug/imports` and `/control/v1/imports/:id[/apply|/discard]`. Staff tick
_Perfil e visual_, _Horários_ and _Entrega e retirada_, never _Pagamentos_ (the owner's, and the
Pix key is masked for them), confirm the merchant asked for it, and the audit entry reads "equipe
Venduá".

## 3. Platforms

Checked 2026-10-01, one or two public stores each, with a plain HTTP client and a headless browser.
Phase 3 re-checked every chain the same day, before writing any adapter
([plan, step 1](menu-import-phase3.md#2-step-1--verify-the-payloads-gate)): the last column is that
verdict, and [Appendix A](#appendix-a--platform-notes) has the drift under each platform.

| Platform        | Link the merchant pastes                               | How the menu is read                                            | Effort                          | Step 1 (2026-10-01)                 |
| --------------- | ------------------------------------------------------ | --------------------------------------------------------------- | ------------------------------- | ----------------------------------- |
| Instadelivery   | `instadelivery.com.br/<slug>`                          | 1 GET returns the whole store                                   | Easy                            | Works as documented                 |
| Cardápio Web    | `app.cardapioweb.com/<slug>`, custom domain            | 2 GETs (profile; full menu with options inline)                 | Easy                            | Works with drift                    |
| OlaClick        | `<sub>.ola.click`, custom domain                       | host lookup, then 4 GETs                                        | Easy                            | Works as documented                 |
| Delivery Direto | `deliverydireto.com.br/<brand>/<store>`, custom domain | brand info, categories, 1 GET per category, fees, payment forms | Easy                            | Works with drift                    |
| Takeat          | `pedido.takeat.app/<slug>`                             | 3–4 GETs                                                        | Easy — filter dine-in-only data | Works with drift                    |
| Saipos          | `<slug>.saipos.com`, custom domain                     | store lookup, then 1 GET (0.04–1.2 MB)                          | Easy — heavy filtering          | Works as documented                 |
| Goomer          | `<slug>.goomer.app`, custom domain                     | info + menu, then 1 GET per product (options)                   | Doable                          | Works with drift                    |
| anota.ai        | `pedido.anota.ai/loja/<slug>`                          | —                                                               | —                               | Blocked ([§10](#10-open-questions)) |
| iFood           | `ifood.com.br/delivery/<city-uf>/<slug>/<uuid>`        | —                                                               | Later, via the official API     | Blocked                             |

- Every readable platform served JSON to a plain HTTP client with no login, cookie or token —
  only ids the page itself sends (a store id header on Cardápio Web).
- anota.ai answered a hard Cloudflare block (403, "Sorry, you have been blocked") to both `curl`
  and a headless browser on the first request. iFood answered a Cloudflare managed challenge.
  Neither is worked around: no browser emulation, no challenge solving. On the step 1 re-check,
  iFood answered the same challenge (403, "Just a moment"); anota.ai answered a store page with
  200 (its app shell, behind Cloudflare's bot detection) to this session's network. That doesn't
  settle [§10.2](#10-open-questions), which is decided on the production VPS, so anota.ai stays
  blocked.
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
| `routes.ts`          | `/admin/v1/imports/*`                                                                   |
| `routes-control.ts`  | the staff versions, `/control/v1/stores/:slug/imports` and `/control/v1/imports/:id…`   |
| `jobs.ts`            | `startMenuImportJobs()`, shaped like `startFleetJobs()` (`modules/fleet/jobs.ts`)       |
| `probe-cli.ts`       | `bun run import:probe`, the staff check against the live platform ([§8](#8-testing))    |

### 4.2 Adapter contract

```ts
interface Adapter {
  platform: Platform; // 'instadelivery' | 'cardapioweb' | …
  /** pure: is this pasted URL one of my stores? */
  match(url: URL): { ref: string } | null;
  /** every host http.ts may call for this adapter */
  hosts: { api: string[]; images: string[] };
  /** a larger read budget than the default, for a platform read one request per product */
  limits?: { importMs?: number; requests?: number };
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
  promoSchedule?: { priceCents: number; windows: Window[] }; // a lower price in some days/hours
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

**Custom domains (phase 3, step 4).** A public hostname that no adapter, blocked platform or
platform domain matches (a dot, `[a-z0-9-]` labels, an alphabetic TLD; no IP literal, port or
local suffix like `.local`, `.internal`, `.test`) is accepted as a pending read: `platform` null,
`source_ref` the host (migration 0070; the lease count treats null as its own platform). The job
places it (`custom-domain.ts`), stopping at the first claim, then reads as usual:

1. Goomer: a DNS CNAME to `<slug>.goomer.app` — DNS only, nothing sent to the merchant.
2. OlaClick's host lookup (`api.olaclick.app/ms-companies/public/hosts/<host>`).
3. Saipos's `domain_name` filter (`delivery-api.saipos.com/v1/stores`).
4. The one GET to `https://<host>/`: DNS resolved once, any private answer refused, a socket to
   the checked IP with SNI and certificate for the host, no redirect followed, ≤ 256 KB, 8 s.
   Cardápio Web's page sets `companySlug`; Delivery Direto's loads
   `deliverydireto.com.br/bs/<brand>/dist/` or redirects to `/<brand>`.

Nothing claims it → `NOT_FOUND`, and the admin asks for the store's link on its platform. The
read lease adds placement's worst case (38 s). A lookup that refuses us only rules its platform
out (`BLOCKED` when nothing else claims the host); a host placed onto a platform already
reading twice waits for a slot, its attempt not charged. Any port in a pasted link makes it
`invalid`. Rollout: an instance without 0070's code fails a custom-domain row as
`UNREADABLE`, so deploy it with no overlap, as 0065.

`menu_imports` (migration 0069): `id`, `tenant_id` (RLS like every table), `created_by`,
`platform`, `source_url`, `source_ref`, `status`, `error_code`, `doc jsonb` (≤ 2 MB), `counts
jsonb`, `mode`, `sections jsonb`, `result jsonb`, `images_total`, `images_done`, the job's
`attempts`/`lease_until`, `created_at`, `read_at`, `applied_at`, `finished_at`; index on
`(tenant_id, created_at desc)`. `menu_import_images` is the photo queue (kind `product`,
`option`, `logo` or `cover`, the target row, the source URL, `status`, `media_id`). Both tables
also carry a `control_access` policy: the job claims work across stores under `vendua.control`
(as the fleet loop does) and does each piece under the row's tenant.

As built:

- The pasted link may omit `https://` (most merchants copy `instadelivery.com.br/loja`); an
  `http://` link is upgraded. Outbound requests are always https to the adapter's own hosts.
- Refusals: 422 `BAD_REQUEST` (not a link), `IMPORT_BLOCKED` and `IMPORT_UNSUPPORTED` with
  `details.platform` (a known platform without an adapter yet is named, so the admin can say
  "ainda não lemos cardápios do Goomer"); 409 `IMPORT_IN_PROGRESS` with `details.id` (the admin
  resumes it); 429 `IMPORT_RATE_LIMITED`; 409 `IMPORT_NOT_READY` on an apply that isn't `ready`;
  403 when a manager ticks _Pagamentos_.
- Also `GET /admin/v1/imports` (the last five, for resuming) and
  `POST /admin/v1/imports/:id/discard` (cancel a read, drop a preview).
- A manager sees the Pix key masked in the preview; the owner sees it.
- The cover fills the default home hero (`store:menu-hero`'s `cover`). A storefront with its own
  hero keeps its photo and the cover isn't queued. A re-hosted cover under 1000 px wide adds a
  `cover_small` note suggesting a bigger photo (§7: Instadelivery's is 475×230).
- Re-hosted photos keep their source order (`product_media.sort`); the import's own audit entry
  is `menu.import`, and every write emits the admin stream topics it touches (`catalog`,
  `store`, `appearance`, `import`).

### 4.5 Outbound requests

- `http.ts` only calls hosts the adapter declares, on URLs the adapter builds from the `ref` that
  `match` extracted. An image host many tenants share is declared with its path prefix
  (`storage.googleapis.com/prod-cardapio-web/`). Redirects are handled manually and re-checked
  against the allowlist. A user-supplied host reaches a request in one place only: placing a
  custom domain ([§4.4](#44-flow-and-endpoints)) asks the platforms' own host lookups first,
  and only then sends one GET to the merchant's host — resolved once, refused if any address is
  private, loopback, link-local, CGNAT, ULA, multicast or a mapped private one
  (`platform/net-guard.ts`, shared with discovery), connected to the checked address, no
  redirects, ≤ 256 KB.
- Caps: 10 s per request, 60 s per import, 5 MB per JSON response, 8 MB per image, 300 requests
  per import, at least 250 ms between requests to one host, at most two concurrent imports per
  platform. An adapter can carry a larger budget (`limits`): Goomer, which asks for each
  product's options, has 150 s and 600 requests. The read lease is derived from the largest
  budget plus 30 s, so a second worker never reclaims a row mid-read. Reads run side by side (up
  to eight per process), so a long one never holds another store's back; within a read, the first
  failure (a block, the deadline) stops every request still to be made.
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
| Options               | 100 per group                   | product imported hidden + `lost`                          |
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

| On the other platforms                                       | Venduá today                                                        | The import                                                                                                         |
| ------------------------------------------------------------ | ------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| Category and its order                                       | `categories` (name, sort)                                           | ✓                                                                                                                  |
| Category description                                         | `categories.description`                                            | ✓ — a category image is `lost`                                                                                     |
| Category / product hours by weekday                          | `products.availability_schedule` (≤ 7 windows)                      | ✓ — category hours are pushed down to its products                                                                 |
| Name, description, price, photo, badges                      | `products`, `product_media`, `tags`                                 | ✓ — badges become tags                                                                                             |
| "A partir de" price                                          | base price + a required option group                                | ✓ when the options carry the price                                                                                 |
| Sizes / variants (Goomer, OlaClick, Saipos)                  | required group "Tamanho" (min 1, max 1)                             | ✓ exact: base = cheapest size, delta = size − cheapest                                                             |
| Promo price with strike-through                              | `products.compare_at_price_cents`                                   | ✓ — sells at the promo price, old price struck through; a promo on some days and hours → `products.promo_schedule` |
| Option groups: min, max, required, price                     | `modifier_groups`, `modifiers`                                      | ✓                                                                                                                  |
| The same option more than once ("2x coco")                   | `modifiers.max_qty`, `cart_items.modifier_qty`                      | ✓ — priced × quantity in Core                                                                                      |
| Option description or image                                  | `modifiers.description`, `modifiers.image_url`                      | ✓ — image re-hosted                                                                                                |
| Pizza: most expensive or average flavour                     | `modifier_groups.pricing_rule` (`sum`, `average`, `most_expensive`) | ✓ — computed by the cart                                                                                           |
| Combos / kits                                                | `combo_slots`, `combo_slot_items` (≤ 8 slots)                       | ✓ when slots reference products; otherwise hidden + `lost`                                                         |
| Stock count, sold out                                        | `stock_quantity`, `sold_out`                                        | ✓                                                                                                                  |
| Hidden or paused items                                       | —                                                                   | absent from Instadelivery's payload, flagged elsewhere: skipped; empty categories noted                            |
| Dine-in-only items and prices (Takeat, Saipos)               | —                                                                   | skipped; the delivery price wins                                                                                   |
| Hours with several shifts a day                              | `hours` windows (≤ 28)                                              | ✓                                                                                                                  |
| Delivery fee by neighbourhood                                | neighbourhood zones                                                 | ✓ — one zone per distinct fee                                                                                      |
| Delivery fee by km tier or per km                            | radius zones (smallest containing radius wins), `fee_per_km`        | ✓ — Venduá measures straight-line distance, platforms may use route distance: noted                                |
| Delivery polygons (Delivery Direto, OlaClick, Saipos)        | `delivery_zones` kind `polygon`                                     | ✓ — neighbourhood, then polygon, then radius                                                                       |
| Fee only computed per address (Cardápio Web, Takeat, Saipos) | —                                                                   | `lost`; the merchant sets zones                                                                                    |
| Minimum order, prep time, pickup, ETA                        | `store_settings` operations, zone ETA                               | ✓                                                                                                                  |
| Payment methods                                              | `pix`, `cash`, `card_on_delivery`, `card_online`, `meal_voucher`    | ✓ by name; per-method discount or surcharge in `store_settings.payment_adjustments`                                |
| Pix key and beneficiary                                      | `payments.pix`                                                      | ✓ (beneficiary ≤ 25)                                                                                               |
| Logo, cover, colours                                         | `logo_url`, home hero `cover`, `storefront_tokens`                  | ✓ — re-hosted; one brand colour drives the token set                                                               |
| Loyalty (points, cashback, stamps)                           | stamp card                                                          | `lost` — the merchant sets up the stamp card; balances aren't public                                               |
| Coupons, referral, WhatsApp automations, upsell, time slots  | —                                                                   | `lost` (store-level notes)                                                                                         |

## 6. Model gaps — closed first

Status: built and merged with Kernel 1.12.0. Still to do: the store sections that draw their own
prices (`storefronts/_template/sections/_shared/Dish.tsx`, the quero-pudim `ProductCard`) show the
struck-through price only once they render `compareAtPriceCents`.

Decision (2026-10-01): the seven gaps below are closed **before** the importer, so no adapter ever
emits their `lost` codes. Each is additive and optional on every public surface (Contract 2): a Core
migration, the Core API, the admin editor, and one Kernel minor (1.12.0: `API.md`,
`CHANGELOG.md`; no new runtime export, so `test/api-surface.test.ts` is unchanged). Money stays
integer cents, computed in Core. Ranked by how many platforms need them:

| #   | Gap                                                                                                                            | Model                                                                                                                                                                                                                                                                                                                                                                                                            | Migration |
| --- | ------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------- |
| 1   | **Promo price** — Instadelivery, Cardápio Web, OlaClick, Takeat, Saipos, anota.ai                                              | `products.compare_at_price_cents`, display only: the base price remains what the shopper pays; must exceed it                                                                                                                                                                                                                                                                                                    | 0065      |
| 2   | **Option quantity** — Instadelivery, Cardápio Web, OlaClick, Takeat, Delivery Direto                                           | `modifiers.max_qty` (1–20, default 1) and `cart_items.modifier_qty`; add-to-cart accepts `modifiers: [{id, qty}]`; group min/max count quantities; snapshots and reorder carry `qty`                                                                                                                                                                                                                             | 0065      |
| 3   | **Flavour pricing rule** — Instadelivery, Cardápio Web, Delivery Direto, Saipos, Takeat, anota.ai. Makes pizzerias importable. | `modifier_groups.pricing_rule`: `sum` (today), `most_expensive`, or `average` (round half up over selected units); `unitPriceCents` is group-aware                                                                                                                                                                                                                                                               | 0065      |
| 4   | **Category description** — Quero Pudim, Cardápio Web, OlaClick                                                                 | `categories.description` (≤ 500)                                                                                                                                                                                                                                                                                                                                                                                 | 0065      |
| 5   | **Option description and image** — Takeat, Cardápio Web, OlaClick                                                              | `modifiers.description` (≤ 200), `modifiers.image_url` (`https://` or `/v1/media/`)                                                                                                                                                                                                                                                                                                                              | 0065      |
| 6   | **Delivery polygons** — Delivery Direto, OlaClick, Saipos                                                                      | zone kind `polygon`, `delivery_zones.polygon` (3–200 vertices); `resolveZone` order: neighbourhood, polygon (smallest area wins), radius; needs coordinates                                                                                                                                                                                                                                                      | 0066      |
| 7   | **Per-payment discount or surcharge, meal vouchers** — Instadelivery, Cardápio Web, Delivery Direto                            | method `meal_voucher`; `store_settings.payment_adjustments` = `{ method: { percentBps?, fixedCents? } }`, signed, applied to subtotal minus coupon (never the delivery fee); `orders.payment_adjustment_cents`; the quote takes an optional `paymentMethod`                                                                                                                                                      | 0067      |
| 8   | **Timed promotion** — Saipos, Cardápio Web                                                                                     | `products.promo_schedule` = `{ priceCents, windows }` (the availability windows' shape, store time); Core's catalog serves the promo as the price inside a window, the regular one as the "de"; cart, checkout's reprice and the order read it from there (the price at checkout, as the platforms do, also for an order scheduled later); the catalog's `nextChangeAt` tells an open page when to read it again | 0071      |

Rollout: migration 0065 rebuilds the `cart_items` unique index to include `modifier_qty`, so an old
instance's add-to-cart (`on conflict` on the old columns) fails until it drains. Deploy 0065 with no
overlap between old and new instances. An option with a negative price can be picked only once, and
a line priced below zero is refused (422 `INVALID_MODIFIER`). Payment adjustments round halves away
from zero and apply to the subtotal after the coupon, while the store offers that method.

Once a gap lands, its adapter `lost` code (`promo_price`, `option_quantity`, `pizza_pricing`,
`category_description`, `option_details`, `delivery_polygon`, `payment_adjustment`) is retired.
Still `lost`: category image, per-option stock, fee computed only per address,
loyalty and the rest of §5.

## 7. Quero Pudim — the acceptance case

Read on 2026-10-01 from `instadelivery.com.br/queropudimgourmet` (one public request, 36 KB):

- **Comes over:** 4 categories and 23 products — prices, descriptions, one photo each, stock
  counts, "Novidade" and "Mais vendido" badges, two sold out; no option groups. Hours for all
  seven days, including Friday's two shifts. Pickup (customers book their own Uber delivery,
  which the welcome message explains). Minimum order R$ 20, prep time 15 min. Pix,
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
  - Delivery: the store has `fee_type` −3, "taxa de entrega a combinar", a fee told after the
    order. Venduá charges a zone's fee, so delivery comes in off with a note to set up zones if
    the merchant delivers (added in phase 3 step 2, when `fee_type` was read).
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
- **No live calls in CI.** A staff script, `bun run import:probe <url> [--keys|--codes]` in
  `packages/core`, runs `read` + `map` + `validateDoc` against the live platform and prints
  counts and `lost` — before a release, and when a merchant reports a failed import. `--keys`
  lists the payload's field names (never values), to fix an adapter after the platform drifts.
  Later, a weekly canary per platform from the fleet jobs can alert staff when an adapter starts
  failing.

As built: `test/menu-import.test.ts` (money, every §4.6 limit, link recognition, the Instadelivery
mapping on `fixtures/menu-import/instadelivery.json` — synthetic content in the platform's shape,
including a credential-like field that must not survive — and the outbound HTTP rules) and
`test/menu-import-db.test.ts` (refusals, read → ready, preview and Pix masking, another store's id,
the owner-only section, apply with every section, a double apply, photos re-hosted and a failed
one reported, replace mode, `NOT_FOUND`, expiry and the hourly limit). The probe against the live
Quero Pudim store returns exactly the §7 lost list, and the store was imported end to end through
the onboarding UI into a blank local tenant: 23 products, 25 images re-hosted.

## 9. Phases

1. **Model gaps** from [§6](#6-model-gaps--closed-first), first: Core migrations 0065–0067, the
   admin editors, and Kernel 1.12.0 with the storefront rendering (struck-through price, option
   quantity stepper and thumbnails, category description, payment adjustment line). Exit: each
   gap exercised end to end in Core tests and on a local store.
2. **Instadelivery end to end.** Core: document, `validateDoc`, `apply`, the image job, routes,
   the Instadelivery adapter; the seed writes through `apply`. Admin: the onboarding step and the
   Catálogo entry. Exit: Quero Pudim imported in production.
   - Built: everything but the seed, which still writes its own rows (its fixtures carry fields
     the document doesn't: slugs CI depends on, figure variants, coupons, loyalty).
   - Confirmed on live stores (2026-10-01, field names via `import:probe --keys`, outcomes via
     `--codes`, which prints counts and a tally of note codes and nothing of the store): option
     lists are `complementos[]` with `min`, `max` (0 = no cap), `is_pizza` (most expensive
     flavour), `only_one` (no repeats) and options in `complements[]` (`price`, `max_quantity`,
     `is_invisible`, stock); neighbourhood fees are `fees[]` (`name`, `price`, `estimate`); km
     tiers are `feesKm[]` (`km`, `price`, `estimate`, `no_delivery`). A pizzeria with 78 option
     lists imports with one product hidden (a required list with nothing visible), and km tiers
     past the last delivering one are read as the edge of the area, not a gap.
   - Left as notes in phase 2 because their meaning wasn't confirmed, settled in phase 3 step 2
     (2026-10-01) from the storefront's own checkout code and two pizzas priced in a browser:
     - **Pizza lists** charge every flavour picked at the dearest one's price (½ R$ 20 + ½
       R$ 25,50 = R$ 51,00), not the dearest once as phase 2 mapped it, which imported such pizzas
       at half price. A list with a fixed number of flavours (all seen: 2 of 2) is
       `most_expensive` with each price × that number; one where the number varies is hidden as
       `pizza_pricing`.
     - `fee_type` picks the fee model: −1 neighbourhoods, −2 km tiers, −3 "a combinar" (told
       after the order), any other value a flat fee in reais. Phase 2 read both lists whatever
       the type, and stores keep the unused one: only the live list is read now; −3 and a flat
       fee have no area to place, so delivery comes in off with a note
       (`delivery_fee_later`, `delivery_flat_fee`).
     - Free delivery: subtotal ≥ a neighbourhood's `free_delivery`, > a tier's `price_free` (one
       cent past it in whole cents), or ≥ the store's own `free_delivery` → `freeDeliveryOverCents`
       on each zone, the lowest that applies.
     - Payment percents (`pix_discount`, `cash_discount`, `debit_card_discount`, `debt_increment`,
       `credit_increment`, `ticket_increment`, store-wide `discount`) are percents of the subtotal
       keyed on the platform's payment ids → `payments.adjustments`, when every source method
       mapped to one Venduá method carries the same percent and none carries both a discount and
       an increment (each is rounded on its own there). A pickup discount (`takeaway_discount`)
       wins over the payment's own on pickup orders, so with pickup on, those stay notes.
     - `item_discount` applies only through the item's own share link: the product comes over at
       its menu price with a `link_discount` note. `price2` and a pizza category's
       `size1`/`size2` are never read by the storefront: the product comes over at `price1`.
       Item `type` 2 is sold by weight (price per kg): hidden as `sold_by_weight`.
     - A "no delivery" km band inside the area stays a note: radius zones are discs.
   - The CRM import on a lead's store, planned for phase 3, was built here.
3. **More adapters**, planned step by step in [menu-import-phase3.md](menu-import-phase3.md):
   1. Re-verify every platform's request chain (the gate). Done 2026-10-01: every readable chain
      answers ([§3](#3-platforms)); the drift is in [Appendix A](#appendix-a--platform-notes).
   2. Settle the Instadelivery fields above. Done 2026-10-01.
   3. One adapter per PR, with its fixtures: Cardápio Web, OlaClick, Takeat, Delivery Direto,
      Saipos, Goomer. Done 2026-10-01: all six built (helpers two adapters share live in
      `adapters/shared.ts`; Goomer reads with a budget of its own). A note never quotes a CNPJ, phone or
      e-mail a merchant typed into a label: `validateDoc` blanks them. An average maps only where it can't fall on a
      half cent: each platform rounds a float its own way. A minimum that applies to delivery only there goes on the delivery
      zones: a store minimum here binds pickup too. Items priced only by a required list where the customer picks a
      quantity (a can of soda "×N") keep a base of R$ 0,00, exactly as there; Core serves the
      cheapest configuration as `fromPriceCents` and the storefront shows "a partir de" it, as
      the old store did. A list of exactly N units lifts N floors into the base instead.
      Afterwards: an option list holds up to 100 options (a pizzeria's flavours), and timed
      promotions are Venduá's own (`products.promo_schedule`, gap 8 in §5).
   4. Custom domains. Done 2026-10-01 ([§4.4](#44-flow-and-endpoints)), the fingerprinting GET
      included for Cardápio Web and Delivery Direto.
4. **iFood** through the official Merchant API: Venduá registered as an iFood app, the merchant
   authorizes it in the Portal do Parceiro ("Conectar iFood"), the catalog comes from
   `catalog/v2.0`. Its own design doc.

## 10. Open questions

1. **Terms of use.** The merchant consents to copying their own store; the platforms don't, and
   these are their internal APIs. Proposal: require the merchant's confirmation that the store is
   theirs, read nothing beyond the pasted store, and stop a platform if it asks. Built: "Essa
   loja é minha" must be on before "Importar", and only the pasted store is read.
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

What a public store returned on 2026-10-01. Internal APIs; expect drift. Phase 3 adds a "Checked
<date>" line under each platform as it re-verifies the chain, and replaces the entry with the
fields as built once its adapter lands. The checks are plain GETs with the importer's User-Agent,
`Accept: application/json`, no cookies, at least 1 s apart per host; request counts are for the
largest store read.

- **Instadelivery** — `GET app.instadelivery.com.br/api/stores/by-slug/<slug>`. As built
  (phase 2, step 2 of phase 3): `groups[]` (order, weekday flags, hours) → `itens[]` (`price1`
  in reais, `strike_price`, `image` + `image_2…5` on a DigitalOcean Spaces CDN,
  `stock_control`/`stock`, `is_best_seller`, `is_newest`, `custom_tag*`, weekday flags, `type`
  2 = by weight, `item_discount` = a link-only percent) → `complementos[]` (`min`, `max`,
  `is_pizza`: every flavour at the dearest one's price, `only_one`, options in `complements[]`
  with `price`, `max_quantity`, `is_invisible`, stock). Store: `times` (per shift),
  `payment_methods[]` (ids fixed by the platform: 2 cash, 1307/46 Pix, 7 debit, 8/42/49 credit,
  45 voucher), the payment percents, `fee_type` with `fees` (neighbourhood) or `feesKm`,
  `free_delivery`, `minimum_order`, `wait_time`, `take_out`, `pix`/`pix_type`/`pix_infos`,
  `design` (logo, background, colours). Hidden items are absent; `price2`, `from_price` and a
  category's `size1`/`size2` aren't read by the storefront.
  - _Checked 2026-10-01_ (the user's store and two pizzerias through `import:probe --codes`, raw
    payloads of ten more for step 2): works as documented. 1 request, 36–450 KB. Images on
    `instadelivery-public.nyc3.cdn.digitaloceanspaces.com` (`image/jpeg`). New, from the
    storefront's own checkout code: `fee_type` picks the fee model (−1 `fees[]` neighbourhoods,
    −2 `feesKm[]` tiers, −3 free, any other value a flat fee in reais) and stores keep the unused
    list, so the adapter has to follow it; the payment adjustment fields are percents of the
    subtotal. Both are settled in step 2.
- **Cardápio Web** — as built (phase 3): `GET integracao.cardapioweb.com/api/menu/company/profile?company=<slug>`,
  then `…/company/categories?only_available_for=delivery` with headers `company-id` (the
  profile's `id`) and `company` (its `url_name`); an unknown slug is a 404. Links:
  `app.cardapioweb.com/<slug>` and the mode hosts (`menu.`, `mesa.`, `balcao.`, `entrega.`,
  `local.`, `delivery.`). Reais as numbers. Categories and items with `status` `ACTIVE` (an
  item `MISSING` is sold out); `available_for` without `delivery` or order types without
  delivery and takeout → `dine_in_only`; `allowed_times` of the category and the item intersect
  into the product's availability. Promo: `promotional_price` when `promotional_price_active`:
  every day all day (`promotional_price_schedules`, else `promotional_price_availability`) it is
  the price, the regular one struck through; on some days and hours it rides along as the
  product's `promoSchedule`; never, nothing. Add-ons:
  `SINGLE` (max 1), `MULTIPLE` (each once), `SUMMABLE` (a quantity per option, `max_quantity` or
  the group's maximum); `price_calculation_type` `SUM` → sum, `MEAN` → average where it can't
  fall on a half cent (at most two units, every price of one parity: the storefront rounds a
  float with lodash `_.round`, which can tip a half either way), else hidden `pizza_pricing`;
  `MAX` → most expensive, `MIN` → hidden `pizza_pricing`.
  Combos: each `combo_steps[]` a one-pick kit slot, the base the sum of step prices, each pick
  its `additional_price`; a pick with a required add-on there doesn't resolve (`kit_unresolved`).
  Badges `best_seller`/`new_item`/`recommended`/`limited_edition`/`offer`, `highlighted`,
  stock, `available_order_timings` scheduled-only → preorder. Store: `name`, the first line of
  `description`, `order_whatsapp`, `instagram`, address (unless `hide_company_address`),
  coordinates, `logo`, `image` (cover), `color`, `business_hours` (several ranges a day;
  `temporary_state` and `custom_dates` ignored), `preparation_time`,
  pickup from `flags`. Payments by `kind` (money, pix, credit/debit card, meal/food voucher);
  the Pix key from the JSON in `observation`; online kinds are `online_payment`; a method fee
  (`percentual_fee`/`fixed_fee`, units unverified on in-person methods) is a note. Fees exist
  only per address: delivery comes in off with `delivery_by_address` (the neighbourhood names)
  `free_delivery_rule` and `delivery_minimum` (`minimum_order_value`, applied to delivery
  only there). Images: `storage.googleapis.com/prod-cardapio-web/` (the platform's
  bucket only: the host is every Google Cloud bucket's), `cdn.cardapioweb.com.br`.
  - _Checked 2026-10-01_ (a pizzeria and a sweet shop): works with drift. 2 requests whatever the
    size (profile ~10 KB; categories 239 KB for 26 items, 44 add-on lists, 385 options), reais as
    numbers. Drift: `price_calculation_type` is `SUM`, `MEAN` or `MAX` (`MEAN` is the usual
    half-and-half rule; the storefront also knows `MIN`); the promo is `promotional_price` with
    `promotional_price_active` and `promotional_price_schedules` (`[{day, start?, end?}]`, which
    wins over `promotional_price_availability`); `delivery_only_for_neighborhoods[]` names
    neighbourhoods without fees, and fees come only from a per-address POST the importer never
    makes; the Pix key is a JSON string in `payment_methods[].observation`; `percentual_fee` is a
    percent; a past `temporary_state_end_at` must be ignored. No combo seen live (its shape is
    from the storefront code). Images: `storage.googleapis.com` (items, options, logo, cover) and
    `cdn.cardapioweb.com.br` (banners). Custom domain: no public lookup by host; the server writes
    the slug into the page it serves for the host.
- **OlaClick** — as built (phase 3): the link is any `<store>.ola.click` page; the ref is the
  host. `GET api.olaclick.app/ms-companies/public/hosts/<host>` → `company_id` (404 when
  unknown), then `ms-products/public/companies/<id>/categories`, `ms-companies/public/companies/<id>`,
  its `/ecommerce-settings` and `ms-orders/public/companies/<id>/payment-methods` (5 requests).
  Reais as numbers. Categories and products by `visible`; the `FAVORITE` category ("Destaques")
  repeats others' products and becomes a "Destaque" badge. Variants as the storefront offers them
  (one, or those with a name or a list price): one is the price (`price` when a number, else
  `original_price`, as the storefront does; a non-numeric `price` hides it; struck-through
  `original_price` when above it); several are a "Tamanho" group, with the cheapest size's list
  price struck through when every size is discounted; per-variant stock → a sold-out size.
  `packaging_price` (an order charge per item) hides the product (`packaging_fee`). Modifiers:
  `one`/`many`, the minimum only when `required`, `max_modifiers` the units, `max_limit` the
  quantity per option, prices summed (the storefront's cart). Delivery: only
  `delivery.prices.type` — `FIXED` (one fee for any address: `delivery_flat_fee`; the
  distance limit belongs to the per-km mode), `BY_DISTRICT` (neighbourhoods), `BY_AREA` (polygons; `enable_out_of_area` is `delivery_out_of_area`),
  `BY_RANGE` (discs from `max` in metres; a band starting past the previous end is a
  `delivery_gap`) and `BY_DRIVE_DISTANCE` (a disc with `starting_price` + `price_per_km`, with the
  straight-line note); `minimum_amount_for_free` → each zone's free threshold, `average_time` →
  ETA, `minimum_amount_to_allow` → each zone's minimum (delivery only
  there; a store minimum here binds pickup too), `takeaway.active` → pickup. Store: `name`,
  `whatsapp`, `address`, coordinates, `logo_url`, the layout's banner and button colour,
  `business_hours_settings`. Payments by `code` (cash, pix, credit/debit card, vouchers); online
  ones are `online_payment`; the Pix key isn't public (`pix_unreadable`). Images:
  `assets.olaclick.app`.
  - _Checked 2026-10-01_ (a pizzeria and a snack bar): works as documented. 5 requests (host
    lookup; categories 353 KB for 97 products; company; `ecommerce-settings`, served as
    `text/html` with a JSON body; payment methods by order type). An unknown host is a 404. New:
    the host answer carries `custom_url`; only `delivery.prices.type` is live (stores keep other
    modes configured under `FIXED`); a single-choice group with `min_modifiers: 1` is required only
    when `required` is true; pizza flavours cost 0 and the product carries the price. Variant
    `cost` is the merchant's cost and company `token` is credential-like: never copied. Images:
    `assets.olaclick.app`. Custom domain: the same host lookup.
- **Delivery Direto** — as built (phase 3): the link is `deliverydireto.com.br/<brand>/<unit>`
  (pages under it too) or `/<brand>`, which opens its only unit; a brand with several units
  answers `NOT_FOUND` so the merchant pastes the unit's link. `GET <brand>/basic_info` → the units
  (the unit is checked against it: a wrong slug there redirects to a page dump), then
  `<base>/categories`, `<base>/categories/<id>?include=items,properties` four at a time, the pizza
  module when a category is `pizza_module` (`get_pizza_sizes`, then flavours and extras per
  size), `<base>/delivery/fees` and `<base>/payment-forms`. Items: `HIDDEN` skipped,
  `SHORT_SUPPLY` sold out, `UNAVAILABLE` (only outside its hours now) active; `filters` without
  delivery or takeout → `dine_in_only`; `items_availability` ∩ `categoryavailabilities` → the
  schedule; badges and `is_new` → tags. Properties: RADIO / CHECKBOX / MULTIPLE (`max_choices`
  the quantity), `combo_min_choices`/`combo_max_choices`; SUM, HIGHER → most expensive, AVERAGE →
  average only where it can't fall on a half cent (the storefront rounds a float's printed
  digits), SMALLER → hidden `pizza_pricing`. The pizza module: one product per size, its
  flavours priced for that size under the size's `pizzasetting`. Store from the unit: name,
  `description`'s first line, phone, Instagram, address (unless `hide_address`), coordinates,
  logo (not the placeholder), cover, `settings.primary_color`, hours from `business_hours`
  (the digits of a placeholder ISO time), `switch_delivery`, `takeout_status`; minimums: pickup's
  as the store's, delivery's on the zones when higher. Zones: `POLYGON` (`"lng,lat|…"`, closed,
  padded) as polygons; `CIRCLE` (any centre, radius in metres) as a 48-sided polygon drawn 1 %
  - 10 m outside it (checked against Core's haversine); areas that share ground, of any shape, are
    a `delivery_overlap` note; a `price_percent` fee is unreadable and an area's own free-delivery
    minimum (never seen set) a note; free above `settings.free_delivery_minimum_order` (≥ there
    too); no area at all is `delivery_flat_fee` (free); a category that won't read is
    `category_unreadable`. Payments: `money`, Pix by name or `pix`, VOUCHER or voucher brands, CREDIT/DEBIT or a
    card brand, else the label; a `discount_percentage` (cash, on an amount the code doesn't make
    clear) is a note; the Pix key isn't read out of a form's name. Images:
    `duisktnou8b89.cloudfront.net`, `img.deliverydireto.com.br`.
  * _Checked 2026-10-01_ (a five-unit pizzeria, an ice-cream shop and a pizzeria, plus seven to
    settle fields): works with drift. `<base>` is the store link itself,
    `deliverydireto.com.br/<brand>/<store>`, with no header. Hours, minimum order, prep times, the
    pickup and delivery switches and the address come from a brand-level `<brand>/basic_info`
    (one entry per unit). Largest store: 4 + 22 category requests, plus 1 + 2 per size when the
    store uses the pizza module (`<base>/pizza_module/get_pizza_sizes`, then flavours and extras
    per size, flavour prices per size) = 33 requests; about 35 s one after another, so category
    reads should overlap within the per-host pacing. Drift: `price_calculation_type` is `SUM`,
    `AVERAGE` or `HIGHER` (the storefront also knows `SMALLER`); groups are `RADIO`, `CHECKBOX` or
    `MULTIPLE` with `combo_min_choices`/`combo_max_choices`, and an option's `max_choices` is its
    quantity only in `MULTIPLE`; item `status` is `ACTIVE`, `SHORT_SUPPLY` (paused), `HIDDEN` or
    `UNAVAILABLE` (outside its hours right now, not paused); weekday 1 is Sunday and equal start
    and end mean all day; polygons are a `"lng,lat|…"` string, closed and padded with repeats;
    circles have a radius in metres; the only adjustment is a per-form `discount_percentage`
    (cash); the Pix key, when there is one, is inside a payment form's name. A brand link with one
    unit redirects to it; with several, the merchant has to pick. A wrong store slug in a one-unit
    brand redirects to the store page, so redirects that change the path must be refused. Images:
    `duisktnou8b89.cloudfront.net` (items, options, logo, cover). Custom domain: no lookup API; the
    domain's `/` redirects to `/<brand>`, and the same paths answer identically on
    `deliverydireto.com.br`.
- **Takeat** — as built (phase 3): `pedido.takeat.app/<slug>`. `GET
backend-delivery.takeat.app/public/restaurant/<slug>` → `id`, `brand.id` (404 when unknown),
  then `…/public/restaurants/menu/<id>?gd=true&brand_id=<brand>`,
  `…/public/restaurants/delivery-schedules/<id>` and, when `delivery_info.allow_delivery_addresses`,
  `…/public/restaurants/delivery-addresses/<id>` (3–4 requests). Prices are decimal strings. Only
  what sells for delivery: `is_exclusive` categories are skipped silently, a category with
  `available_in_delivery: false` takes its items with it (a `dine_in_only` note with the count),
  and so does a product, group or option. The price is the storefront's first set of
  `delivery_price_promotion`, `delivery_price`, `price_promotion`, `price`, struck through over
  the regular one when it's a promo; a delivery price of 0 under a priced item hides it
  (`price_unreadable`); `use_weight` hides it; `sold_off` is sold out; `delivery_tag_id` → the
  tag's name. Complements: `question` (else `name`) as the title; `optional` → no minimum (an
  optional list with a minimum above 1 is noted, `option_minimum`); `limit` the units and an
  option's `limit` its quantity; prices only when `additional`: `more_expensive_only` → the dearest
  once, otherwise a sum; `use_average` (never seen true; the storefront adds the average once
  per line) hides the product (`pizza_pricing`). Times are UTC instants of a Brasília clock:
  hours per shift (`delivery_active`/`withdrawal_active`), and `enable_times` windows with
  `active_days` (Sunday first) intersect from category to product. Store: `fantasy_name`,
  `greeting_message` (announcement), `phone`, `instagram`, `adress`, `avatar`/`brand.file`,
  `delivery_info` (cover, colour, `time_to_delivery`/`time_to_withdrawal`, pickup and delivery
  switches); minimums: pickup's as the store's, delivery's on the zones when higher (a lower one
  is a note). Fees: the neighbourhood table → zones; by distance or area → `delivery_by_address`.
  Payments: `restaurant_method[0].available` and `delivery_accepts`; `method` CASH, PIX, CREDIT,
  DEBIT, VOUCHER, else the merchant's label; `pix_auto` is `online_payment`, `clube` is
  `cashback`; no Pix key is public. Images: `takeat-imgs.takeat.app`.
  - _Checked 2026-10-01_ (seven stores, to settle the dine-in and price fields): works with drift.
    3 requests plus 1 for neighbourhood fees; the menu is one array of 0.13–1.34 MB. Drift: hours
    are at `…/public/restaurants/delivery-schedules/<id>` (the path above answers 400); the
    browser asks for the menu with `?gd=true&brand_id=<brand>`, and without `gd` items that are off
    every channel come too; there is no dine-in-only key: a category, product, group or option
    not sold for delivery has `available_in_delivery: false`, and `is_exclusive` categories (staff
    meals, till helpers) are never shown; `delivery_price` is null when it equals `price`; promo
    fields are prices; schedule and window times are UTC instants of a Brasília clock on dummy
    dates, `active_days` a seven-letter `t`/`f` string from Sunday. Fees: a neighbourhood table at
    `…/public/restaurants/delivery-addresses/<id>`; distance and area fees aren't public.
    Credential-like keys: `meta_access_token`, `pixel_id`, `token_clube`, `brand.nfce_token`;
    options carry the merchant's cost (`current_cmv`). Images: `takeat-imgs.takeat.app`. Custom
    domain: none; the API looks stores up by slug only.
- **Saipos** — as built (phase 3): the link is `<store>.saipos.com` (the platform's own
  subdomains aside); the ref is the host. `GET
delivery-api.saipos.com/v1/stores?filter={"domain_name":"<host>"}` (`[]` → `NOT_FOUND`), then
  `…/stores/<id>/sales/view-data`: 2 requests. What shows follows the storefront bundle (read
  2026-10-01). Categories: each item's `category_item` plus any `categories[].store_category_item`,
  enabled ones only, in `order`; the store's `categories` (`"id##NAME**…"`), when set, keeps only
  those ids, and a list naming none of them is stale (that storefront shows no items), so every
  enabled category comes with a `site_categories_stale` note; an item in two categories is listed
  in both; `id_store_item_required` (a category whose orders must also carry an item) is a note
  when the category has anything else. Sizes: enabled `variations[]`, an internal `Único` skipped
  when there are others; one → the product; several → a `Tamanho` list, or one product per size
  ("Pizza — G") when any option costs differently per size. A promotion for the site channel
  (`id_partner_sale` 7), the first enabled one and cheaper: with no `availabilities` it is the
  price, struck through over the regular one; with hours, the regular price and the promotion as
  the product's `promoSchedule` (an item whose sizes are a list splits into one product per size
  so each carries its own); an `enabled` that isn't a boolean hides the product
  (`promo_unreadable`). Sale windows: the item's and its category's `availability` rows for the
  site channel (or none), weekday 1 = Sunday, a row ending before it starts covering that day's
  early hours and its evening, intersected; items vanish outside them there (`outside: hidden`).
  Choices: options priced by their `variations[]` entry for the size (none: 0), `max_choices` 1 a
  single pick, else a quantity per option up to the maximum; `calc_method` 1 sum, 2 average (only
  where it can't fall on a half cent), 3 most expensive; references to missing groups and empty
  optional groups skipped. Store: `trade_name`, address (unless `show_store_address` is false),
  district and city, logo and cover, `primary_color`, hours from `schedules_service`,
  `minimum_value` as the store's minimum (it binds every order there), `pickup_counter`; delivery
  is per address (`delivery_by_address`, plus `free_shipping` as `free_delivery_rule`);
  `enable_order_schedule` → `time_slots`. Payments: the store's own label first ("Crédito Amex";
  the platform's is sometimes just a brand), then the platform's; Pix online or
  `enabled_payment_online` → `online_payment`; no Pix key is public. Images: `static.saipos.com` +
  the relative path.
  - _Checked 2026-10-01_ (a pizzeria, a café and a large pizzeria): works as documented. 2
    requests whatever the size (store 5–9 KB; `view-data` 39 KB–1.2 MB). An unknown host answers
    `[]`. Disabled categories (a quarter of one store's items) and choice references to missing
    groups (about half of them in every store) confirmed. `calc_method` 1 and 2 seen. Flavour and
    crust prices per size are `choice_items[].variations[]`, keyed by the item's
    `id_store_variation`. A category is per item (`category_item`). No WhatsApp and no fee table
    (fees per address); a payment type's `rate` is the merchant's card fee, not a surcharge.
    Images: `static.saipos.com` + the relative `img_path`. Custom domain: the same lookup by host.
- **Goomer** — as built (phase 3): the link is `<slug>.goomer.app` or `www.goomer.app/<slug>`.
  `GET api-go.goomer.app/v2/establishments/<slug>/info` (404 → `NOT_FOUND`; `is_abrahao`, the
  newer menu on another API, → `UNREADABLE`), then the menu URL it names, only when it is
  `www.goomer.app/webmenu/<slug>/menu/<version>` (none, or an empty menu: `NOT_FOUND`, as dormant
  stores are), then `mobile.goomer.app/webmenu/<slug>/product/<id>/optiongroups/<version>` for
  every product, five at a time within the pacing; a server error there is asked once more
  after a second, and a product whose lists still won't read hides (`options_unreadable`).
  Budget: 150 s, 600 requests. What shows follows its webmenu bundle (read 2026-10-01).
  Categories: `group_name` in the order they first appear. Prices: one → the price; several →
  a required "Escolha 1 opção" list (the webmenu's own words), base the cheapest. Lists: every
  pick adds its price (the old option groups are all `Individual`); min 1 and max 1 is one
  pick, `repeat` a quantity per option up to the max, else distinct options; max 0 → 99 as
  there; empty optional lists skipped; the "a partir de" floor lifted. `limit_age` →
  `adults_only` (asked at checkout there); `suggestions` → `upsell`; product and category
  `hours` aren't enforced by either webmenu bundle, so they aren't read. Settings are strings
  ("true", JSON): parsed only where mapped. Hours from `info.hours` (the server's pick of fixed
  or custom): a row covers a weekday range; a close before the open is that day's early hours
  and its evening; 00:00–00:00 is all day; none at all is always open. Delivery by
  `mm_delivery_zone_type`: `dynamic` → its active bands as store-centred discs (fee, ETA unless
  `hide_time`; the distance there is a route Goomer's server measures, a
  `delivery_distance_straight_line` note; every band off is `delivery_fees_unreadable`); `static` → `delivery_flat_fee` (with no fee set, the
  old single fee when it's on, else "taxa a combinar", `delivery_fee_later`); `neighborhood` →
  `delivery_by_address` (kept by an id of Goomer's address lookup). The delivery minimum goes on
  the bands; free delivery is strictly above `mm_free_delivery_minimum_value` there, so one cent
  past it here. Store: name, the welcome message as the announcement (not the platform's
  default), WhatsApp, address and coordinates from `settings.address`, logo, `mm_main_color`,
  `mm_takeaway_time`, pickup. Payments: cash, credit/debit → card on delivery, voucher, Pix with
  the key from `mm_payment_pix_info` only when its shape can't be two things and Venduá's
  `normalizePixKey` accepts it (eleven bare digits are a CPF or a mobile; anything else is
  `pix_unreadable`); Mercado Pago, Tuna and VR links → `online_payment`; a
  pickup discount, coupons, scheduling and in-store ordering are notes.
  - _Checked 2026-10-01_ (two pizzerias and an açaí shop): works with drift. The menu URL is
    `www.goomer.app/webmenu/<slug>/menu/<version>` (a flat `products[]` with `group_id`,
    `group_name`); option groups moved to
    `mobile.goomer.app/webmenu/<slug>/product/<id>/optiongroups/<product version>`, and no product
    flag says which have any. Largest store: 2 + 68 = 70 requests, about 1.2 s each, so about 85 s
    one after another: over the 60 s deadline unless reads overlap within the per-host pacing. An
    unknown slug is a 404. Images: products on `www.goomer.app`, logo on `static.goomer.app`, both
    served with a non-image content type (the bytes are JPEG). Credential-like:
    `mm_facebook_business_access_token`, `mm_payment_mpago_store_public_key`. Custom domain: a
    CNAME to `<slug>.goomer.app`, kept as `mm_store_domain`; no lookup by host in the API. Store
    links also come as `www.goomer.app/<slug>`.
