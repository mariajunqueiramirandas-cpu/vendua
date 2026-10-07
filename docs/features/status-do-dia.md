# Status do dia: the store's WhatsApp Status, ready every day

> Status: Proposed, not planned · Started 2026-10-07 · Kind: differentiator (adjacent to P-018
> broadcasts in [`competitor-parity.md`](../competitor-parity.md), which it is not) · Builds on:
> [ADR 0026](../adr/0026-store-whatsapp-gateway.md), [ADR 0018](../adr/0018-page-composition.md),
> [ADR 0028](../adr/0028-privacy-first-platform-analytics.md)

For a small food business, WhatsApp Status is the cheapest marketing there is. The people who
saved the store's number are its best customers, and many of them check statuses every day. Owners
post when they remember, with a dark photo and no link. Status do dia has two parts:

1. **Daily posts.** Every day, at the hour the owner picks, the store has its Status ready: today's
   specials as images in the store's own colors and fonts, made from its real product photos, with
   a link that's tracked back to orders.
2. **"Saiu do forno".** One tap on a product posts it to Status, shows a badge on the storefront
   for 30 minutes, adds the batch to stock and tells the shoppers on that product's waitlist.

We can do this because we already hold the store's catalog, photos, brand tokens and WhatsApp
session. A menu platform without the session can only give the owner an image to post by hand.
Paths are under `packages/core/` unless they start with `apps/`, `packages/` or `docs/`.

## Summary

- **Phase S1 posts through the owner's phone.** Venduá prepares the day's images and caption with
  the tracked link, sends a push at the chosen hour, and the owner posts with the share sheet: two
  taps, "Compartilhar → WhatsApp → Meu status". Nothing new goes over our transport, so
  [ADR 0026](../adr/0026-store-whatsapp-gateway.md) is untouched.
- **Phase S2 posts automatically through the gateway.** Baileys 7.0.0-rc14 can post to
  `status@broadcast` with a `statusJidList`. But ADR 0026 says broadcasts and campaigns must not run
  on this transport, so S2 needs that ADR amended by the owner after a ban-risk spike.
- **Attribution is new for storefronts.** Storefronts don't capture `utm`/`ref` today. A small
  additive Kernel change carries a `ref` code from the link into the cart and the order.
- **"Saiu do forno" is one transaction:** a fresh-until badge on the product, stock added, a
  shopper-requested waitlist notice (allowed traffic), and the Status post.

## 1. The problem

- **Posting is inconsistent.** The store is visible on the days the owner remembers to post, which
  are not the days it needs it.
- **The images are poor.** A phone photo of a tray under kitchen light, the price typed in a
  sticker, no link. The shopper who wants to order has to message the store and wait.
- **Nothing is measured.** The owner can't tell whether yesterday's Status sold anything.
- **Venduá's share cards don't use the store's brand.** `apps/admin/src/features/marketing/shareCard.ts`
  draws a 1080×1350 PNG on a client canvas in Venduá's own palette (`#f7f4ea`, `#123c32`,
  `#d9f875`; Space Grotesk and Instrument Serif), not the store's tokens. Its URL carries no
  tracking (`admin/routes-marketing.ts:347-377`).

## 2. What it feels like

### The owner, S1

- **10:30, a push:** "Seu status de hoje está pronto · 3 imagens".
- **The Marketing → Status screen** shows the three images in the store's look (product photo,
  name, price from Core, "Peça pelo link") and one caption with the short link. "Postar no status"
  opens the share sheet with the images. In WhatsApp, the owner picks "Meu status" and sends.
- **Adjusting:** swap a product, reorder, change the caption, or skip today.
- **Next day:** "Ontem o status trouxe 4 pedidos · R$ 186".

### The owner, S2

- **The same plan, without the taps.** The owner approves the week's plan on Sunday, or leaves it on
  "escolha automática". Posts go out at the chosen hours. A post whose product is sold out at post
  time is skipped or swapped, never posted.

### "Saiu do forno"

- **On a bakery's Início** (or Cardápio, and the product page): a "Saiu do forno" strip of the
  products marked as fornada items. Tap "Pão de queijo", type "24" or skip it, and confirm.
- **What follows:**
  - The storefront card shows "Saiu do forno · há 3 min" for 30 minutes.
  - Stock goes up by 24 when the product tracks stock.
  - Everyone who asked "avise-me" on that product gets a message from the store's number.
  - The Status post is ready (S1) or posted (S2).

### Shoppers

