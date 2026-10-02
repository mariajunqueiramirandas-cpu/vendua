# Domínio Tech

> Role: benchmark, not in the parity set · Last researched: 2026-10-01 · Confidence: Medium–high for what they claim (45 public pages rendered, FAQs that state their own limits), nothing verified inside the product

Restaurant ERP and PDV from São Paulo, sold as "Gerencie seu restaurante de ponta a ponta com
IA". Where we are a storefront, they are the whole back office (counter, cash register, kitchen,
fiscal, finance, stock, own fleet, marketplace hub), and AI is the interface on top of it. Of the
competitors we profile, they are the one whose AI reaches deepest into the merchant's operation.

**Decided (owner, 2026-10-01):** no Claude, ChatGPT or MCP integration, for merchants or shoppers.
Our merchant AI is a copilot inside the Venduá admin. Their connector and their ChatGPT app are
listed in §2 and §3 as `declined`, as facts about them, not as work for us.

## Summary

- **Every feature they publish** is listed in [§2](#2-every-feature-they-publish-with-our-status),
  module by module from AI to KDS to HR, each with our status. §2.24 has the totals.
  - Most of the gap is back office: PDV, caixa, KDS, NFC-e, finance, stock, recipes, fleet. That
    lands on the open scope decision in
    [`competitor-parity.md`](../competitor-parity.md#open-decisions).
  - The rest is the marketplace hub, WhatsApp marketing and the AI layer.
- **Their merchant AI** ([§3](#3-their-merchant-ai)) is broad and carefully guarded:
  - a copilot ("Lis") in the panel and in a native manager app;
  - a WhatsApp agent that takes the whole order and charges Pix in the chat;
  - an MCP connector for Claude and ChatGPT, which we decided not to match.

  It is mostly **reactive**. It does what it is asked, safely. Apart from fixed automations it
  rarely decides what to do next.

- **Can we build a more powerful one?** Yes, as a copilot inside our admin that is more
  autonomous and more focused on outcomes ([§4](#4-can-we-build-a-more-powerful-one)).
  - Our agent runtime is already ahead of anything they show in public: autonomy levels, wakeups,
    per-entity memory, cost caps and a simulation harness with an LLM judge.
  - What we lack is the tool surface (no tool definitions over `/admin/v1`) and the data (no
    per-store WhatsApp, one order channel, no finance or stock).
  - First step: an internal tool registry over `/admin/v1` with the copilot on top, then a
    proactive store operator they don't have.

## 1. What they sell

The site groups the product in four areas plus AI (`/produtos`):

- **Sales and operations**: order board, PDV, caixa, kiosk/totem, QR table ordering, driver app,
  dashboards, multi-store.
- **Menu and kitchen**: digital menu, menu manager, KDS, fichas técnicas, menu engineering.
- **Marketing and loyalty**: WhatsApp sales agent, WhatsApp campaigns, coupons and cashback, prize
  wheel, sales recovery.
- **Finance and fiscal**: payables and receivables, DRE, NFC-e, stock and purchases, suppliers and
  bank accounts, reports.
- **AI**: "IA para atender e vender" (WhatsApp) and "IA para gerenciar" (Lis, Claude/ChatGPT).

Integrations stated: iFood, 99Food, Anota AI, Delivery Much, Foody Delivery, Mercado Pago, Asaas.
Announced as "breve" (soon): Rappi, Stripe, Google Meu Negócio, Uber Direct, Lalamove.
Separate apps: Domínio Printer and Totem (Windows), Entregador and Kiosk (Android), Domínio
Gestão (manager app with Lis, Android/iOS) and Domínio RH (employee time clock).

## 2. Every feature they publish, with our status

Coverage: every feature stated on the 45 public pages, the full plan-comparison table on
`/precos`, the terms of use and the two privacy texts. Not counted: prices, plan limits,
marketing assets (the demo kitchen, the cookie banner) and their own staff jobs page.

Status, checked in Venduá's code on 2026-10-01:

- `have`: we ship it.
- `partial`: we ship part of it; what's missing is said.
- `gap`: we don't have it.
- `declined`: the owner decided not to build it.

P-IDs point at [`competitor-parity.md`](../competitor-parity.md). Paths are under
`packages/core/` unless they start with `apps/` or `docs/`.

### 2.1 AI and automation (detail in §3)

| Feature                                  | What they state                                                                                                                                                         | Venduá                                                                                            |
| ---------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| Copilot "Lis" in the panel               | "Copilot da operação" and "Copilot financeiro": answers on sales, orders, menu, stock, finance, invoices, customers                                                     | gap: no AI in the admin; home and reports are SQL aggregates (`src/admin/routes-home.ts:14`)      |
| Lis in the native manager app            | Same assistant in Domínio Gestão (Android/iOS)                                                                                                                          | gap                                                                                               |
| Lis writes                               | Menu changes (pause, price) at once; expenses, sangria and suprimento after confirming                                                                                  | gap                                                                                               |
| Lis reads attachments                    | Photos and PDFs up to 10 MB (an invoice, a receipt)                                                                                                                     | gap                                                                                               |
| Lis imports a menu from a URL            | Page read through Firecrawl                                                                                                                                             | gap                                                                                               |
| Lis feedback and history                 | 👍/👎 and "Reportar resposta"; chats kept 90 days and visible to the store's staff                                                                                      | gap                                                                                               |
| Store management from Claude and ChatGPT | MCP connector, "100+ actions", OAuth 2.1, CLI, skills, ChatGPT plugin                                                                                                   | declined (owner, 2026-10-01)                                                                      |
| WhatsApp AI attendant ("Recepcionista")  | Answers questions, sends the menu link                                                                                                                                  | gap (P-017)                                                                                       |
| WhatsApp AI sales agent ("Vendedor")     | Takes the order, delivery fee by neighbourhood, payment and change, summary before the "yes", order to board, printer and KDS                                           | gap (P-017)                                                                                       |
| Agent understands media                  | Text, audio, up to 3 photos; replies by voice to voice; amounts always in text                                                                                          | gap: our sales agent receives audio only as `[áudio]` (`src/agent/channels/whatsapp.ts`)          |
| Pix in the chat                          | Copia-e-cola valid 10 min, through the store's Mercado Pago                                                                                                             | gap                                                                                               |
| Price grounding                          | A value with no source in the system is blocked; the shopper gets the menu link                                                                                         | gap: our sales agent's `OFERTA` rule is prompt plus regex                                         |
| Human handoff                            | Queue in the panel with "Assumir"; agent silent 20 min after the store replies; pause the bot                                                                           | gap                                                                                               |
| Hours-aware agent                        | Answers when closed but takes no order                                                                                                                                  | gap                                                                                               |
| Sales recovery                           | One nudge 2–3 min after an unanswered quote, at most once per 24 h, inside the store's window                                                                           | gap (P-001): `'abandoned'` exists on carts but nothing sets it (`src/modules/cart.ts:156`)        |
| AI menu import from a photo or print     | "Até 120 produtos por foto", reviewed before saving; from an iFood or Anota AI print too                                                                                | partial: deterministic Instadelivery adapter only (`src/modules/menu-import/adapters/index.ts:6`) |
| AI product descriptions                  | One click, editable                                                                                                                                                     | gap (P-020)                                                                                       |
| AI-drafted WhatsApp templates            | "Descreva o objetivo para a IA montar um rascunho"                                                                                                                      | gap (P-018)                                                                                       |
| Daily summary push                       | 21h in the store's time zone: orders and total sold                                                                                                                     | gap: the existing daily digest is for staff (`src/modules/digest.ts`)                             |
| Shopper ordering app in ChatGPT          | "Dominio Tech Delivery": find stores, browse menus, build the cart, check status; checkout on the web                                                                   | declined (owner, 2026-10-01)                                                                      |
| Lis on the website                       | Answers prospects, creates the account, hands off to staff                                                                                                              | partial: our sales agent works WhatsApp, Instagram and email; no site chat                        |
| Lis in the help center                   | Answers from the published articles                                                                                                                                     | gap                                                                                               |
| Free public audit ("Raio-X")             | 0–100 score: Google rank for local searches, rating vs. the area median, review themes, HTTPS, PageSpeed, own channel vs. marketplace; plan unlocked by a WhatsApp code | gap as a product; the discovery job does similar research privately, per lead                     |

### 2.2 Order board

| Feature                      | What they state                               | Venduá                                                                  |
| ---------------------------- | --------------------------------------------- | ----------------------------------------------------------------------- |
| Board by stage               | In production, ready, on the way, done        | have (`src/admin/routes-orders.ts:441`)                                 |
| Real-time with a sound alert | New order appears at once, with sound         | have: SSE, a chime that repeats until seen, web push                    |
| Search                       | By customer, phone or order number            | have (`src/admin/routes.ts:403`)                                        |
| Filter by type               | Delivery, counter, attendance                 | partial: delivery and pickup only                                       |
| Every channel on one board   | Own menu, PDV, kiosk, table and marketplaces  | partial (P-013): storefront orders only; orders have no `source` column |
| Marketplace orders           | iFood, 99Food, Anota AI, Delivery Much, Foody | gap (P-013)                                                             |
| Courier on the card          | Assign or swap the driver from the board      | gap (P-019)                                                             |
| Automatic print on arrival   | With the print agent installed                | partial (P-016): manual browser print                                   |
| Cancel with a reason         |                                               | have (`src/admin/routes-orders.ts:566`)                                 |

### 2.3 PDV (counter sales)

| Feature                       | What they state                                                         | Venduá                                                                 |
| ----------------------------- | ----------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| Customer by phone             | Finds addresses, last orders and cashback; creates new customers        | gap (P-023)                                                            |
| Counter order with menu rules | Same menu, add-ons with min/max, a note per item, search                | gap (P-023): the rules exist in the menu, there is no counter screen   |
| Order type at the counter     | Delivery with address and fee, pickup, or dine-in on a registered table | gap: orders are `pickup` or `delivery` (`src/modules/checkout.ts:185`) |
| Split payment with change     | Cash, Pix, card, voucher, several in one order                          | gap                                                                    |
| Fiado (store credit)          | Up to a per-customer limit                                              | gap                                                                    |
| Discount with a reason        | R$ or %; a manager password when the user can't                         | gap                                                                    |
| Keyboard shortcuts            | Switch type, go from cart to payment                                    | gap                                                                    |
| Waiter ordering ("PDV Salão") | Orders at the table from the PDV, with a printed comanda                | gap (P-015)                                                            |
| "Ficha" order type            | Counted separately in reports                                           | gap                                                                    |
| NFC-e from the sale           | "Cupom Fiscal" button on the order                                      | gap (P-004)                                                            |

### 2.4 Caixa (cash register)

| Feature                       | What they state                                                                          | Venduá |
| ----------------------------- | ---------------------------------------------------------------------------------------- | ------ |
| Open with a float             | Each completed sale from any channel enters with its payment method                      | gap    |
| Cash movements                | Sangria, reforço, expense, supplier payment, each with who posted it                     | gap    |
| Close by counting each method | Expected vs. counted per method; online and iFood payments come pre-checked              | gap    |
| Tolerance and manager review  | Above the store's limit an explanation is required, then "conferido" or "divergente"     | gap    |
| Blind close                   | The cashier role counts without seeing the expected value                                | gap    |
| Close report                  | Sales by origin, methods and card brands; thermal or A4; emailed to the store and owners | gap    |
| Posting to finance            | Sales become received revenue per method; outflows become paid bills                     | gap    |
| History and alerts            | "To review" filter; alert when a caixa stays open over 24 h; a closed caixa can't reopen | gap    |
| Central caixa                 | One caixa for a kitchen running several brands                                           | gap    |

### 2.5 Kiosk and totem

| Feature                          | What they state                                                               | Venduá      |
| -------------------------------- | ----------------------------------------------------------------------------- | ----------- |
| Android tablet kiosk             | Domínio Kiosk app, about 10" on a counter stand, activation tied to the store | gap (P-015) |
| Windows totem, wall or floor     | Locked full screen, relaunches itself, technician PIN with escalating lockout | gap         |
| Same menu, terminal on the order | Products and prices of the store; each terminal identified; several per store | gap         |
| Pay at the counter               | The screen shows the order number to present at the till                      | gap         |
| Table tab on the tablet          | "A conta da mesa existe no autoatendimento em tablet"                         | gap         |

### 2.6 QR table ordering

| Feature                   | What they state                                                                | Venduá                                      |
| ------------------------- | ------------------------------------------------------------------------------ | ------------------------------------------- |
| Signed QR per table       | Up to 100 tables, the table number can't be edited in the link, valid one year | gap (P-015): the admin QR is the store link |
| Print material            | A4 with 4 per page, or an A6 card with instructions and cut marks              | gap                                         |
| Menu that knows the table | "Você está na Mesa 5"; only products enabled for tables                        | gap                                         |
| Payment                   | Pix online (the kitchen gets it after approval) or pay at the table            | gap                                         |
| Table on KDS and ticket   | Kept apart from delivery and pickup                                            | gap                                         |

### 2.7 KDS (kitchen display)

| Feature              | What they state                                                    | Venduá      |
| -------------------- | ------------------------------------------------------------------ | ----------- |
| Browser screen       | Own URL, any monitor, nothing to install                           | gap (P-016) |
| Stations as stages   | E.g. Chapa, Montagem; oldest order first                           | gap         |
| Timer per ticket     | Green up to 10 min, amber up to 20, then red (fixed)               | gap         |
| Item-level progress  | Advance item by item or the whole order; last stage marks it ready | gap         |
| Fed by every channel | Menu, PDV, counter, integrations                                   | gap         |

### 2.8 Printing

| Feature              | What they state                                        | Venduá                                                                                         |
| -------------------- | ------------------------------------------------------ | ---------------------------------------------------------------------------------------------- |
| Windows print agent  | Domínio Printer, paired with a token from the panel    | partial (P-016): manual browser print, 80 mm (`apps/admin/src/features/orders/actions.ts:221`) |
| Printer per sector   | Caixa, kitchen, bar, plus the fiscal coupon            | gap                                                                                            |
| Automatic and manual | USB or network printers; 58/80 mm; margins per station | partial: manual only                                                                           |

### 2.9 Delivery and own fleet

| Feature                        | What they state                                                                       | Venduá                                                           |
| ------------------------------ | ------------------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| Fee by neighbourhood or radius | Delivery areas with fees                                                              | have, plus polygons (`db/migrations/0066_delivery_polygons.sql`) |
| Shopper follows the status     |                                                                                       | have: live tracking page                                         |
| Driver app (Android)           | Ride offers with the payout shown before accepting, route, steps, earnings            | gap (P-019)                                                      |
| Delivery panel                 | Fleet on a map by last GPS fix, colours by order status                               | gap                                                              |
| Routes and dispatch            | Up to 3 orders per route; offered to all online drivers, first to accept, or pick one | gap                                                              |
| Driver settlement              | Per day, week, month; deducts cash collected; posted to finance with the account      | gap                                                              |
| On-demand couriers             | Uber Direct and Lalamove, announced                                                   | gap: after Phase 8 (`docs/roadmap.md`)                           |

### 2.10 Dashboards and reports

| Feature                          | What they state                                                            | Venduá                                                  |
| -------------------------------- | -------------------------------------------------------------------------- | ------------------------------------------------------- |
| Periods with comparison          | Today, 7, 30, 90 days, month or custom, vs. the previous period            | have (`src/admin/routes-reports.ts:68`)                 |
| Core numbers                     | Revenue, orders, ticket médio                                              | have                                                    |
| Daily series and payment methods |                                                                            | have                                                    |
| Peak hours                       | Orders per hour and a weekday × hour heatmap                               | have                                                    |
| Top products                     | Top 5 by revenue                                                           | have (top 10)                                           |
| Auto-refresh                     | The sales dashboard reloads when an order completes                        | gap: reports load on demand                             |
| Channel ranking                  | Value, orders and ticket per channel, share of total                       | gap: one channel                                        |
| Cancellations                    | Count, rate, lost value, by reason                                         | partial: count only; the reason is stored, not reported |
| Goal and estimates               | Goal line at previous period +10%; estimated net revenue and delivery time | gap                                                     |
| CSV export                       | Dashboards and sales list                                                  | have (`src/admin/routes-reports.ts:220`)                |
| Sales report filters             | Shift, status, type, channel, iFood store, NFC-e status                    | partial: period only                                    |
| Fees and discounts               | Delivery fees, surcharges, discounts                                       | have: fees and coupon discounts                         |
| Ticket by order type             | Delivery, counter, dine-in, ficha                                          | partial: delivery vs. pickup share                      |
| Fiscal in reports                | NFC-e status per order, batch emission, accountant export (CSV + XML ZIP)  | gap (P-004)                                             |
| Driver settlement report         |                                                                            | gap                                                     |
| Caixa close report by email      |                                                                            | gap                                                     |

### 2.11 Multi-store

| Feature                           | What they state                                                                  | Venduá                                     |
| --------------------------------- | -------------------------------------------------------------------------------- | ------------------------------------------ |
| Switch stores without a new login | Every plan                                                                       | have (ADR 0020, `src/admin/routes.ts:273`) |
| Network sales                     | Summed and per store, vs. the previous period, each store in its own time zone   | gap                                        |
| Network caixa and payables        | Forgotten open caixas, pending reviews, overdue and next-7-days bills, per store | gap                                        |
| Network DRE                       | One column per store plus the total                                              | gap                                        |
| HQ menu to branches               | Published with a preview; the branch keeps availability and, if allowed, price   | gap                                        |
| New unit from the panel           | Created with its CNPJ inside the network                                         | gap                                        |
| Network roles                     | Manager, finance, reader across all units                                        | gap                                        |
| Copilot over the network          | Sales, caixa, DRE and store comparison                                           | gap                                        |

### 2.12 Digital menu and menu manager

| Feature                             | What they state                                                                    | Venduá                                               |
| ----------------------------------- | ---------------------------------------------------------------------------------- | ---------------------------------------------------- |
| Own menu, no commission per order   |                                                                                    | have                                                 |
| Ready link                          | A platform subdomain                                                               | have                                                 |
| Custom domain                       | The store points it and staff set it up in 1–2 business days                       | have: same staff-activated model (ADR 0010 Proposed) |
| Photos, add-ons, notes, promotions  |                                                                                    | have: up to 12 photos per product, compare-at price  |
| Pay online or on delivery           | Mercado Pago or Asaas online                                                       | have for Mercado Pago; Asaas gap                     |
| Categories, products, add-on groups | Min, max, required                                                                 | have (`src/admin/routes-catalog.ts:676`)             |
| Add-on pricing rules                | Sum, highest (half-and-half pizza) or average                                      | have (`pricing_rule`)                                |
| Pause in one tap                    |                                                                                    | have                                                 |
| Reorder the menu                    |                                                                                    | have                                                 |
| Per-channel menu                    | Each product on or off per channel, with its own price and compare-at price        | partial: one channel; compare-at exists              |
| One menu for every surface          | Site, totem, table, PDV                                                            | partial: storefront only                             |
| iFood sync                          | Price, name, description, photo and pause in about a minute; new items by "Enviar" | gap (P-013)                                          |
| Import from iFood                   | Imported menus kept as auxiliary, can become the main one                          | gap (P-013): blocked from our network                |

### 2.13 Recipes (fichas técnicas) and menu engineering

| Feature              | What they state                                                                            | Venduá                                                |
| -------------------- | ------------------------------------------------------------------------------------------ | ----------------------------------------------------- |
| Ingredients          | Unit, yield, cost; average cost updated by supplier invoices                               | gap                                                   |
| Sub-recipes          | Sauces and bases with their own sheet, used at their published cost                        | gap                                                   |
| Links                | Sheet linked to a product, option or size, plus packaging per channel                      | gap                                                   |
| CMV and margin       | Simulated against the menu price before publishing                                         | gap                                                   |
| Versioned publishing | Immutable versions with reason, effective date, scheduling; blocked when a cost is missing | gap                                                   |
| Price simulator      | "Preço Certo": price per channel from fixed costs and channel commission                   | gap                                                   |
| Engineering matrix   | Star, plowhorse, puzzle, dog at the median of quantity and margin; bubble by revenue       | gap                                                   |
| Mix summary          | Projected cost, CMV, gross profit, ticket for 7 days, 30 days, 3 months                    | gap                                                   |
| Pareto               | The 18 products that bill most, with the 80% line                                          | gap                                                   |
| Real average price   | Price actually sold, add-ons included                                                      | gap                                                   |
| Best sellers         | Quantity and revenue per product                                                           | have: top products (`src/admin/routes-reports.ts:68`) |

### 2.14 Coupons, cashback, loyalty and prize wheel

| Feature                        | What they state                                                                                       | Venduá                                                                   |
| ------------------------------ | ----------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| Coupon types                   | Percent or fixed; free delivery (as a wheel prize)                                                    | have: percent, fixed, free delivery (`src/admin/routes-marketing.ts:86`) |
| Coupon limits                  | Validity, minimum order, total uses, single use, first order only                                     | have (`src/modules/coupons.ts:89`)                                       |
| Coupon for one phone           | "Cupom exclusivo"                                                                                     | have: phone-bound coupons                                                |
| Link with the coupon applied   |                                                                                                       | have (`?cupom=`)                                                         |
| Short link                     |                                                                                                       | gap                                                                      |
| First-order banner on the menu |                                                                                                       | gap                                                                      |
| Products excluded from coupons |                                                                                                       | gap                                                                      |
| Redemption history             | Each use with order, masked phone, discount and source (link, campaign, ad)                           | partial: redemptions and revenue per coupon, no source                   |
| Loyalty                        | Listed with customers, coupons and cashback; form not stated                                          | have: stamp card (`src/modules/customer.ts:217`)                         |
| Cashback                       | Percent above a minimum, credited on delivery, reversed on cancel, any channel                        | gap (P-010)                                                              |
| Cashback redemption            | On the menu after confirming the WhatsApp number, or at the PDV by phone; never stacked with a coupon | gap                                                                      |
| Prize wheel                    | 4–12 slices: percent, fixed, free delivery or no prize; odds per slice; drawn on the server           | gap                                                                      |
| Wheel limits                   | One spin per day or every N hours per WhatsApp number; optional CPF; closed-store notice              | gap                                                                      |
| Wheel prize                    | Coupon with validity (minutes) and an optional minimum order                                          | gap                                                                      |
| Wheel look and report          | Themes or a colour per slice, own copy; spins, coupons, redemptions, orders per day                   | gap                                                                      |

### 2.15 WhatsApp marketing

| Feature                    | What they state                                                                      | Venduá                                                                                          |
| -------------------------- | ------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------- |
| Connect the store's number | Meta login from the panel; coexists with the WhatsApp Business app                   | gap (P-018)                                                                                     |
| Template editor            | Photo, footer, buttons; sent to Meta review from the panel; re-checked at send time  | gap                                                                                             |
| Segments                   | VIP, Ativo, Morno, Risco, Inativo from order history; fiéis, a reengajar, a resgatar | gap                                                                                             |
| Personalisation            | Customer name, store name, or fixed text such as a coupon code                       | gap                                                                                             |
| Send flow                  | WhatsApp-style preview, test send, summary, audience count after exclusions          | gap                                                                                             |
| Frequency cap              | Anyone who got a campaign in the last 7 days is skipped                              | gap                                                                                             |
| Opt-out                    | SAIR, PARAR or a button; ATIVAR to come back; order notices still go                 | gap                                                                                             |
| Results                    | Sent, delivered, read; filters and calendar; clone a campaign                        | gap                                                                                             |
| Autopilot                  | A daily cap spread across approved templates and chosen segments, in batches         | gap                                                                                             |
| Meta Pixel                 | Listed with campaigns                                                                | gap (P-005)                                                                                     |
| Customer management        | History and frequency per customer                                                   | have: list, search, stats, profile, LGPD export and forget (`src/admin/routes-customers.ts:52`) |

### 2.16 Finance, DRE, suppliers

| Feature                       | What they state                                                                            | Venduá                                                                        |
| ----------------------------- | ------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------- |
| Payables and receivables      | Due date, category, supplier; overdue in red with the days late                            | gap: monthly Mercado Pago statement only (`src/admin/routes-payments.ts:364`) |
| Sales posted at caixa close   | One received revenue per payment method                                                    | gap                                                                           |
| Automatic expenses            | Mercado Pago fee on online payments; driver payouts                                        | gap                                                                           |
| Supplier invoices to payables | Each NF-e installment becomes a bill                                                       | gap                                                                           |
| Installments and recurrence   | 2–360, weekly, monthly or yearly; cancelling needs a reason, kept in history               | gap                                                                           |
| Batch settle                  | Date, account and method for many bills at once; CSV                                       | gap                                                                           |
| Realised and forecast result  | Received, overdue, realised and forecast for the period                                    | gap                                                                           |
| Protected automatic entries   | Corrected at the source, not by hand                                                       | gap                                                                           |
| DRE                           | Accrual or cash basis; gross revenue to net result; detail per account; % of revenue       | gap                                                                           |
| Chart of accounts             | 26 default categories mapped to DRE lines; unclassified and internal movements shown apart | gap                                                                           |
| CMV                           | From the month's purchases, or from recipes when stock draw covers 80% of sales            | gap                                                                           |
| Bank accounts                 | Type, bank, branch, number, opening balance; chosen at each payment                        | gap                                                                           |
| Suppliers                     | Created from the NF-e (name, CNPJ) or by hand with phone, email, notes; filter by supplier | gap                                                                           |

### 2.17 Stock and purchases

| Feature               | What they state                                                                 | Venduá                                                                                                         |
| --------------------- | ------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| Inbound NF-e          | Arrives from SEFAZ with items and installments; XML upload otherwise            | gap                                                                                                            |
| Item to ingredient    | Pack factor (a box of 24 enters as 24); a confirmed link is suggested next time | gap                                                                                                            |
| Landed cost           | Freight, insurance, other costs, discount, IPI, ICMS-ST; weighted average       | gap                                                                                                            |
| Received vs. invoiced | The received quantity enters; the invoice is flagged divergent                  | gap                                                                                                            |
| Stock position        | Balance and value, colour for zero or below minimum; print, CSV                 | partial: finished-product stock with a low-stock threshold (`db/migrations/0051_commerce_completeness.sql:57`) |
| Count and adjustments | Physical count, adjustments with reasons, daily history                         | gap                                                                                                            |
| Invoice reversal      | Removes the items and cancels unpaid installments                               | gap                                                                                                            |

### 2.18 Fiscal

| Feature                     | What they state                                                                     | Venduá      |
| --------------------------- | ----------------------------------------------------------------------------------- | ----------- |
| NFC-e issuing               | Through Focus NFe with the store's A1 certificate                                   | gap (P-004) |
| Homologation first          | Test receipts with no fiscal value before production                                | gap         |
| Tax types                   | NCM, CFOP, CST/CSOSN, CEST once per type, inherited by category, product and add-on | gap         |
| From the order or PDV       | CPF on the receipt on request; marketplace orders carry the intermediary            | gap         |
| Automatic issuing           | After simulating 90 days and the accountant's OK; filters by method, channel, value | gap         |
| Offline contingency         | Receipt printed with a notice and transmitted later                                 | gap         |
| Cancel and void             | Cancel within 30 min with a reason; skipped numbers listed to void                  | gap         |
| Print and export            | 58/80 mm after authorisation; XML in a ZIP and a spreadsheet                        | gap         |
| Supplier NF-e manifestation | "Ciência" from the panel (or the copilot)                                           | gap         |

### 2.19 Integrations

| Feature                                         | What they state                                          | Venduá                                        |
| ----------------------------------------------- | -------------------------------------------------------- | --------------------------------------------- |
| iFood                                           | Orders, menu sync, reviews (read and reply)              | gap (P-013, P-002)                            |
| 99Food, Anota AI, Delivery Much, Foody Delivery | Orders on the board                                      | gap (P-013)                                   |
| Mercado Pago                                    | Pix, card, online payment                                | have (`src/modules/payments/mercadopago.ts`)  |
| Asaas                                           | Pix, boleto, card                                        | gap                                           |
| WhatsApp per store                              | Official Cloud API with coexistence, or a QR connection  | gap: one platform number, for our sales agent |
| Announced                                       | Rappi, Stripe, Google Meu Negócio, Uber Direct, Lalamove | gap                                           |
| Request an integration                          | Form on the integrations page                            | gap                                           |

### 2.20 Team, permissions and HR

| Feature                      | What they state                                                                                                     | Venduá                                                        |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------- |
| Roles                        | Owner, admin, manager, cashier                                                                                      | partial: owner, manager, attendant (`src/admin/context.ts:8`) |
| Permission profiles          | Per screen (dashboards, reports, DRE)                                                                               | gap                                                           |
| Manager authorisation        | Manager password for a restricted action                                                                            | gap                                                           |
| Who did what                 | Name on caixa moves, settlements, Lis postings                                                                      | have: audit log (`db/migrations/0052_merchant_admin.sql:72`)  |
| Employee records             | Registration number, role, hire date, shift                                                                         | gap                                                           |
| Job openings                 | "RH: funcionários, vagas e ponto eletrônico"                                                                        | gap                                                           |
| Time clock app               | Selfie plus a geofence the employer sets; NSR receipt (Portaria 671); timesheet; adjustment requests approved by HR | gap                                                           |
| Facial-verification terminal | Clock-in terminal on CompreFace                                                                                     | gap                                                           |

### 2.21 Apps

| Feature                          | What they state                                                                                | Venduá                                                          |
| -------------------------------- | ---------------------------------------------------------------------------------------------- | --------------------------------------------------------------- |
| Manager app (Android/iOS)        | Orders, sales, reports, Lis, cancellation alerts, daily summary, call or WhatsApp the customer | partial: installable PWA with web push (`src/admin/webpush.ts`) |
| Print agent (Windows)            | See §2.8                                                                                       | partial                                                         |
| Totem (Windows), Kiosk (Android) | See §2.5                                                                                       | gap                                                             |
| Driver app (Android)             | See §2.9                                                                                       | gap                                                             |
| HR app                           | See §2.20                                                                                      | gap                                                             |

### 2.22 Account, billing, support and growth

| Feature              | What they state                                                                                                          | Venduá                                                                                         |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------- |
| Self-serve signup    | Account in a minute                                                                                                      | have (ADR 0021)                                                                                |
| No-card free trial   | Store pauses when it ends; data kept; no automatic charge                                                                | done: Basic's 14 days, no card; pauses unpaid ([ADR 0025](../adr/0025-free-trial-on-basic.md)) |
| Subscription payment | Card, Pix, boleto or bank transfer; invoice emailed in advance                                                           | partial: card or Pix                                                                           |
| Dunning              | Reminders, then read-only access, then suspension                                                                        | partial: past-due handling (`src/modules/billing/jobs.ts:111`), no read-only stage found       |
| Upgrade in the panel | "Planos" screen                                                                                                          | have (`/account/subscription`)                                                                 |
| Help center          | Categorised articles, searchable by Lis                                                                                  | partial: per-screen how-tos (`apps/admin/src/features/help/topics.tsx`)                        |
| Support channels     | Email, business-hours chat, WhatsApp by tier                                                                             | partial: "falar com a Venduá" posts to staff (`src/admin/routes.ts:697`)                       |
| Assisted migration   | Menu by link or from iFood, reviewed with their team                                                                     | partial: Instadelivery import and onboarding                                                   |
| Partner program      | Recurring commission tiered by active stores, first-month bonus, partner portal with link and QR, 60-day lead protection | gap                                                                                            |
| Data deletion        | LGPD request page                                                                                                        | have: per-customer export and forget (`src/admin/routes-customers.ts:139`)                     |

### 2.23 Where we lead

From what they publish; "not stated" doesn't mean they lack it.

- **Storefront design.** Templates and sections, page composition with history and restore, and
  design tokens (ADR 0018, `src/admin/routes-appearance.ts`). Their menu is one standard layout
  with the store's photos, prices and domain.
- **Delivery polygons.** We have them on top of neighborhood and radius zones; their help center
  lists "bairro ou raio".
- **Conversion analytics.** The funnel from visit to order, quote-to-order conversion per zone,
  and out-of-zone demand (`src/admin/routes-reports.ts`). They state none of these.
- **Stock drawn per order.** Our finished-product stock is decremented at checkout and returned
  on cancel. Theirs is moved only by counts, adjustments and invoices (their own FAQ).
- **Not stated by them.** Encomendas (date-based preorders), per-product schedules, a waitlist
  for sold-out items, and per-payment-method price adjustments.
- **Agent runtime.** See §4.1.

### 2.24 Totals

| Module (section)               | Rows    | have   | partial | gap     | declined |
| ------------------------------ | ------- | ------ | ------- | ------- | -------- |
| AI and automation (2.1)        | 23      | 0      | 2       | 19      | 2        |
| Order board (2.2)              | 9       | 4      | 3       | 2       | 0        |
| PDV (2.3)                      | 10      | 0      | 0       | 10      | 0        |
| Caixa (2.4)                    | 9       | 0      | 0       | 9       | 0        |
| Kiosk and totem (2.5)          | 5       | 0      | 0       | 5       | 0        |
| QR table (2.6)                 | 5       | 0      | 0       | 5       | 0        |
| KDS (2.7)                      | 5       | 0      | 0       | 5       | 0        |
| Printing (2.8)                 | 3       | 0      | 2       | 1       | 0        |
| Delivery and fleet (2.9)       | 7       | 2      | 0       | 5       | 0        |
| Dashboards and reports (2.10)  | 16      | 7      | 3       | 6       | 0        |
| Multi-store (2.11)             | 8       | 1      | 0       | 7       | 0        |
| Menu (2.12)                    | 13      | 9      | 2       | 2       | 0        |
| Recipes and engineering (2.13) | 11      | 1      | 0       | 10      | 0        |
| Coupons, loyalty, wheel (2.14) | 15      | 5      | 1       | 9       | 0        |
| WhatsApp marketing (2.15)      | 11      | 1      | 0       | 10      | 0        |
| Finance (2.16)                 | 13      | 0      | 0       | 13      | 0        |
| Stock (2.17)                   | 7       | 0      | 1       | 6       | 0        |
| Fiscal (2.18)                  | 9       | 0      | 0       | 9       | 0        |
| Integrations (2.19)            | 7       | 1      | 0       | 6       | 0        |
| Team and HR (2.20)             | 8       | 1      | 1       | 6       | 0        |
| Apps (2.21)                    | 5       | 0      | 2       | 3       | 0        |
| Account and growth (2.22)      | 10      | 3      | 5       | 2       | 0        |
| **Total**                      | **209** | **35** | **22**  | **150** | **2**    |

## 3. Their merchant AI

### 3.1 Surfaces

| Surface                                  | Who uses it                                      | Reads                                                                                                                                                                                                 | Writes                                                                                                                                                                                                                                                                                                                                   | Where                                                                                                                   |
| ---------------------------------------- | ------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| Lis copilot                              | Owner or manager                                 | Sales, orders, menu, stock, finance, invoices, customers                                                                                                                                              | Menu changes (pause, price) applied at once; expenses, sangria and suprimento after "orientada a confirmar"                                                                                                                                                                                                                              | Panel and the Domínio Gestão app; photo and PDF attachments; menu import from a URL (via Firecrawl)                     |
| "Gerenciar com IA" (MCP)                 | Owner or manager, in their own Claude or ChatGPT | Sales by channel and payment, top products, orders, menu, caixa, payables, DRE, fiscal, stock, customers and cashback, campaigns, deliveries, iFood reviews, the human-handoff queue, network numbers | Order status, cancel, reprint, pause the store and the WhatsApp bot; menu CRUD and reorder; caixa open/close/sangria; settle payables; import and manifest NF-e; stock entries and new ingredients; segments, templates and campaign sends; coupons and cashback; dispatch and settle drivers; reply to iFood reviews; place a PDV order | Remote MCP over HTTP (`mcp.dominio.tech/mcp`); a CLI with `doctor` and `connect`; "six skills"; a ChatGPT plugin (beta) |
| WhatsApp attendant                       | Shoppers                                         | Menu, hours                                                                                                                                                                                           | None; sends the menu link                                                                                                                                                                                                                                                                                                                | Store's WhatsApp                                                                                                        |
| WhatsApp sales agent ("Agente Vendedor") | Shoppers                                         | Menu, prices, delivery fees, coupons, hours                                                                                                                                                           | The order (after an explicit "yes"); a Pix charge valid 10 min                                                                                                                                                                                                                                                                           | Store's WhatsApp; text, audio and up to 3 photos; answers by voice to voice, amounts always in text                     |
| Sales recovery                           | Shoppers                                         | Quote state of the thread                                                                                                                                                                             | One fixed-text nudge, no incentive                                                                                                                                                                                                                                                                                                       | Same thread                                                                                                             |
| "Dominio Tech Delivery" ChatGPT app      | Shoppers                                         | Stores, menus, order status (code plus store, last 7 days)                                                                                                                                            | A 60-minute draft cart that pre-fills the web checkout                                                                                                                                                                                                                                                                                   | ChatGPT                                                                                                                 |
| Embedded helpers                         | Merchant                                         | —                                                                                                                                                                                                     | Menu from a photo, product descriptions, campaign template drafts                                                                                                                                                                                                                                                                        | Panel                                                                                                                   |
| Lis on the website and help center       | Prospects, merchants                             | Help articles                                                                                                                                                                                         | Creates the account; hands off to staff                                                                                                                                                                                                                                                                                                  | dominio.tech                                                                                                            |

The home page also lists "Equipe: colaboradores e ponto" among what the AI reads.

### 3.2 Trust design (worth copying)

- **Login.** OAuth 2.1 on their own screen; the AI never sees the password. One store per
  connection. Revocation is immediate, in "Conexões com IA" or in the client.
- **Three locks on writes.** Read is the default. Writes need the consent checkbox, a manager
  role, and a preview before confirmation. Tools are annotated as read, write or impact, so the
  client can ask before calling.
- **Audit.** Every call records who, when and what.
- **Compatibility claims.** A client is marked supported only after login, query, preview,
  confirmation and revocation pass "na matriz real".
- **The sales agent is grounded in code, as described.**
  - "Valor sem origem no sistema é bloqueado antes de chegar ao cliente."
  - The full summary goes out before the shopper confirms.
  - No orders while the store is closed.
  - A handoff queue with "Assumir"; the agent stays silent 20 min after a human replies.
- **Recovery.** Every condition is re-checked before sending, and a retry never sends twice.
- **Learning from confirmations.** A supplier-item-to-ingredient link confirmed through the
  connector is remembered and suggested on that supplier's next invoice.
- **Lis feedback.** An AI disclaimer under the input, 👍/👎 and "Reportar resposta". Reports are
  reviewed and used to adjust Lis's instructions; chats are kept 90 days.
- **Weak spots, from their own text.**
  - Lis applies menu changes at once.
  - Financial writes are confirmed by instruction to the model, not by a gate.
  - In ChatGPT, confirmation "depende das permissões, do contexto e do risco".

### 3.3 Models, data and cost

- **Providers.** Lis uses OpenAI today, including photos and PDFs. Their config can send
  attachments to Google Gemini and text to DeepSeek. The privacy policy (v2.1, 2026-09-23) lists
  OpenAI, Google/Gemini, DeepSeek or Anthropic for AI features, and Firecrawl for URL import.
  Hosting is GCP São Paulo with self-hosted Supabase.
- **Who pays for inference.** The MCP connector runs on the merchant's own Claude or ChatGPT plan
  (a plan with custom connectors: Pro or above on Claude). Domínio pays nothing for those tokens.
- **Metering.** Built-in AI is metered in "interações": one completed AI reply or action, where
  failures, technical retries and human turns don't count. Each plan has a quota per cycle.
- **Tiering.** Only their top single-store tier gets the order-taking WhatsApp agent; lower tiers
  get the attendant.
- **WhatsApp transport.** The official Cloud API with coexistence, or a QR-code connection
  ("infraestrutura Evolution em lojas legadas").

### 3.4 How powerful is it?

| Dimension                | Rating          | Evidence                                                                                                                                                                                                       |
| ------------------------ | --------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Breadth of actions       | Very strong     | 100+ actions over a full ERP; the ERP underneath is the moat, not the model                                                                                                                                    |
| Reach                    | Strong          | Panel, mobile app, Claude, ChatGPT, WhatsApp, a ChatGPT shopper app                                                                                                                                            |
| Write safety             | Strong / medium | Layered OAuth, role, preview and audit on MCP; Lis writes the menu without asking                                                                                                                              |
| Grounding                | Strong          | Prices with no source in the system are blocked; totals come from the menu, fees and coupons                                                                                                                   |
| Multimodal               | Medium–strong   | WhatsApp audio, photos and voice replies; Lis reads photos and PDFs; Lis has no voice (microphone blocked in the app)                                                                                          |
| Proactivity and autonomy | Weak            | A 21h daily summary, rule-based campaign autopilot and a fixed-text recovery nudge. No stated monitoring, goals or multi-step work started by the agent itself                                                 |
| Depth of analysis        | Medium          | Bounded by their data, and their FAQs list the limits: CMV approximated from purchases, no stock drawn per recipe, no year-over-year view, net revenue and delivery time are estimates, no bank reconciliation |
| Memory and learning      | Weak–medium     | 90-day chat history; learned supplier links; no stated per-store memory of decisions                                                                                                                           |
| Quality loop             | Medium          | Thumbs, reports and a per-client test matrix; no stated eval harness                                                                                                                                           |
| Shopper side             | Strong          | WhatsApp seller plus the ChatGPT app; the seller is WhatsApp-only ("Atende no Instagram ou no chat do site? Não.")                                                                                             |

**Verdict.** It is the most complete AI layer on a Brazilian restaurant system in our profiles.
Others ship WhatsApp attendants ([`whatsapp-bot.md`](../features/whatsapp-bot.md)), but none
states a copilot over finance and fiscal. Still, it is an AI **interface** to an ERP plus two
vertical agents, not an AI **operator**. It answers and executes well. It doesn't watch the
store, notice a problem, propose a fix, act within a budget, and check whether it worked.

## 4. Can we build a more powerful one?

Yes, inside our own admin, on autonomy, quality and storefront growth. On breadth of ERP actions,
only if we build the ERP modules. That is the scope decision, not an AI decision.

### 4.1 What we have and what we lack

We already have an agent runtime more capable than anything Domínio shows in public. It points at
leads (selling Venduá), not at stores:

- **Jobs.** Five, each with a step budget and a finish gate (`src/agent/jobs.ts`). 22 tools
  (`src/agent/tool-meta.ts`).
- **Autonomy levels.** `off | copilot | supervised | autopilot` (`src/agent/policy.ts:20`), plus
  code-enforced send gates: quiet hours, unanswered-send caps (`src/agent/guardrails.ts:314`).
- **Scheduling.** Wakeups from 10 min to 90 days ahead (`src/agent/wakeups.ts:11`) on the
  due-time scheduler (ADR 0017). Every run goes through `requestAgentTx` with a `source` (ADR 0016).
- **Memory.** A plan checklist, structured facts, segment and workspace learnings, and end-of-run
  debriefs (`src/modules/agent-memory.ts`).
- **Cost caps.** A per-entity lifetime cap (`src/modules/integrations.ts:230`) and per-run caps on
  paid lookups.
- **Providers.** gemini, openrouter, anthropic or openai, chosen per install
  (`src/modules/integrations.ts:25`).
- **Evals.** `bun run sim` (LLM personas plus an LLM judge that penalises fabrication) and a
  scripted provider for CI evals.

What caps a merchant copilot today:

- **No tool surface.** There are no tool definitions over `/admin/v1`.
- **No per-store WhatsApp.** Our WhatsApp channel is one platform number on an unofficial client
  (`src/agent/channels/whatsapp.ts`), and inbound audio arrives only as the tag `[áudio]`.
- **One order channel.** No `source` on orders and no marketplace intake.
- **Events nobody consumes.** Order transitions are written to `outbox` (`src/modules/orders.ts:274`)
  but nothing reads them, so shoppers get no status messages.
- **No back-office data.** No finance, caixa, fiscal or ingredient stock.

### 4.2 What "more powerful" should mean

Six properties. Domínio has half of the first and half of the fifth:

1. **In our app, nothing to install or pay for elsewhere.** The copilot lives in the admin and
   the PWA; the merchant needs no Claude or ChatGPT plan.
2. **Proactive.** It notices and proposes without being asked.
3. **Delegated, inside budgets enforced in code.** The merchant sets what it may do alone. A
   prompt is not a limit.
4. **Closed loop.** It measures what its own actions changed and remembers it per store.
5. **Shopper agent with hard money grounding, on more than one channel.**
6. **Evaluated before it ships.** Sims and judges, not only thumbs.

### 4.3 Design (proposal, not decided)

All of it stays inside the invariants in `CLAUDE.md`. Tools run through the same module code as
the HTTP handlers, so tenant isolation (`SET LOCAL vendua.tenant_id`), the Idempotency-Key claim
pattern, Core-computed money and bounded inputs come for free. Every run is requested through
`requestAgentTx`.

**A. An internal tool registry over `/admin/v1` (the foundation).** It is internal only, not a
public API. Each tool declares:

- a name and a bounded input schema;
- a class: `read`, `write`, `money` or `irreversible`;
- a minimum role (`owner | manager | attendant`, `src/admin/context.ts:8`);
- a `preview()` that returns the diff;
- an executor that calls the module function the route already uses.

The ~60 existing routes (orders, catalog, store, hours, zones, appearance, marketing, customers,
reports, payments, team) are the first catalog. Every call writes `audit_log` with the actor
`ai:copilot` and the merchant who asked.

**B. The copilot in the admin.** A `store_copilot` job, opened from any admin screen and from the
PWA. Things Lis doesn't do:

- **Confirmation by the class of the change.**
  - Every write shows its preview and waits for a tap.
  - `money` and `irreversible` writes also need the owner or manager role.
  - Unlike Lis, no write lands without confirmation.
- **Voice input.** Lis blocks the microphone.
- **Attachments and imports as copilot skills.**
  - A menu photo, print or URL becomes an import preview through the existing import pipeline
    (`POST /imports`).
  - Product descriptions are drafted in place (P-020).

**C. A proactive store operator (where we pull ahead).**

- **C1. Watch routines per store** on the existing scheduler. Each finding becomes a proposal in
  the copilot inbox, with one-tap approval from a push notification. Signals:
  - orders per hour against the store's own baseline while it is open;
  - "open but zero orders";
  - Mercado Pago disconnected, or payment failures;
  - acceptance slower than `accept_target_minutes`;
  - repeated sold-outs;
  - spikes in out-of-zone demand;
  - coupon abuse.
- **C2. Weekly growth review**, modelled on the `strategist` job.
  - Reads the funnel, zone conversion, coupons, repeat rate and cohorts.
  - Proposes up to three actions, with the expected effect computed in Core, not by the model.
  - Books a wakeup to measure the result and writes the learning to store memory.
- **C3. Delegated budgets.** Per action class, the merchant sets limits such as:
  - "up to R$ X a month in win-back coupons";
  - "may pause items when they sell out";
  - "never changes prices".

  These are enforced in guardrails like today's send gates, reusing `AutonomyLevel` per class.
  The amounts are the merchant's, not ours.

- **C4. Storefront experiments.** Propose section or layout changes through page composition
  (ADR 0018), measure conversion from `analytics_events`, and roll back through appearance
  history. Domínio has nothing like it, because their menu is a fixed layout.
- **C5. Store memory.** Facts and learnings per store, the shape of `lead_facts` and
  `agent-memory.ts` applied to a tenant.
- **C6. Daily summary with a point of view.** Their summary is the 21h numbers. Ours adds what
  changed, why, and the one action proposed for tomorrow.

**D. A shopper agent (P-017) on the same runtime.**

- **D1. Ordering.** On the store's own WhatsApp over the official API, placing orders through the
  existing checkout path with an Idempotency-Key, so a conversation yields at most one order.
  Fits [`whatsapp-bot.md`](../features/whatsapp-bot.md).
- **D2. Money grounding in code.**
  - The agent quotes only through `/quote`.
  - Any amount in an outbound message must equal a figure Core computed, or the message is
    blocked.
  - Retrofit the same check to the sales agent, whose `OFERTA` rule today is prompt plus regex
    plus the sim judge.
- **D3. More channels.** WhatsApp, Instagram DM (`services/ig-sidecar` exists) and a chat widget
  on the storefront. Their seller is WhatsApp-only.
- **D4. Media.** Transcribe audio and understand photos.
- **D5. Recovery and status messages.**
  - Recovery may carry an incentive from the merchant's C3 budget, with personal copy. Theirs is
    fixed text with no coupon.
  - Order-status messages come from the `outbox` rows that already exist.

**E. A quality moat.**

- Extend `bun run sim` with merchant personas and store fixtures. Scenarios: data questions,
  risky requests, and prompt injection through a shopper message or a review.
- Judge grounding, safety and outcome.
- Add scripted-provider tests in CI for every write tool.

### 4.4 Scorecard: theirs today and ours after A–E

| Dimension                | Domínio today   | Venduá today           | Venduá after A–E                                                                       |
| ------------------------ | --------------- | ---------------------- | -------------------------------------------------------------------------------------- |
| Breadth of actions       | Very strong     | None (merchant side)   | Medium; storefront only unless ERP modules come                                        |
| Reach                    | Strong          | None                   | Medium: admin, PWA, WhatsApp, Instagram, web chat; no external assistants, by decision |
| Write safety             | Strong / medium | n/a                    | Strong: preview on every write, role, budgets and audit in code                        |
| Grounding                | Strong          | Prompt-level (sales)   | Strong: amounts checked against Core                                                   |
| Proactivity and autonomy | Weak            | Strong (leads only)    | Strong: watch, review, act within budgets                                              |
| Closed loop and memory   | Weak–medium     | Strong (leads only)    | Strong: per-store memory and outcome checks                                            |
| Quality loop             | Medium          | Strong (sim and judge) | Strong                                                                                 |
| Shopper side             | Strong          | None                   | Strong on channels; parity on ordering                                                 |

### 4.5 Out of reach without new modules

Their AI answers "how did the month close", "count the caixa", "issue the NFC-e", "what is the
CMV of this burger", "how much do I owe each driver" and "which channel pays best". Each needs a
module we don't have (§2.3–2.18). A merchant who runs the whole restaurant on Domínio will find
our copilot narrower, however autonomous it is.

### 4.6 Decisions

Taken:

- **No Claude, ChatGPT or MCP integration** (owner, 2026-10-01). The merchant's copilot lives
  inside the admin.

Open, for the owner:

1. **Scope.** A storefront-and-growth copilot, or a restaurant ERP (dine-in, PDV, caixa, finance)
   to put it on? This is the same open question as P-015, P-016 and P-023.
2. **How AI is charged.** Included, or metered per plan (their model). No prices here.
3. **Model providers for store and shopper data** under LGPD. Domínio can route to DeepSeek; we
   should pick providers whose terms exclude training on our data.
4. **WhatsApp transport per store.** The official Cloud API with coexistence, or an unofficial
   client (our sales agent uses baileys today).
5. **Whether Domínio joins the parity set.** Adding it changes the counts in
   `competitor-parity.md`.

### 4.7 Risks

- **Prompt injection.** Shopper messages and reviews feed a model that has write tools. Runs
  started by a shopper never get merchant write tools.
- **PII to providers.** Send the minimum. The staff-events rule (no shopper names or phones in
  event data) is the model to follow.
- **Wrong autonomous actions.** Contain them with budgets, previews, undo (appearance restore,
  reversible catalog edits) and the audit log.
- **Cost runaway.** Use per-tenant cost caps on the pattern of the per-lead cap.
- **WhatsApp bans on unofficial transports.**

## 5. Proposed next steps

1. Write an ADR for the internal tool registry and the in-app copilot (A, B): tool classes,
   confirmation rules, audit actor.
2. Ship a read-only copilot first (reports, orders, catalog, customers) to a few pilot merchants.
3. Add write tools with preview and confirm, then the menu-photo import and descriptions as
   copilot skills.
4. Add the watch routines, the weekly review and the daily summary (C1, C2, C6) on the existing
   scheduler, proposals only, with no autonomous writes yet.
5. Turn the P-017 shopper agent into a design, with money grounding in code (D1, D2).
6. Add merchant-copilot sim scenarios (E) before any autopilot.

## Sources and caveats

All pages were rendered with headless Chromium on 2026-10-01; the site is a client-rendered app,
so plain fetches return only the title.

- **Pages read:** `https://dominio.tech/`, `/gerenciar-com-ia` (including the CLI, Skills &
  Plugin and ChatGPT tabs), `/produtos` and its 25 product pages, `/precos` (with the full "Compare
  todos os recursos" table), `/funcionalidades`, `/integracoes`, `/delivery-whatsapp-ia`,
  `/cardapio-digital`, `/entrega-propria`, `/raio-x`, `/aplicativos` (= `programas.dominio.tech`),
  `/base-de-conhecimento` (article titles), `/seja-parceiro`, `/cozinha-demo`,
  `/exclusao-de-dados`, `/termos-de-uso` §5, `/llms.txt` and `/sitemap.xml`.
- **Privacy texts:** `/politica-privacidade` (v2.1, 2026-09-23: §3.5 ChatGPT app, §3.6 AI
  providers, §18 HR app, §19 manager app), `/privacidade-app-gestao` §5–6 (Lis) and
  `/privacidade-app-rh` (time clock).

Caveats:

- Everything is marketing, FAQ or policy text. None of it was verified inside the product, since
  no account was created.
- Help-center article bodies and the home-page FAQ answers did not expand in the renderer; only
  their titles are covered.
- The MCP tool catalog was not inspected. "100+ actions" is their count; the write list in §3.1
  is assembled from their examples.
- "Breve" integrations are announcements.
- Prices, plan quotas and partner commission rates are left out, per [README](README.md).
- Venduá status was checked in code on 2026-10-01 (Core, admin, kernel).

## Change log

- 2026-10-01: first pass. Full site, AI surfaces, gap list against Venduá's code, and a
  merchant-agent proposal.
- 2026-10-01: §2 rebuilt as a full inventory: every feature they publish, with our status and
  totals. The proposal now follows the owner's decision: no Claude, ChatGPT or MCP integration,
  and a copilot inside the admin.
