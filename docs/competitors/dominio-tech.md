# Domínio Tech

> Role: benchmark, not in the parity set · Last researched: 2026-10-01 · Confidence: Medium–high for what they claim (45 public pages rendered, FAQs that state their own limits), nothing verified inside the product

Restaurant ERP and PDV from São Paulo, sold as "Gerencie seu restaurante de ponta a ponta com
IA". Where we are a storefront, they are the whole back office (counter, cash register, kitchen,
fiscal, finance, stock, own fleet, marketplace hub), and AI is the interface on top of it. Of the
competitors we profile, they are the one whose AI reaches deepest into the merchant's operation.

## Summary

- **What they have that we don't.** About 55 features, listed in [§2](#2-features-they-have-that-venduá-doesnt).
  Most of the gap is back office, which lands on the open scope decision in
  [`competitor-parity.md`](../competitor-parity.md#open-decisions): dine-in, PDV, caixa, KDS, NFC-e,
  finance, stock and fleet. The rest is the marketplace hub, WhatsApp marketing and the AI layer.
- **Their merchant AI** ([§3](#3-their-merchant-ai)) is broad and carefully guarded:
  - A remote MCP connector for Claude and ChatGPT with "100+ actions".
  - A copilot ("Lis") in the panel and in a native manager app.
  - A WhatsApp agent that takes the whole order and charges Pix in the chat.
  - A shopper ordering app inside ChatGPT.

  It is mostly **reactive**. It does what it is asked, safely. Apart from fixed automations it
  rarely decides what to do next.

- **Can we build a more powerful one?** Yes, if "more powerful" means more autonomous and more
  focused on outcomes, not more tools ([§4](#4-can-we-build-a-more-powerful-one)).
  - Our agent runtime is already ahead of anything they show in public: autonomy levels, wakeups,
    per-entity memory, cost caps and a simulation harness with an LLM judge.
  - What we lack is the tool surface (no merchant API or MCP) and the data (no per-store
    WhatsApp, one order channel, no finance or stock).
  - First step: one tool registry over `/admin/v1`, then MCP and a built-in copilot on it, then a
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
- **AI**: "IA para atender e vender" (WhatsApp) and "IA para gerenciar" (Claude/ChatGPT, Lis).

Integrations stated: iFood, 99Food, Anota AI, Delivery Much, Foody Delivery, Mercado Pago, Asaas.
Announced as "breve" (soon): Rappi, Stripe, Google Meu Negócio, Uber Direct, Lalamove.
Separate apps: Domínio Printer and Totem (Windows), Entregador and Kiosk (Android), Domínio
Gestão (manager app with Lis, Android/iOS) and Domínio RH (employee time clock).

## 2. Features they have that Venduá doesn't

`gap` = we don't have it; `partial` = we have part of it (the gap is said). Venduá status was
checked in code on 2026-10-01; the IDs point at [`competitor-parity.md`](../competitor-parity.md).
Paths are under `packages/core/` unless they start with `apps/` or `docs/`.

### 2.1 AI and automation (detail in §3)

| Their feature                                | What they state                                                                                                                                                                           | Venduá                                                                                            | ID    |
| -------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- | ----- |
| Store management from Claude / ChatGPT (MCP) | "Mais de 100 ações" over sales, orders, menu, caixa, fiscal, finance, stock, marketing, coupons, deliveries, iFood reviews                                                                | gap: no MCP, no merchant API keys; `/admin/v1` is a cookie session                                | —     |
| Copilot "Lis" (panel and native manager app) | Answers on sales, orders, menu, stock, finance, invoices, customers; edits menu, posts expenses; reads photos and PDFs                                                                    | gap: home and reports are SQL aggregates (`src/admin/routes-home.ts:14`)                          | —     |
| WhatsApp AI attendant                        | Answers questions, sends the menu link, 24 h                                                                                                                                              | gap                                                                                               | P-017 |
| WhatsApp AI sales agent                      | Takes the order, quotes delivery by neighborhood, Pix in chat, registers the order after the shopper's "yes"                                                                              | gap                                                                                               | P-017 |
| Sales recovery in the WhatsApp thread        | One nudge 2–3 min after an unanswered quote, at most once per 24 h, inside the store's window                                                                                             | gap: `'abandoned'` exists on carts but nothing sets it (`src/modules/cart.ts:156`)                | P-001 |
| AI menu import from a photo or print         | "Até 120 produtos por foto", reviewed before saving; Lis also imports from a URL                                                                                                          | partial: deterministic Instadelivery adapter only (`src/modules/menu-import/adapters/index.ts:6`) | —     |
| AI product descriptions                      | One click, editable before saving                                                                                                                                                         | gap                                                                                               | P-020 |
| AI-drafted WhatsApp templates                | "Descreva o objetivo para a IA montar um rascunho"                                                                                                                                        | gap                                                                                               | P-018 |
| Shopper ordering app inside ChatGPT          | "Dominio Tech Delivery": find stores, browse menus, build the cart; checkout on the web menu; order status by tracking code                                                               | gap                                                                                               | —     |
| AI assistant on the site and help center     | "Tiro dúvidas sobre a plataforma, crio a sua conta e chamo o time"                                                                                                                        | partial: our sales agent works WhatsApp, Instagram and email; no site chat                        | —     |
| Free public audit ("Raio-X do Restaurante")  | 0–100 score in about a minute: Google rank for local searches, rating vs. the area median, review themes, HTTPS, PageSpeed, own channel vs. marketplace; plan unlocked by a WhatsApp code | gap as a product; the discovery job does similar research privately, per lead                     | —     |

### 2.2 Orders and channels

| Their feature                 | What they state                                                                                  | Venduá                                                                                | ID    |
| ----------------------------- | ------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------- | ----- |
| One board for every channel   | Own menu, PDV, kiosk, table, iFood, 99Food, Anota AI, Delivery Much, with sound alerts           | partial: live board and chime, storefront orders only; orders have no `source` column | P-013 |
| Marketplace order intake      | iFood, 99Food, Anota AI, Delivery Much, Foody Delivery                                           | gap                                                                                   | P-013 |
| iFood menu sync               | Price, name, description, photo and pause reach iFood "em cerca de um minuto"; import from iFood | gap; iFood import is blocked from our network                                         | P-013 |
| iFood reviews, read and reply | In the panel and through the AI connector                                                        | gap                                                                                   | P-002 |
| Courier on the order card     | Assign or swap the driver without leaving the board                                              | gap                                                                                   | P-019 |
| Cancellations by reason       | Dashboard card with count, rate, lost value and reasons                                          | partial: cancelling requires a reason, but reports don't break it down                | —     |

### 2.3 In-store operations

| Their feature    | What they state                                                                                                                                                                                         | Venduá                                                                                        | ID    |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- | ----- |
| PDV (counter)    | Customer found by phone with addresses, history and cashback; split payment with change; fiado up to a limit; discount with reason and manager password; keyboard shortcuts                             | gap: orders are `pickup` or `delivery` only (`src/modules/checkout.ts:185`)                   | P-023 |
| Caixa            | Opening float, sangria/suprimento/expenses; blind close counted per payment method; tolerance with mandatory explanation and manager review; report by thermal print and email; sales posted to finance | gap                                                                                           | —     |
| Kiosk / totem    | Locked full-screen Windows app with a technician PIN; Android tablet app; pay at the counter                                                                                                            | gap                                                                                           | P-015 |
| QR table order   | Signed QR per table (up to 100, valid a year), printable cards, Pix online or pay at the table, table number on ticket and KDS                                                                          | gap; the admin QR is the store link                                                           | P-015 |
| KDS              | In the browser; stations are stages; item-by-item progress; green/amber/red at 10/20 min                                                                                                                | gap                                                                                           | P-016 |
| Thermal printing | Windows print agent, a printer per sector (caixa, kitchen, bar, fiscal), automatic, 58/80 mm                                                                                                            | partial: manual browser print, 80 mm layout (`apps/admin/src/features/orders/actions.ts:221`) | P-016 |
| Change for cash  | Troco at the PDV and in the WhatsApp agent                                                                                                                                                              | gap: cash is a label; the shopper can only type a note                                        | —     |

### 2.4 Own delivery fleet

| Their feature        | What they state                                                                         | Venduá                                 | ID    |
| -------------------- | --------------------------------------------------------------------------------------- | -------------------------------------- | ----- |
| Driver app (Android) | Ride offers with the payout shown before accepting, route, status, earnings             | gap                                    | P-019 |
| Delivery panel       | Fleet on a map (last GPS fix), routes of up to 3 stops, offer to all or pick the driver | gap                                    | P-019 |
| Driver settlement    | Per day, week, month; deducts cash the driver collected; posts to finance               | gap                                    | P-019 |
| On-demand couriers   | Uber Direct and Lalamove, announced                                                     | gap; after Phase 8 (`docs/roadmap.md`) | P-019 |

### 2.5 Menu and costing

| Their feature                  | What they state                                                                                                                                                                | Venduá                                                    | ID  |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------- | --- |
| Per-channel menu               | Each product on or off per channel (own menu, marketplace, PDV), with its own price and compare-at price                                                                       | partial: one channel; compare-at price exists             | —   |
| Fichas técnicas                | Ingredients with yield, sub-recipes, versioned publishing that can be scheduled, links to option/size and per-channel packaging, CMV and margin, a per-channel price simulator | gap                                                       | —   |
| Menu engineering               | Star / plowhorse / puzzle / dog split at the median, Pareto 80/20, real average price including add-ons                                                                        | gap; top products only (`src/admin/routes-reports.ts:68`) | —   |
| Products excluded from coupons | Merchant marks items that never take a coupon                                                                                                                                  | gap                                                       | —   |

### 2.6 Marketing and loyalty

| Their feature               | What they state                                                                                                                                                   | Venduá                                     | ID    |
| --------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------ | ----- |
| WhatsApp campaigns          | Official Meta API with coexistence; templates sent to Meta review from the panel; name variables; test send; sent, delivered and read stats; calendar view; clone | gap                                        | P-018 |
| Segments from order history | VIP, Ativo, Morno, Risco, Inativo, plus high-value cohorts (fiéis, a reengajar, a resgatar)                                                                       | gap; customer list with stats, no segments | P-018 |
| Campaign autopilot          | A daily send cap spread across approved templates and chosen segments, in batches inside a time window                                                            | gap                                        | P-018 |
| Frequency cap and opt-out   | 7-day cap across all campaigns; SAIR / PARAR / button opt-out; ATIVAR to come back                                                                                | gap                                        | P-018 |
| Cashback                    | Percent above a minimum, credited on delivery, reversed on cancel, from any channel; redeemed on the menu or at the PDV                                           | gap; stamp card only                       | P-010 |
| Prize wheel                 | 4–12 slices drawn on the server, one spin per day or per N hours per WhatsApp number, optional CPF, coupon with validity and minimum, funnel report               | gap                                        | —     |
| Coupon attribution          | Each redemption shows its source: link, WhatsApp campaign or ad                                                                                                   | gap                                        | —     |
| Meta Pixel                  | Listed with campaigns                                                                                                                                             | gap                                        | P-005 |

### 2.7 Finance, fiscal and stock

| Their feature               | What they state                                                                                                                                                                                                                                                                     | Venduá                                                                                                | ID    |
| --------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- | ----- |
| NFC-e                       | Through Focus NFe with the store's A1 certificate; homologation first; tax types (NCM, CFOP, CST/CSOSN, CEST) inherited by category and add-on; from the order or PDV; automatic after a 90-day simulation; offline contingency; cancel within 30 min; numbering gaps; XML in a ZIP | gap                                                                                                   | P-004 |
| Inbound NF-e from SEFAZ     | Supplier invoices arrive with items and installments; manifestation; XML upload; suppliers created from the CNPJ                                                                                                                                                                    | gap                                                                                                   | —     |
| Payables and receivables    | Sales posted by caixa close per payment method; Mercado Pago fees and driver payouts expensed automatically; 2–360 installments and recurrence; batch settle; CSV                                                                                                                   | gap; monthly Mercado Pago statement only (`src/admin/routes-payments.ts:364`)                         | —     |
| DRE                         | Accrual or cash basis, 26 default categories mapped to DRE lines, percent of revenue, internal movements kept apart                                                                                                                                                                 | gap                                                                                                   | —     |
| Suppliers and bank accounts | Supplier list with notes; the account each payment left from                                                                                                                                                                                                                        | gap                                                                                                   | —     |
| Ingredient stock            | Landed cost (freight, insurance, IPI, ICMS-ST), weighted average, received vs. invoiced, counts with reasons, daily history, minimum alert                                                                                                                                          | partial: finished-product stock drawn at checkout (`db/migrations/0051_commerce_completeness.sql:57`) | —     |

### 2.8 Multi-store

| Their feature           | What they state                                                                               | Venduá | ID  |
| ----------------------- | --------------------------------------------------------------------------------------------- | ------ | --- |
| Network dashboards      | Sales, caixa, payables and DRE per store and summed; the AI connector answers for the network | gap    | —   |
| HQ menu to branches     | Published with a preview; branch keeps availability and, if allowed, price                    | gap    | —   |
| Units and network roles | Create a unit with its CNPJ from the panel; network manager, finance and reader roles         | gap    | —   |

### 2.9 Platform, apps and go-to-market

| Their feature              | What they state                                                                                                          | Venduá                                                                  | ID    |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------- | ----- |
| Native manager app         | Android/iOS app with Lis, cancellation alerts and a 21h daily summary                                                    | partial: installable PWA with web push (`src/admin/webpush.ts`)         | —     |
| HR app                     | Time clock with selfie and geofence, NSR receipt (Portaria 671), adjustment requests; facial-verification terminal       | gap                                                                     | —     |
| WhatsApp per store         | Official Cloud API with coexistence, or a QR-code connection                                                             | gap: one platform number, used by our sales agent                       | P-017 |
| Asaas payments             | Pix, boleto and card; Stripe announced                                                                                   | gap; Mercado Pago only                                                  | —     |
| No-card free trial         | Self-serve; the store pauses when it ends, data kept                                                                     | gap: trials are a staff decision (`src/modules/integrations.ts:283`)    | —     |
| Help center                | Categorised articles, searchable by Lis                                                                                  | partial: per-screen how-tos (`apps/admin/src/features/help/topics.tsx`) | —     |
| Partner / reseller program | Recurring commission tiered by active stores, first-month bonus, partner portal with link and QR, 60-day lead protection | gap                                                                     | —     |

### 2.10 Where we match or lead

From what they publish; "not stated" doesn't mean they lack it.

- **Storefront design.** Templates and sections, page composition with history and restore, and
  design tokens (ADR 0018, `src/admin/routes-appearance.ts`). Their menu is one standard layout
  with the store's photos, prices and domain.
- **Delivery zones.** We have neighborhood, radius and polygon (`db/migrations/0066_delivery_polygons.sql`).
  Their help center lists "bairro ou raio".
- **Conversion analytics.** We have the funnel from visit to order, quote-to-order conversion per
  zone, and out-of-zone demand (`src/admin/routes-reports.ts`). They state none of these.
- **Not stated by them.** Encomendas (date-based preorders), per-product schedules and a waitlist
  for sold-out items.
- **At parity.** Coupons bound to a phone, coupon links (`?cupom=`), the live order-tracking page,
  and switching stores without a new login.
- **Agent runtime.** See §4.1.

## 3. Their merchant AI

### 3.1 Surfaces

| Surface                                  | Who uses it                                      | Reads                                                                                                                                                                                                 | Writes                                                                                                                                                                                                                                                                                                                                   | Where                                                                                                                   |
| ---------------------------------------- | ------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| "Gerenciar com IA" (MCP)                 | Owner or manager, in their own Claude or ChatGPT | Sales by channel and payment, top products, orders, menu, caixa, payables, DRE, fiscal, stock, customers and cashback, campaigns, deliveries, iFood reviews, the human-handoff queue, network numbers | Order status, cancel, reprint, pause the store and the WhatsApp bot; menu CRUD and reorder; caixa open/close/sangria; settle payables; import and manifest NF-e; stock entries and new ingredients; segments, templates and campaign sends; coupons and cashback; dispatch and settle drivers; reply to iFood reviews; place a PDV order | Remote MCP over HTTP (`mcp.dominio.tech/mcp`); a CLI with `doctor` and `connect`; "six skills"; a ChatGPT plugin (beta) |
| Lis copilot                              | Owner or manager                                 | Sales, orders, menu, stock, finance, invoices, customers                                                                                                                                              | Menu changes (pause, price) applied at once; expenses, sangria and suprimento after "orientada a confirmar"                                                                                                                                                                                                                              | Panel and the Domínio Gestão app; photo and PDF attachments; menu import from a URL (via Firecrawl)                     |
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
| Reach                    | Strong          | Claude, ChatGPT, panel, mobile app, WhatsApp, a ChatGPT shopper app                                                                                                                                            |
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
states a merchant MCP or a copilot over finance and fiscal. Still, it is an AI **interface** to an
ERP plus two vertical agents, not an AI **operator**. It answers and executes well. It doesn't
watch the store, notice a problem, propose a fix, act within a budget, and check whether it
worked.

## 4. Can we build a more powerful one?

Yes, on autonomy, quality and storefront growth. On breadth of ERP actions, only if we build the
ERP modules. That is the scope decision, not an AI decision.

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

What caps a merchant agent today:

- **No merchant tool surface.** There is no MCP, no API keys, and no tool definitions over
  `/admin/v1`.
- **No per-store WhatsApp.** Our WhatsApp channel is one platform number on an unofficial client
  (`src/agent/channels/whatsapp.ts`), and inbound audio arrives only as the tag `[áudio]`.
- **One order channel.** No `source` on orders and no marketplace intake.
- **Events nobody consumes.** Order transitions are written to `outbox` (`src/modules/orders.ts:274`)
  but nothing reads them, so shoppers get no status messages.
- **No back-office data.** No finance, caixa, fiscal or ingredient stock.

### 4.2 What "more powerful" should mean

Six properties. Domínio has the first one and half of the fifth:

1. **Access parity where it's cheap.** MCP in Claude and ChatGPT, and a copilot in the admin.
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

**A. One tool registry over `/admin/v1` (the foundation).** Each tool declares:

- a name and a bounded input schema;
- a class: `read`, `write`, `money` or `irreversible`;
- a minimum role (`owner | manager | attendant`, `src/admin/context.ts:8`);
- a `preview()` that returns the diff;
- an executor that calls the module function the route already uses.

The ~60 existing routes (orders, catalog, store, hours, zones, appearance, marketing, customers,
reports, payments, team) are the first catalog. Every call writes `audit_log` with an actor such
as `ai:mcp` or `ai:copilot`.

**B. Surfaces on that registry.**

- **B1. Remote MCP server.** OAuth 2.1 on the merchant identity from ADR 0020. Read scope by
  default, write scope opt-in, one tenant per grant, and a revocation screen in the admin. This is
  parity with their connector.
- **B2. Built-in copilot** in the admin and the PWA, as a `store_copilot` job. The merchant needs
  no Claude or ChatGPT plan. Accept voice input; Lis blocks the microphone.

**C. A proactive store operator (where we pull ahead).**

- **C1. Watch routines per store** on the existing scheduler. Each finding becomes a proposal with
  one-tap approval from a push notification. Signals:
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
- **D6. Agentic shopping.** Expose `/storefront/v1` search, menu and cart as a shopper MCP app
  for ChatGPT and Claude, with checkout on our web. This matches their ChatGPT app.

**E. A quality moat.**

- Extend `bun run sim` with merchant personas and store fixtures. Scenarios: data questions,
  risky requests, and prompt injection through a shopper message or a review.
- Judge grounding, safety and outcome.
- Add scripted-provider tests in CI for every write tool.

### 4.4 Scorecard: theirs today and ours after A–E

| Dimension                | Domínio today   | Venduá today           | Venduá after A–E                                   |
| ------------------------ | --------------- | ---------------------- | -------------------------------------------------- |
| Breadth of actions       | Very strong     | None (merchant side)   | Medium; storefront only unless ERP modules come    |
| Reach                    | Strong          | None                   | Strong (MCP, admin, PWA, WhatsApp, Instagram, web) |
| Write safety             | Strong / medium | n/a                    | Strong: role, preview, budgets and audit in code   |
| Grounding                | Strong          | Prompt-level (sales)   | Strong: amounts checked against Core               |
| Proactivity and autonomy | Weak            | Strong (leads only)    | Strong: watch, review, act within budgets          |
| Closed loop and memory   | Weak–medium     | Strong (leads only)    | Strong: per-store memory and outcome checks        |
| Quality loop             | Medium          | Strong (sim and judge) | Strong                                             |
| Shopper side             | Strong          | None                   | Strong on channels; parity on ordering             |

### 4.5 Out of reach without new modules

Their AI answers "how did the month close", "count the caixa", "issue the NFC-e", "what is the
CMV of this burger", "how much do I owe each driver" and "which channel pays best". Each needs a
module we don't have. A merchant who runs the whole restaurant on Domínio will find our agent
narrower, however autonomous it is.

### 4.6 Decisions for the owner

1. **Scope.** A storefront-and-growth agent, or a restaurant ERP (dine-in, PDV, caixa, finance)
   to put it on? This is the same open question as P-015, P-016 and P-023.
2. **How AI is charged.** Bring-your-own model through MCP (no inference cost to us), built-in
   and metered, or included. No prices here.
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

1. Write an ADR for the merchant tool registry and the MCP server (A, B1): auth, scopes, tool
   classes, audit actor.
2. Ship read-only tools first (reports, orders, catalog, customers) behind MCP, to a few pilot
   merchants on Claude.
3. Add write tools with preview and confirm, then the built-in copilot (B2).
4. Add the watch routines and the weekly review (C1, C2) on the existing scheduler, proposals
   only, with no autonomous writes yet.
5. Turn the P-017 shopper agent into a design, with money grounding in code (D1, D2).
6. Add merchant-agent sim scenarios (E) before any autopilot.

## Sources and caveats

All pages were rendered with headless Chromium on 2026-10-01; the site is a client-rendered app,
so plain fetches return only the title.

- **Pages read:** `https://dominio.tech/`, `/gerenciar-com-ia` (including the CLI, Skills &
  Plugin and ChatGPT tabs), `/produtos` and its 25 product pages, `/precos`, `/funcionalidades`,
  `/integracoes`, `/delivery-whatsapp-ia`, `/cardapio-digital`, `/entrega-propria`, `/raio-x`,
  `/aplicativos` (= `programas.dominio.tech`), `/base-de-conhecimento`, `/seja-parceiro`,
  `/cozinha-demo`, `/llms.txt` and `/sitemap.xml`.
- **Privacy texts:** `/politica-privacidade` (v2.1, 2026-09-23: §3.5 ChatGPT app, §3.6 AI
  providers, §18 HR app, §19 manager app) and `/privacidade-app-gestao` §5–6 (Lis).

Caveats:

- Everything is marketing, FAQ or policy text. None of it was verified inside the product, since
  no account was created.
- The MCP tool catalog was not inspected. "100+ actions" is their count; the write list in §3.1
  is assembled from their examples. A public npm CLI (`@dominio-tech/cli`) and a GitHub repo
  (`dominiofast/dominio-agent-skills`, "CLI, plugin e seis skills") exist but were not read.
- "Breve" integrations are announcements.
- Prices, plan quotas and partner commission rates are left out, per [README](README.md).
- Venduá status was checked in code on 2026-10-01 (Core, admin, kernel).

## Change log

- 2026-10-01: first pass. Full site, AI surfaces, gap list against Venduá's code, and a
  merchant-agent proposal.