- **They see the store's Status** with a photo that looks like the store's site, and tap the link.
- **The storefront opens on the product.** The order remembers it came from that Status.
- **Waitlist shoppers** get "O pão de queijo saiu do forno agora! Peça aqui: …", with the SAIR
  footer like every proactive message.

## 3. What we already have

| Piece                  | Where                                                                                                                                                                                       | Use                                                                                                   |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| The store's session    | `wa-gateway.ts`, `store-whatsapp/` (separate process, Postgres-only channel: `store_whatsapp`, `store_wa_messages`, NOTIFY)                                                                 | Where S2 posts                                                                                        |
| Baileys status support | `baileys` 7.0.0-rc14: `sendMessage(jid, content, { statusJidList, backgroundColor, font })`; `jid = 'status@broadcast'`                                                                     | S2's send. Image content `{ image, caption }`, uploaded by Baileys                                    |
| Brand tokens           | `storefront_tokens` via `currentTokensTx` (`modules/storefront-platform.ts:130`); `color{bg,surface,text,accent,…}`, `font{display,body,srcs[]}` (`packages/templates/src/tokens.ts:11-26`) | The look of every image                                                                               |
| Product photos         | `product_media` (`url`, `width`, `height`), served from `/v1/media/<tenant>/<id>.webp`                                                                                                      | The image's subject                                                                                   |
| Share-card renderer    | `apps/admin/src/features/marketing/shareCard.ts` (client canvas, 1080×1350)                                                                                                                 | S1's renderer, switched to the store's tokens and 1080×1920                                           |
| Product waitlist       | `notify_requests` (subject `product`), `wakeWaitlist` (`modules/stock.ts:145`) → outbox `waitlist.restocked`                                                                                | Today only the Vendedor consumes it, and only for active threads. "Saiu do forno" notifies by gateway |
| Shopper-asked notices  | `store_open` kind: SAIR footer, hourly ceiling, 1 h expiry, weekly cap per phone under a per-phone lock (`storefront-platform.ts:417-517`)                                                  | The template for a `product_back` notice                                                              |
| Live storefront        | `emitAdminTx(tx, id, 'catalog')` → refetch                                                                                                                                                  | The badge appears and disappears live                                                                 |
| Per-store due work     | `startAdminSweeper` (`admin/workers.ts:610`), 60 s, store timezone in `store_settings.hours.timezone`                                                                                       | The daily "pronto" push (S1) and the post queue (S2)                                                  |
| Merchant push          | `admin/webpush.ts`, `push_deliveries` dedupe                                                                                                                                                | The daily nudge                                                                                       |

**Gaps** (verified 2026-10-07):

- The gateway sends only text and voice notes (`store-whatsapp/session.ts:57-58`). There is no image
  column on `store_wa_messages`, and the `kind` CHECK (0096) has no status kind.
- There is no server-side image rendering. Core has only `Bun.Image` for resize and webp
  (`admin/media.ts:23-27`), and the Docker image has no fonts.
- The Kernel captures no `ref`/`utm`. The storefront beacon sends path and referrer host only
  (`packages/kernel/src/router.tsx:49-56`). `orders.source` is a channel label, and `order_placed`
  carries no campaign.
- The product card badge is a closed union (`packages/kernel/src/rules/card.ts:25`). A "fresh" badge
  is a Kernel rules change plus `ui-defaults` rendering.
- There is no customers table. Recipients for S2 come from `orders.customer_phone` and
  `shopper_threads`.

## 4. Design

### 4.1 The plan

- **Table** `status_plans(id, tenant_id, post_at time, days int[], mode, picks jsonb, caption)`.
  `mode` is `'auto' | 'pinned'`, and `picks` lists product ids when pinned. One row per store, with
  room for more slots later.
- **Picking products** (`auto`): Core picks today's products from what's available right now
  (not sold out, inside its schedule), weighted by the last 28 days' sales on this weekday, with
  products not shown in the last 3 days first. Prices come from the catalog, never from the image
  pipeline.
- **Table** `status_posts` with columns `id`, `tenant_id`, `plan_id`, `kind`, `product_ids`,
  `ref_code` (unique), `caption`, `state`, `posted_at`, `views` and `created_at`:
  - `kind` is `'daily' | 'fresh'`.
  - `state` is `'ready' | 'shared' | 'posted' | 'skipped' | 'failed'`.
  - `ref_code` is the attribution code.
- **The admin sweeper** writes the day's `status_posts` row 30 minutes before `post_at`. At
  `post_at` it pushes (S1) or enqueues (S2). The push is deduped by `push_deliveries`
  `(tenant_id, 'status:<post id>')`.

