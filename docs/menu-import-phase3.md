# Menu import — phase 3 plan

> Status: steps 1 and 2 done 2026-10-01 (every readable chain answers, three as documented and four with drift; every Instadelivery field settled, including a pizza price phase 2 had at half); step 3 done 2026-10-01 (all six adapters: Cardápio Web, OlaClick, Takeat, Delivery Direto, Saipos, Goomer); step 4 next · Written 2026-10-01 at the end of phase 2 ([PR #269](https://github.com/mariajunqueiramirandas-cpu/vendua/pull/269)) · Design: [menu-import.md](menu-import.md)
> For a session allowed to read public stores on the platforms below. Phase 2 stopped where this
> plan starts because its session could read only the user's own store.

Phase 2 shipped Instadelivery end to end. This plan covers the rest of
[§9](menu-import.md#9-phases): first check the platforms still answer the way
[Appendix A](menu-import.md#appendix-a--platform-notes) says, then finish what Instadelivery
leaves hidden, then one adapter per platform. Steps run in order; step 1 is a gate.

## 0. Before you start

- **Base.** The module arrives with PR #269 (branch `ccr-5892b0ad-mdss6q`). If it's merged, branch
  from `main`. If not, merge `origin/ccr-5892b0ad-mdss6q` into your branch and say so in your PR.
- **Read** [menu-import.md](menu-import.md) §3, §4.2–§4.7, §8 and Appendix A, then the reference
  adapter `packages/core/src/modules/menu-import/adapters/instadelivery.ts` (allowlisted reads,
  `toCents`, hide-don't-reprice, `lost` codes) and `packages/core/test/menu-import.test.ts` (`map`
  on a fixture, `read` with a fake fetch).
- **Stack.** Starting Core and the admin, seeding, screenshots: the `local-stack` skill.

## 1. Rules for reading other stores

- **Public data only:** the requests a customer's browser makes for the store page. No login, no
  kept cookies, no tokens beyond ids the page itself sends.
- **Honest and slow:** the importer's own User-Agent (`USER_AGENT` in `http.ts`) and at least 1 s
  between requests to one platform host.
- **A block ends it.** A 403, 429, captcha or challenge page means that platform is blocked:
  record it and move on. No browser emulation, proxies, header spoofing or retry loops (§3).
- **Few stores:** up to 3 per platform for step 1, up to 10 to settle one field's meaning.
- **Nothing of other merchants in the repo.** Raw payloads and the slugs you used stay in the
  session scratchpad. Fixtures are synthetic content in the platform's shape (§8); no other
  merchant's name, phone, address, email or Pix key goes into a commit, PR or doc.
- **Quero Pudim** (`instadelivery.com.br/queropudimgourmet`) is the user's own store.

## 2. Step 1 — verify the payloads (gate)

Appendix A was recorded on 2026-10-01 from one or two stores per platform, against internal APIs
that can change any day. Before any adapter code, confirm each request chain still answers.

For **Instadelivery, Cardápio Web, OlaClick, Delivery Direto, Takeat, Saipos, Goomer**:

1. Find 2–3 live public stores: a web search on the store host (`site:app.cardapioweb.com`,
   `site:goomer.app`, …) or the platform's showcase. Take one small store and one with many option
   lists (a pizzeria).
2. Run the Appendix A chain with `curl` the way `http.ts` will: GET, `Accept: application/json`,
   the importer UA, no cookies, at most 3 redirects. Per request, record status, content type,
   bytes, time, redirects, and every header or id the next request needed.
3. Dump the key paths (names and types, never values; the `keys()` walk in `probe-cli.ts` is the
   model) and diff them against Appendix A: present, renamed, missing, new.
4. Record the image hosts (they become `hosts.images`) and check that an image answers a plain GET
   with an image content type.
5. Count requests for the big store. Goomer (one request per product) and Delivery Direto (one per
   category) are where the importer's budget, 60 s and 300 requests at 250 ms per host
   (`LIMITS` in `http.ts`), can run out.
6. **Custom domains** (Cardápio Web, OlaClick, Saipos, Goomer): find one store on its own domain
   and record how the platform's _API_ resolves a host (OlaClick `ms-companies/public/hosts/<host>`,
   Saipos `stores?filter={"domain_name":…}`; look for the equivalent on the other two).

Then:

- **Instadelivery** runs in production, so check it through the real code:
  `cd packages/core && bun run import:probe <url> --codes` on Quero Pudim and two other stores.
  If it fails, fixing it comes before everything else.
- **anota.ai and iFood:** one request each to a store page. A 403 or challenge confirms §3; stop
  there. A 200 from this network does not settle [§10.2](menu-import.md#10-open-questions), which
  is decided on the production VPS, but record it.

**Output**, committed before any code so it survives a container restart:

- Appendix A: a "Checked <date>" line per platform with any drift, the image hosts and the request
  count for the big store.
- §3 table: a verdict per platform, one of _works as documented_, _works with drift_, _blocked_ or
  _gone_.
- Your PR description: the same verdicts in one table.

**Gate.** A platform whose chain doesn't return JSON to that plain client is dropped from step 3,
marked in §3, and reported to the user. Never build an adapter on a chain you haven't seen answer.

## 3. Step 2 — finish Instadelivery

Phase 2 brings these over hidden, or as a note, because their meaning wasn't confirmed
([§9](menu-import.md#9-phases)). For each one: find stores that use it (count non-zero values
across the scratchpad payloads), open those stores' pages in headless Chromium
(`/opt/pw-browsers/chromium`) to see what a customer is actually charged, and map it only if
Venduá reproduces that price exactly. Otherwise it stays as it is, with a better note.

| Field (`adapters/instadelivery.ts`)                                                                                                               | Today                                    | Map to, if confirmed                                                                                                                                                                                                                  |
| ------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `item_discount` on a product                                                                                                                      | product hidden, `promo_unreadable`       | `priceCents` = what's charged, `compareAtPriceCents` = the old price, when the storefront shows it as a struck-through price. Settle reais vs percent.                                                                                |
| `price2` (a second price)                                                                                                                         | product hidden, `second_price`           | Find out what it is first: a size, a per-kg price, a "leve 2" price. Map only the case that has a Venduá equivalent.                                                                                                                  |
| `size1` / `size2` / `size` on `is_pizza` categories                                                                                               | products hidden, `pizza_sizes`           | If flavour prices depend on the size: one product per size (`<name> — <size>`), each with that size's flavour prices and the group's rule. If they don't: one product with a required "Tamanho" group. Both reproduce prices exactly. |
| `pix_discount`, `cash_discount`, `debit_card_discount`, `debt_increment`, `credit_increment`, `ticket_increment`, `takeaway_discount`, `discount` | note `payment_adjustment`                | `payments.adjustments` (`percentBps` or `fixedCents` per method). Settle percent vs reais. `takeaway_discount` and `discount` aren't per payment method, so they stay notes.                                                          |
| `free_delivery` on `fees[]`, `price_free` on `feesKm[]`                                                                                           | note `free_delivery_rule`                | `freeDeliveryOverCents` on that zone, when it means "free above R$ X". Free for every order is `feeCents: 0`.                                                                                                                         |
| `no_delivery` km tier inside the area                                                                                                             | note `delivery_gap`, delivered as a disc | Stays a note: radius zones are discs, and a ring needs a polygon zone. Improve the note only.                                                                                                                                         |

Each confirmed field gets: the adapter change, a case in the synthetic fixture
`test/fixtures/menu-import/instadelivery.json`, a unit test, the copy line in
`apps/admin/src/features/import/copy.ts` (and the `HIDES` set when a product stops being hidden),
the CRM note map in `apps/control/src/features/lead/LeadImport.tsx`, and Appendix A plus §9 in
the design. One PR for all of step 2.

## 4. Step 3 — one adapter per platform

Order: **Cardápio Web, OlaClick, Takeat, Delivery Direto, Saipos, Goomer**. Cardápio Web and
OlaClick are the shortest reads. Takeat is easy, and lead discovery already flags it
(`LISTING_HOSTS` in `agent/channels/discovery.ts`, along with Goomer). Saipos needs heavy
filtering. Goomer needs one request per product, so the budget change below comes first. Reorder
only on step 1's verdicts. One PR per adapter, each green before the next starts.

### Done means

1. **`adapters/<platform>.ts`** implementing `Adapter` (`adapters/types.ts`):
   - `match`: the platform's store URLs, with its reserved paths excluded.
   - `hosts`: the API and image hosts from step 1, and nothing else.
   - `read`: the verified chain through `http.json(url, headers)`, within the budget.
   - `map`: pure, allowlisted fields only. Money only through `toCents`. A product whose price
     Venduá can't reproduce comes over hidden with a code, never repriced. Everything left behind
     goes in `lost`.
2. **Register it** in `ADAPTERS` and remove its row from `NOT_YET` (`adapters/index.ts`).
3. **Fixture** `test/fixtures/menu-import/<platform>.json`: synthetic content in the real shape,
   with one case per hard thing on that platform (below), plus any credential-like field the
   real payload carries (it must not survive `map`).
4. **Tests** in `test/menu-import.test.ts`:
   - `recognise` on real-looking links, including the platform's reserved paths.
   - `map` on the fixture: counts, cents, option rules, hidden products and their codes, `lost`.
   - `read` with a fake fetch: the exact chain, only allowlisted hosts.
   - A DB test only if `apply` had to change.
5. **Words.** Every new `lost` code gets a line in `copy.ts` (and `HIDES` if it hides) and in the
   CRM note map. Every "por enquanto, só do Instadelivery" names the readable platforms:
   - admin: `copy.ts` `startError`, `ImportFlow.tsx` (placeholder and the hint below the field),
     `features/menu/Menu.tsx` (the entry row);
   - CRM: `LeadImport.tsx` (the prefill regex, which should take any recognised store host, plus
     the hint and placeholder).

   Keep one list of readable platforms per app rather than repeating names. If the platform's
   store host isn't in `LISTING_HOSTS` yet, add it so leads on it are flagged too.

6. **Live check.** `bun run import:probe <url> --codes` on step 1's stores: no crash, and every
   hidden product explained by its code. Then import the big store into a local tenant through
   the admin (`/cardapio/importar`) and look at the menu, options and prices in the storefront.
7. **Docs.** §3 verdict, Appendix A as built, §9 status.
8. **Checks.** `bun run check` in `packages/core`, `apps/admin` and `apps/control`; Core tests;
   `bun run build` and the screenshot gate in `apps/admin` if its copy changed; then the
   `invariant-reviewer` (Opus) on the diff, since it touches money.

### Per platform

What to look for, from Appendix A and the 2026-10-01 check. Step 1 may change it.

- **Cardápio Web.** Profile, then categories with `company-id` and `company` headers.
  - Add-ons are SINGLE, MULTIPLE or SUMMABLE (SUMMABLE means a quantity per option, i.e. `maxQty`).
  - Flavours use `price_calculation_type` MAX → `most_expensive`, SUM → `sum`.
  - The promo price has a weekday schedule. Venduá has none, so the promo stays only when it runs
    every day; otherwise import the full price and add a note.
  - `combo_steps` → kits when every item resolves (`kit_unresolved` otherwise).
  - Fees are computed per address, so there are no zones to import: add a note and leave
    _Entrega_ alone.
- **OlaClick.** Host lookup, then categories, company, `ecommerce-settings`, payment methods.
  - Variants with `price` and `original_price` → a size group, with `compareAtPriceCents` when every
    variant is discounted.
  - Per-variant stock; modifiers with min/max and a per-option `max_limit` (`maxQty`).
  - Delivery: fixed → one radius zone at the delivery limit; per km → a radius zone with
    `feePerKmCents`; districts → neighbourhood zones; ranges → radius zones; area → polygon
    zones.
- **Takeat.** Restaurant and brand ids, then the menu and delivery schedules.
  - Use `delivery_price`, not `price` (dine-in), and drop dine-in-only categories and items
    (`dine_in_only`).
  - `use_average` → `average`; `more_expensive_only` → `most_expensive`.
  - Prices are decimal strings, which `toCents` parses exactly.
  - The store payload carries credential-like fields: allowlist, and test that they're dropped.
- **Delivery Direto.** Categories, then one request per category, plus fees and payment forms.
  - `price_calculation_type` AVERAGE → `average`, HIGHER → `most_expensive`.
  - `max_choices` → group max; per-weekday availability → product availability.
  - Circle fees → radius zones, polygon fees → polygon zones.
- **Saipos.** Store lookup, then `sales/view-data` (~500 KB).
  - Drop items in disabled categories, and option references that point at no group in
    `choices[]` (that product hides as `options_unreadable` if the group was required).
  - Sizes come as `variations[]`; `calc_method` 1 → `sum`, 2 → `average`, 3 → `most_expensive`.
- **Goomer.** Info, the menu URL it names, then one option-group request per product.
  - First add a per-adapter budget: an optional `limits` on `Adapter` that `readImport`
    (`jobs.ts`) passes to `createImportHttp`. Keep the import deadline below the read lease
    (`READ_LEASE`, 90 s; raise both together) or a second worker reclaims the row mid-read.
  - Sizes come as `prices[]`; groups have min, max and `repeat` (no repeat → `maxQty` 1).
  - Settings are ~180 `mm_*` keys, many holding JSON strings: parse only the ones you map.
  - Many stores are dormant: an empty menu reads as `NOT_FOUND`, not an empty import.

Sizes come up on four platforms. When the second adapter needs the size handling or Instadelivery's
"a partir de" floor shift, move them from `instadelivery.ts` into a shared module next to
`types.ts`, rather than copying them.

## 5. Step 4 — custom domains (one PR, after the adapters it needs)

Cardápio Web, OlaClick, Saipos and Goomer stores can live on the merchant's own domain, which
`recognise` (pure, by host) can't place. Today no user-supplied host reaches a request
([§4.5](menu-import.md#45-outbound-requests)); keep it that way wherever a platform allows:

- An unknown host that is a valid public hostname becomes a pending read (`platform` null,
  `source_ref` = host).
- **Platform lookups first.** The read job asks each adapter that has a host lookup, on that
  adapter's own API host, in a fixed order. OlaClick and Saipos have one; step 1 says whether the
  others do. The first adapter that claims the host reads it.
- **The fallback is §4.5's fingerprinting GET** to the merchant's host, only for platforms with no
  lookup. It is the first request to a host no adapter declares. It must resolve DNS once,
  refuse private, loopback and link-local addresses, connect to the IP it checked (no second
  lookup to rebind), follow no redirects and read at most 256 KB. Build it only if step 1 finds a
  platform that needs it, and ask the user first.
- If nothing claims the host, the read fails as `NOT_FOUND` with a message to paste the
  platform's own link.

This changes `recognise`, the start route and `readImport`, and needs a migration because
`menu_imports.platform` is `not null`. Write the design into menu-import.md §4.4 and show it to
the user before building.

## 6. Out of scope

- anota.ai, unless the production check in §10.2 answers 200.
- iFood, which goes through the official Merchant API in phase 4 with its own design doc.
- The seed writing through `apply` (§9 phase 2).
- A weekly canary per platform (§8). It's worth doing once three or more adapters exist: a fleet
  job running `import:probe --codes` on a staff-owned store per platform.

## 7. Reporting

At the end of each step, update this file's status line and the design's §9, and push. When a
platform is blocked or a field can't be confirmed, say so in the PR and in §9; never guess a
price.