### 4.2 The images

- **S1 renders in the admin.** `shareCard.ts` grows a Status layout (1080×1920) drawn with the
  store's tokens, loading the token fonts through `FontFace` from `tokens.font.srcs`, and the
  store's logo (`store_settings.logo_url`). The "Postar no status" button calls
  `navigator.share({ files, text })`, and WhatsApp's share target offers "Meu status". On iOS the
  caption may drop with files. The fallback copies the caption first ("legenda copiada").
- **S2 renders ahead of time, still in the admin.** When the owner approves the week's plan, the
  admin renders the week's images and uploads them as media (`media_objects`, 2 MB cap). The
  gateway posts the stored image. No server renderer is needed. For the fully automatic
  `auto` mode, either Core renders server-side (satori + resvg, with the token fonts fetched and
  cached), or the gateway falls back to the product photo with a text caption. Open decision 3.
- **Every number on an image comes from Core** (`price`, `promoLabel`), formatted by Core's BRL
  formatter. The renderer prints strings it is given.

### 4.3 The link and attribution

- **The short link** is `https://<store domain>/?ref=<ref_code>`. With a product it is
  `https://<store domain>/<product path>?ref=<ref_code>`, where the path comes from
  `storefront_builds` as the share card does today.
- **The Kernel** (minor, additive; `API.md` + `CHANGELOG.md`) reads `ref` on first load, keeps it
  for the session, and sends it with cart creation and checkout. The value matches `^[a-z0-9]{6,12}$`.
  Anything else is dropped, never a 4xx.
- **Core** stores `carts.ref`, copies it to `orders.ref`, adds `ref` to the `order_placed`
  analytics props (`place-order.ts:394-399`), and adds the `page_view` beacon's `ref` when
  present.
- **Reports** gain "De onde vieram": orders and revenue by ref, grouped by Status post. The same
  `ref` also gives a QR on a bag or a link in the Instagram bio its own number.

### 4.4 "Saiu do forno"

`POST /admin/v1/products/:id/fresh { units? }` takes an Idempotency-Key through `write()`. Its role
is open decision 6: attendants run the oven, but they only touch orders today. In one transaction:

1. **Badge.** `products.fresh_until = now() + store_settings.fresh_minutes` (default 30) and
   `emitAdminTx(…, 'catalog')`. The Kernel's `CatalogProduct` gains optional `freshSince` and
   `freshUntil`. `rules/card.ts` adds a `'fresh'` badge below sold-out and above promo, and
   `ui-defaults` renders "Saiu do forno · há N min".
2. **Stock.** With `units` and a stock-tracked product, stock goes up by `units` through the
   existing stock path (`modules/stock.ts`).
3. **Waitlist.** It runs only when the product is orderable after steps 1–2: active, inside its
   schedule, not marked sold out (manually or by `sold_out_until`), and with stock above zero or
   untracked. `wakeWaitlist` marks every pending request notified, so waking it for a product that
   is still unavailable would send a false "voltou" and swallow the real one later. A tap with no
   `units` on a product whose tracked stock is still 0 is refused with 409 `NOT_AVAILABLE`, and the
   admin asks "Quantas saíram?" instead of showing a badge for nothing. A tap on a product marked sold out
   asks first: "Pão de queijo está esgotado. Voltar a vender?". The yes clears the mark through
   the existing availability route and then wakes the waitlist. When it runs, `wakeWaitlist`
   (`stock.ts:145`) marks the product's pending `notify_requests` notified and writes the
   `waitlist.restocked` outbox row. Today only the
   Vendedor consumes that row, and only for shoppers with a recent thread. A second consumer
   queues a new shopper-asked kind, `product_back` (migration on the 0096 CHECK), for the other
   contacts. The same consumer covers ordinary restocks, so "avise-me" finally reaches everyone. It
   follows the `store_open` rules:
   - the SAIR footer and opt-out check;
   - a 1 h expiry, sent only while open, behind order updates;
   - its own hourly ceiling (proposed 60);
   - one per phone per product per week, under the per-phone lock, which also stops the Vendedor
     and the notice from both messaging the same shopper.

4. **Status.** A `status_posts` row of kind `fresh`, pushed (S1) or enqueued (S2). There is at most
   one fresh post per product per 2 hours, so a bakery tapping every batch doesn't flood its own
   Status.

### 4.5 S2: posting through the gateway

This needs the owner to amend ADR 0026, after the spike in §7. The design:

- **New table** `store_wa_status` with columns `id`, `tenant_id`, `post_id` (unique), `media_id`,
  `caption`, `recipients`, `state`, `attempts` and `sent_at`. It is a separate queue, not a
  `store_wa_messages` kind, so a status can never be mistaken for a chat message and the per-chat
  caps stay as they are.
- **The gateway pump** posts it with
  `sendMessage('status@broadcast', { image, caption }, { statusJidList })`, at most 4 statuses per
  store per day, and only after the order queue is empty.
- **Recipients** (`statusJidList`):
  - Phones that ordered from the store in the last 180 days (`orders.customer_phone`), plus
    `shopper_threads` with a known PN.
  - Minus `store_wa_optouts`.
  - Forgotten customers are already gone, because forget nulls `orders.customer_phone`.
  - Resolved to JIDs with `phoneVariants`/`onWhatsApp`, and capped (open decision 4).
  - SAIR removes a phone from Status too, and the opt-out acknowledgement says so.
- **Who actually sees it** is decided by WhatsApp on the viewer's phone, probably only people who
  saved the store's number. To verify in the spike.
- **Views.** If receipts for `status@broadcast` reach a linked device, the gateway counts them into
  `status_posts.views`. Today it ignores status JIDs inbound (`runtime.ts:90`). It would count
  receipts only, never content.

## 5. Merchant controls

| Setting                        | Default                      | Who     |
| ------------------------------ | ---------------------------- | ------- |
| Status do dia on/off           | off                          | manager |
| Hour and weekdays              | 10:30, days the store opens  | manager |
| Products (automatic or pinned) | automatic                    | manager |
| Caption                        | Core's default with the link | manager |
| Fornada products               | none                         | manager |
| Badge duration                 | 30 min                       | manager |
| Automatic posting (S2)         | off                          | owner   |

## 6. Measuring it

- Posts ready against posts shared or posted. If owners don't post in S1, S2 matters more.
- Orders and revenue per ref, per post and per week. This is the "o status trouxe" number.
- Waitlist notices sent and the orders within 2 hours of a notice.
- Views per post (S2, if receipts work).

## 7. Phases

| Phase | Ships                                                                                                                    | Needs                                             |
| ----- | ------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------- |
| S0    | `ref` attribution end to end; "De onde vieram" in Relatórios; share cards in the store's tokens                          | Kernel minor; migration                           |
| S1    | `status_plans`/`status_posts`, the daily push, the Status screen, share-sheet posting                                    | —                                                 |
| S1b   | "Saiu do forno": badge, stock, `product_back` notices, fresh posts                                                       | Kernel minor (badge); migration on the 0096 CHECK |
| Spike | One test number: post statuses with a 50–500 JID list for two weeks; check delivery, who sees it, receipts, restrictions | A spare number                                    |
| S2    | Automatic posting through the gateway, views                                                                             | ADR 0026 amendment, by the owner                  |

S0 is worth shipping alone. It also measures the existing share cards and any bag QR.

## 8. Open decisions

1. **Amending ADR 0026 for S2.** Status is not a chat message, but it is one-to-many from an
   unofficial client. That's the owner's call after the spike.
2. **Who gets the Status (S2).** Everyone who ordered in 180 days, minus SAIR, or only shoppers who
   said yes at checkout ("quero ver as novidades no status")? The second is cleaner under the LGPD
   and smaller.
3. **Server rendering for fully automatic posts:** satori + resvg in Core, or posts that are just
   the product photo plus a caption.
4. **Recipient cap per post** in S2, set from the spike.
5. **Which plan has it.** That's the owner's call. Don't state it in copy.
6. **Who can tap "Saiu do forno".** Attendants (a narrow new permission: badge plus stock added,
   nothing else), or managers only, as for every other catalog change today.

## 9. Risks

- **Restriction of the store's number (S2).** It is the same transport that carries order updates,
  so a restricted number loses both. Mitigations: S1 first; the spike; a separate queue with a
  daily cap; posting only after the order queue drains; and a 403 stops the store, as today.
- **Stale posts.** A post promoting something sold out. Availability is checked at post time, and a
  sold-out product is swapped or skipped.
- **Images that misrepresent.** Only the store's own photos, never generated food. Prices come from
  Core at render time, and S2 re-checks the price at post time and re-renders if it changed.
- **Owner fatigue in S1.** If the push becomes noise, owners turn it off. The S1 measure (§6)
  decides whether S2 is worth the risk.

## Change log

- 2026-10-07: first proposal.
