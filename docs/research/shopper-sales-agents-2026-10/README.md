# Competitive research: an AI sales agent for each Venduá store (WhatsApp + web chat)

Researched 2026-10-02. Web access worked (WebSearch + WebFetch). Reclame Aqui pages return HTTP 403 to
WebFetch, so every Reclame Aqui statement below comes from search-result snippets and is tagged [RA-snippet].
Nothing here was verified inside a product; "Y" means a vendor or press source states it.

## 0. How to read this file

Evidence tags:

- [V] vendor's own page, fetched today (marketing claim, not verified)
- [N] news / trade press (MobileTime, Canaltech, Exame, E-Commerce Brasil...)
- [T] third-party blog or comparison. Many are written by competitors or agencies, so treat as weak
- [RA-snippet] Reclame Aqui result snippet only
- [Repo] already in `docs/features/whatsapp-bot.md`, `docs/competitor-parity.md` or `docs/competitors/*.md`
- [K] my own background knowledge, not checked today (flagged where it matters)

Table symbols: Y = stated by vendor/press; N = stated absent or the stated flow shows it is absent; V = vague
or partial; ? = not stated; L = sends a link or hands off to another surface.

## 1. What the repo already had (not redone)

- `whatsapp-bot.md`: capability table for Anota AI, Goomer, Cardápio Web, OlaClick, Delivery Direto, Takeat,
  Instadelivery; Ailo (iFood) noted; Meta constraints (24 h window, opt-in, 30 products per message, no native
  modifiers, Pix `order_details`, coexistence limits, per-message charges from 2026-10-01, unofficial-client
  ban risk). Venduá transport decision: unofficial client per store on `wa-gateway` (ADR 0026).
- `competitor-parity.md`: P-017 (shopper bot, P1), P-018 (broadcasts), P-001 (abandoned cart).
- `competitors/dominio-tech.md`: the deepest benchmark. Their WhatsApp "Vendedor" takes the whole order, charges
  Pix (10 min, Mercado Pago), blocks any price with no source in the system, handoff queue with "Assumir" and
  20 min bot silence, one recovery nudge, WhatsApp-only (no web chat), top single-store tier only. Their weakness
  by the repo's own rating: proactivity and autonomy "weak", no stated eval harness.
- Repo already has: autonomy levels `off|copilot|supervised|autopilot`, wakeups, per-entity memory, cost caps,
  LLM-persona sim harness (for the lead-selling agent, not stores) [Repo]. No allergen field anywhere in
  `packages/core`, `packages/templates` or `docs` (grep, 2026-10-02).

What is new in this pass (not in the repo): Brendi's and Nuvem Chat's details, Goomer 2.0 and Saipos Bot
pricing, iFood Ailo's July 2026 update (Pix end to end, memory, autonomy), Meta Business Agent launch and token
pricing, Meta's 1 Oct 2026 pricing change in numbers, CADE/Brazil chatbot-ban status, the agentic-commerce
protocol status (OpenAI retreat), and all global benchmarks.

## 2. Findings by competitor

### 2.1 Brazil, food and delivery

**Anota AI** (owned by iFood since 2022 per [T]; not verified from a primary page)

- Does: "automatiza todo o atendimento no WhatsApp, do primeiro 'oi', passando pelo envio do cardápio digital,
  até o pedido ir para a cozinha"; understands text and audio; sends menu even when asked by audio; status
  updates; post-purchase feedback survey; strategic promotions; WhatsApp, Instagram and Facebook Messenger.
  Human oversight: notifies the store when a customer asks for a person; store can take over any time; can be
  paused. [V] anota.ai/home/funcionalidade/atendente-virtual/
- Not stated on that page: Pix or any payment in chat, analytics, learning, price. FAQ says "support for PIX
  payments and digital wallets" and abandoned-cart recovery (ambiguous: platform or bot). [V] anota.ai/blog/faq-anota-ai/
- Price: bot is bundled in platform plans. Third-party figures conflict (R$ 219,99 / 254,99 / 329,99 vs
  R$ 299,99 / 399,99; "from R$ 99,99" on the vendor FAQ for up to 150 orders). Treat as unknown. [T]
- Complaints [RA-snippet]: 6.0/10 and 752-780 complaints on Reclame Aqui. Titles include "Robô de WhatsApp com
  respostas cínicas e suporte falho causa banimento da empresa" (robot kept sending photos/promotions after the
  merchant removed them; WhatsApp number banned), "banimento do whatsapp" (company reply: system respects WhatsApp
  ToS, advises a number be used 2 weeks / 50 conversations before installing), "Problemas com o robô de
  atendimento" (robot failed to send order summaries and "ready" notices), "contato com nossos clientes através do
  nosso WhatsApp sem nossa autorização", R$ 0,99 convenience fee charged to shoppers without notice, about 17%
  price rise with a feature removed, bot configured only for delivery so dine-in shoppers get wrong answers.
  Source list in section 5.

**Goomer, Atendente Virtual 2.0**

- Does: generative AI with an in-house LLM orchestrator and "guardrails to avoid hallucinations", focused on
  delivery orders; labels and classifies customers into the restaurant CRM; orders go to the kitchen manager or
  through the POS (80+ POS integrations); Pix or a credit-card link inside the WhatsApp chat; each store uses its
  own number; conversations tracked in an online dashboard; built almost self-service from a form. Built
  in-house rather than on official APIs (MobileTime wording). v1 (2021) was keyword rules. [N] mobiletime.com.br
  27/07/2026. Goomer expects at least 25% of ~10,000 stores to adopt within a year.
- Price: R$ 199/month for v2.0 [N]. Plans page: Automatizar R$ 184,90/month (R$ 138,68 annual) includes "atendente
  virtual (chatbot)", Integrar R$ 299,90, Free = 30 orders then R$ 1,39 per extra order. [V] goomer.com.br/planos
- Install doc (older bot): a Windows desktop app that drives WhatsApp Web in an incognito tab; needs a paid plan.
  [V] ajuda.goomer.com.br
- Complaints [RA-snippet]: "Atendente Virtual Não Está Funcionando" (a pending WhatsApp update on the PC broke
  the integration), no human support, no reply on any channel.

**Cardápio Web (Cardapinho)**

- Does: "understands the customer's intention, answers questions and closes orders"; identifies customers who did
  not finish a purchase and nudges them; status notifications by WhatsApp; if it cannot understand, offers a
  human. [V] cardapioweb.com/chatbot/
- Transport: WhatsApp Web through a Chrome extension; the computer must stay on and the tab open. No audio or Pix
  mentioned in the help page. [V] ajuda.cardapioweb.com/automacao/chatbot-cardapinho
- Complaints [RA-snippet]: 8.7/10, 131 complaints. "Chatbox não funciona e falta de suporte" (feature in the plan
  but not activated).

**OlaClick**

- Does: WhatsApp chatbot that "serves customers, receives orders and sends confirmations 24 h", "uses AI and
  Meta's official API" (claim); AI menu suggestions to raise ticket value; sales activation and promotion
  messages; payment links and payment details sent automatically; claims "up to 40% more orders", "99% response
  rate" (no method). Handoff not stated on the page fetched. [V] olaclick.com/en/whatsapp-robot-with-artificial-intelligence/,
  olaclick.com/ia-para-restaurantes/
- Price: free tier; paid plan pricing on pricing.olaclick.app (not retrieved).
- Complaints [RA-snippet]: 9.0/10, 89 complaints, 97.8% answered. "Problema no Chatbot" (robot stopped three weeks
  after purchase), "propaganda enganosa" (menu blocked after 40 orders on the limited plan), stale menu prices
  causing losses.

**Brendi ("Brenda")**

- Does: orders taken directly on WhatsApp; understands "áudios, imagens e até figurinhas"; adapts to the store's
  tone; "aprende continuamente com cada interação" (claim); human takeover; real-time performance dashboard;
  returns feedback 1-1.5 h after delivery; recognises returning customers; sets up in up to 24 h by importing
  from iFood; WhatsApp Business API; printer integration; cross-sell inside the digital menu. 8,500+ stores, 15-day trial.
  [V] brendi.com.br/atendimento-virtual; [V, vendor blog] brendi.com.br/blog/ia-conversacional-whatsapp/
- Not stated: Pix in chat (blog says "Pix e cartão" without mechanics), proactive recovery.
- Price: "plano único" whose monthly fee grows with the store's revenue; no cancellation penalty [V].
- Complaints [RA-snippet]: 8.5/10, 26 complaints (company registered ~1 year). Support "inexistente" weekly bugs,
  "pagamento online forçado" (merchant), poor image quality.

**Takeat ("Teka")**

- Does: WhatsApp AI that "receives orders directly from the customer", confirms, updates each stage with
  prep/delivery times, and triggers cashback campaigns for inactive customers; runs on the same panel as PDV,
  menu, finance and CRM (no integration). [V via search summary] takeat.app/solucoes, lp.takeat.app
- Not stated: audio, Pix, handoff, price.

**Saipos Bot**

- Does: AI that "compreende textos e áudios", takes orders and sends them to the KDS, suggests items from context,
  answers from the store's database only (menu, prices, hours), notifies the store when it cannot understand,
  status updates. [V] saipos.com/sistema/saipos-bot
- Price: R$ 89,90/month for the marketplace/Saipos-account integration (existing Saipos customers get discounts).
  [V via fetch summary]. Pix in chat not stated.

**Consumer (+ MenuDino)**

- Does: ChatGPT-based answers ("do you accept Pix?"), sends the MenuDino link, orders print at the kitchen,
  status messages, hands complex cases to a human (claims ~80% of messages are routine). New generative AI that
  transcribes and understands audio orders against the registered menu, with human intervention possible.
  Order itself is link-led. [V] consumer.com.br/bot-whatsapp; [N] radardigitalbrasilia.com.br (Consumer audio AI)
- Price: free tier up to 30 orders; paid plans with unlimited orders [V].

**Delivery Direto**

- Does: WhatsApp bot + "Recuperador de Pedidos". Per [Repo]: sends the store link rather than taking the order;
  15-minute nudge with coupon. Price R$ 99,90/month for bot + recoverer; other modules R$ 9,90-19,90 [T, search
  snippet of the vendor site].

**iFood Ailo (shopper-side agent, competes for the same shopper)**

- Launched Oct 2025 as WhatsApp agent; 500k+ users by Dec 2025; in the pilot, orders were "48% more likely to
  reach the cart and 33% faster". [N] tiinside.com.br 17/12/2025
- July 2026 update: "one-click buy" from history ("quero meu hambúrguer favorito"), long-term memory of
  preferences and dietary restrictions, autonomous actions (auto-applies the best coupon), complex multi-dish
  requests, text or audio, Pix end to end inside WhatsApp, cards still in test (card users are sent to the app).
  Built on a "hybrid architecture", moving from scripted flows to skill-based decisions. [N] portal.clientesa.com.br,
  otempo.com.br 16/07/2026, gironews.com
- Implication: for shoppers who already use iFood, the best food agent in Brazil lives in iFood's number and
  knows their history across stores. A store's agent cannot win on discovery. It can win on price (no commission),
  the direct relationship, and the store's own data.

**Domínio Tech** [Repo]: see `docs/competitors/dominio-tech.md` (not re-fetched).

**Zaia, Menu Dino**: Zaia is a horizontal no-code "Agentic OS" for AI employees (WhatsApp Official, Instagram, widget,
native CRM with human handoff, 60+ MCP integrations; from R$ 150/month console, R$ 249-990 plans in [T]). It
is a build-your-own tool, not a food product [V] zaia.app. MenuDino is a free menu/site builder (20k+ restaurants)
whose WhatsApp bot is the Consumer bot above [T].

### 2.2 Brazil, e-commerce and WhatsApp-commerce platforms

**Nuvem Chat (Nuvemshop)** is the closest like-for-like of a platform-native shopper agent.

- Does: WhatsApp and Instagram (online store "coming soon"); handles "texto, áudio ou imagem" (can interpret an
  image to identify an item and suggest alternatives); builds the cart and creates the order "sem sair da
  conversa"; recommends products and promotions; identifies when a human is needed and stops answering when the
  merchant takes over; improves over time; official WhatsApp Business API; stats in "Chat > Estatísticas" and
  costs in "Chat > Custos". Claims: "76% of conversations resolved 100% by the AI", "1 in 4 online carts starts in
  an AI chat", 10.7x ROI (one case). [V] nuvemshop.com.br/solucoes/nuvem-chat; atendimento.nuvemshop.com.br FAQ
- Payments, precisely: press says "first e-commerce platform to pay without leaving WhatsApp" (Sep 2025 with
  Meta). The help center says one-click works only for authenticated customers with a saved card and accelerated
  checkout, credit card paid in full (1x); "no Pix or boleto yet": those use a payment link to checkout. After
  payment WhatsApp shows "Payment approved". [N] exame.com; [V] atendimento.nuvemshop.com.br payment-methods article
- Price: per conversation, by Nuvemshop plan: Começo R$ 1,50, Essencial R$ 1,20, Impulso R$ 0,95, Escala R$ 0,80,
  Next R$ 0,70; monthly billing; 15-day trial. [V]
- Meta link: Nuvemshop is Meta's only LatAm e-commerce partner for Business AI (June 2026). Also Lumi, with
  Claude and OpenAI connectors (MCP) for merchant-side store management. [N] itforum.com.br, centraldovarejo.com.br
- Complaints [RA-snippet]: "Nuvem Chat não funciona, induz ao erro e propaganda enganosa"; auto and manual mode
  not working while paying R$ 1,20 per conversation; message shows sent/seen in the panel but never reached
  WhatsApp.

**Weni by VTEX** (VTEX acquired Weni): AI agent that answers, applies promotions, builds the cart and takes
payment in chat with Pix, credit or debit; native WhatsApp cart recovery; catalog sync. Case: Carajás Home Center
tripled interactions. [T, agency page summarising vendor claims] agenciaeplus.com.br; vtex.com/en-us/solutions/business-needs/whatsapp-store

**Blip (ex-Take Blip)**: enterprise conversational platform: AI + multi-agent inbox (Blip Desk) + catalog and payment;
Pix via Open Finance with Efí (customer taps the button and lands in their bank app pre-filled); claims 50%+
conversion increase, 70% of interactions automated. "Super" plan from R$ 7.292/month (50 agents, 5,000
conversations). Not an SMB product. [V] digital.blip.ai/whatsapp/chatbot; [T] sejaefi.com.br

**Zenvia**: one of six global pilot partners of Meta Business Agent; claims "purchase, payment and post-sale 100%
on WhatsApp, no redirect", proactive qualification, native handoff with full history, unified customer cloud.
Le Creuset: 25.6% conversion from messages sent to conversations started (a reply rate, not a sales rate). [V]
zenvia.com/whatsapp/meta-agents/. Zenvia also states third-party AI chatbots have been billed at US$ 0,0625 per
message since 11 Mar 2026 (see 3.4).

**Botmaker**: AI agents that check stock, compute shipping, apply coupons and go to checkout, with Pix as the main
method (a Brazil-only feature), plus payment link and boleto; inbound/outbound voice and WhatsApp agents; hybrid
AI + human; 20+ channels. [N] uai.com.br/jornaldobras 2025; centraldovarejo.com.br

**Octadesk, Leadster**: chatbot + inbox + lead qualification. Octadesk from ~R$ 210/month, Leadster from ~R$ 187
[T]. Not order-taking or checkout products.

**Yampi, Tray, Loja Integrada**: no first-party shopper chat agent found. Yampi's app store carries AgentShop
(WhatsApp catalog, cart, payment, orders) and Reportana (cart recovery) from third parties. Tray points to partners
and an implementation service. Loja Integrada's Komea is a merchant copilot (agents that register products, make
promotions, analyse performance), generally available from Jan 2026, not a shopper agent. [N] mobiletime
(Komea), [T] yampi apps pages

### 2.3 Global benchmarks

**Meta Business Agent / Business AI** (the platform owner, and the default alternative)

- Announced globally 3 Jun 2026; in Brazil for SMBs since ~24 Feb 2026 (testing in Brazil, India, Mexico; 1M+
  businesses in the pilot). Answers questions, recommends catalog products, books appointments, qualifies
  leads, "closes sales", across WhatsApp, Instagram, Messenger; merchants set rules for what it may and may not do and when a human steps
  in; Agent Platform connects to hundreds of third-party systems (Shopify, Zendesk named). [N] mobiletime.com.br
  03/03/2026; ppc.land
- Price: free at launch; billed by tokens from 1 Aug 2026 at US$ 2,00 per 1M tokens, "typically 4-5 US cents per
  message" (Meta developer page + [T]); small businesses via WhatsApp Business Premium subscription tiers (Meta
  statement, tiers not yet priced). [V] developers.facebook.com non-template-messages page
- Weakness: generic; no modifiers, delivery zones, kitchen printing, Pix reconciliation of its own; merchants are
  told to review its replies regularly. Positions Meta's AI as the one first-party option on WhatsApp.

**Shopify**: Sidekick (merchant copilot; Pulse proactively surfaces up to 5 recommendations; keeps working in the
background; builds Flow automations from plain language). Shopify Inbox with Magic AI replies; Shop-app AI
assistant; Agentic Storefronts across ChatGPT, Copilot, Gemini, Perplexity; Shopify-built UCP; Copilot Checkout
with Shop Pay; WhatsApp marketing campaigns. Not in Brazil: Shopify Payments; Pix needs a gateway [Repo].
[V] shopify.com/editions/spring2026; changelog.shopify.com

**Klarna**: 2024 headline: AI assistant did the work of ~700 agents, 2.3M conversations in its first month, resolution
11 min to under 2. In 2025 its CEO reversed: hire human agents so customers "always have the option to speak to
a real person", citing lower quality in AI-only support. Best-known case of over-automation. [T] fortune.com,
techcrunch.com 2025

**Intercom Fin**: US$ 0,99 per outcome (outcome counts when the customer confirms, does not ask again, or a
Procedure completes, handoffs included); claims 76% average resolution across 12,000+ customers, improving about 1%
a month; Procedures that read and write third-party systems; simulations, regression tests, Insights/QA with
one-click fixes; voice; WhatsApp is usage-priced on top. Complaints: unpredictable monthly bills; "assumed
resolution" billing when a customer goes quiet; multi-week knowledge-base cleanup before it performs. [V] fin.ai,
intercom.com/pricing; [T] G2 summaries

**Gorgias AI Agent**: US$ 0,90 per automated interaction on annual (US$ 1,00 monthly); included interactions by
plan (30 / 30 / 190 / 530); every automated interaction also counts as a helpdesk ticket (double billing);
shopping-assistant mode (bundles, discount codes at high intent), actions like returns and order tracking. [V]
gorgias.com/pricing; [T] ringly, eesel

**Rep AI**: Shopify sales + support agent; proactive on exit intent (vendor claim "92% accuracy"); summary before
handoff; free to US$ 368/month by visitor volume; 4.6/5 from 117 reviews; case: 12.7% of store revenue, US$ 84
per US$ 1. [V] apps.shopify.com/rep-ai-sales-associate, hellorep.ai (vendor-authored comparison).

**Zipchat**: web + WhatsApp + Instagram + email; acts (returns, refunds, loyalty checks, order tracking); claims
16.4% chat-to-sale conversion vs 2-3% on site and under 3.2% escalation; revenue attribution shown per customer
(US$ 1,45M+ case). [V] zipchat.ai (claims unverified)

**Manifest AI (by BIK)**: ChatGPT-based Shopify chatbot, 4.6/5 from 60 reviews [T].

**Tidio Lyro**: from US$ 32,50 for 50 AI conversations, about US$ 0,50 per extra AI conversation; WhatsApp,
Messenger, Instagram; strict knowledge-base grounding with auto-escalation. Complaints: three independent meters,
bills doubled overnight without notice, auto-renewal cancellation friction; Trustpilot 3.8/5 vs Capterra 4.7/5. [V]
tidio.com/pricing; [T] reviews

**Sierra, Decagon**: enterprise. Sierra: outcome-based pricing, channels include WhatsApp, voice and ChatGPT; Ghostwriter
builds agents from SOPs; Monitors, Experiments, supervisors, observability into reasoning. Third-party estimates
~US$ 1,50 per resolved interaction and US$ 150k+ contracts. Decagon: Agent Operating Procedures in natural language,
Watchtower QA, simulation, voice/chat/email; Vendr median contract ~US$ 433k/year. [V] sierra.ai, decagon.ai; [T] pricing
estimates. Relevant as the ceiling for QA/eval tooling, not as competitors for a food merchant.

**Wix**: AI Site Chat answers from site content, "make purchases" in chat (no detail), web only, no WhatsApp; replaced on
new sites by Wix Smart Chat from Mar 2026 (AI answers + live chat you answer yourself). [V] support.wix.com

### 2.4 Agentic checkout protocols (shopper-side agents buying from merchants)

- **ACP** (OpenAI + Stripe, Sept 2025): Instant Checkout. By Feb 2026 about 30 Shopify merchants were live
  (Forrester analyst quoted); Walmart saw ChatGPT checkout convert at one-third of its site; OpenAI retired Instant Checkout
  in March 2026 and moved to discovery in ChatGPT with checkout on the merchant's site or merchant apps. [T]
  hypotenuse.ai, digitalapplied.com, stellagent.ai
- **UCP** (Google + Shopify, 11 Jan 2026): discovery, carts, checkout, post-purchase; Tech Council joined by Amazon,
  Meta, Microsoft, Salesforce, Stripe on 24 Apr 2026. **AP2** (Google + payment networks), **MCP** (Anthropic), **A2A**,
  Visa TAP complete the stack. [T] kenhuangus.substack.com, paz.ai
- **Brazil**: Pix is 44% of online checkouts in 2026 [T]; first agentic card transaction by Banco do Brasil + Visa; Iniciador
  launched an MCP for agentic Pix initiation with biometric approval per transaction [N]. Nuvemshop frames merchants'
  job as clean, structured, real-time catalog data (not in images or PDFs) and offers MCP connectors for the merchant
  side. [V] nuvemshop.com.br/blog/agentic-commerce
- **Relevance**: low for a food store in 2026 (shoppers in Brazil are reaching the store via WhatsApp, iFood and Instagram,
  not ChatGPT checkout), and OpenAI's retreat lowers urgency. Owner decision on record (dominio-tech.md, 2026-10-01): no
  ChatGPT, Claude or MCP integration for merchants or shoppers. A watch-list item only: keep menu data
  machine-readable, which is not an integration.

## 3. Synthesis

### 3.1 (a) Capabilities by competitor

Rows are what each stated. "?" is not evidence of absence. Price column is as stated by the vendor or press.

**Brazil food**

| Capability                      | Anota AI   | Goomer 2.0       | Cardápio Web | OlaClick             | Brendi            | Takeat Teka  | Saipos Bot  | Consumer       | Delivery Direto | iFood Ailo              | Domínio Tech [Repo]                |
| ------------------------------- | ---------- | ---------------- | ------------ | -------------------- | ----------------- | ------------ | ----------- | -------------- | --------------- | ----------------------- | ---------------------------------- |
| Takes the full order in chat    | Y          | Y                | Y            | Y                    | Y                 | Y            | Y           | L (link)       | L (link)        | Y                       | Y                                  |
| Pix inside the chat             | V          | Y                | ?            | V (link)             | V                 | ?            | ?           | V (link)       | L               | Y (Jul 26)              | Y (copia-e-cola)                   |
| Card in chat                    | ?          | Y (link)         | ?            | ?                    | V                 | ?            | ?           | ?              | L               | N (app)                 | ?                                  |
| Voice-note input                | Y          | ?                | ?            | ?                    | Y                 | ?            | Y           | Y              | ?               | Y                       | Y                                  |
| Voice replies                   | ?          | ?                | ?            | ?                    | ?                 | ?            | ?           | ?              | ?               | ?                       | Y                                  |
| Photo/sticker input             | ?          | ?                | ?            | ?                    | Y                 | ?            | ?           | ?              | ?               | ?                       | Y (3 photos)                       |
| Upsell / recommendations        | V          | ?                | ?            | Y                    | V                 | ?            | Y           | ?              | ?               | Y                       | ?                                  |
| Proactive / recovery            | V          | V                | Y            | V                    | V                 | Y (cashback) | ?           | V              | Y (15 min)      | ?                       | Y (1 nudge)                        |
| Human handoff                   | Y          | Y [Repo]         | Y            | ?                    | Y                 | ?            | Y           | Y              | ?               | n/a                     | Y (queue, 20 min)                  |
| Multi-attendant inbox           | ?          | V                | ?            | ?                    | V                 | ?            | ?           | ?              | ?               | n/a                     | Y (queue)                          |
| Learns from merchant edits      | ?          | ?                | ?            | ?                    | V (claim: learns) | ?            | ?           | ?              | ?               | Y (memory, per shopper) | V (thumbs, learned supplier links) |
| Revenue analytics / attribution | V          | V                | ?            | ?                    | Y (dashboard)     | ?            | ?           | ?              | ?               | ?                       | V                                  |
| Prices grounded in system       | ?          | V (guardrails)   | ?            | ?                    | ?                 | ?            | V (db only) | ?              | ?               | ?                       | Y (stated)                         |
| Official WhatsApp API           | ?          | N (in-house)     | N (Web ext.) | Y                    | Y                 | ?            | ?           | ?              | Y               | n/a (iFood)             | Y or QR                            |
| Web-chat channel                | ? (IG, FB) | ?                | ?            | V (chat on web menu) | ?                 | ?            | ?           | ?              | ?               | n/a                     | N (stated)                         |
| Price stated                    | in plan    | R$ 184,90-199/mo | ?            | free + ?             | % of revenue      | ?            | R$ 89,90/mo | free 30 orders | R$ 99,90/mo     | free to shopper         | top tier only                      |

**Brazil commerce / WhatsApp platforms**

| Capability                 | Nuvem Chat                         | Weni (VTEX) | Blip             | Zenvia    | Botmaker    | Meta Business Agent                          |
| -------------------------- | ---------------------------------- | ----------- | ---------------- | --------- | ----------- | -------------------------------------------- |
| Takes order / builds cart  | Y                                  | Y           | Y                | Y         | Y           | Y (catalog, "closes sales")                  |
| Pix inside the chat        | N (link; help center)              | Y           | Y (Open Finance) | Y (claim) | Y           | V (Pix template, partner case)               |
| Card in chat               | Y (1-click, 1x)                    | Y           | ?                | ?         | V (link)    | ?                                            |
| Voice-note input           | Y                                  | ?           | ?                | ?         | ?           | ?                                            |
| Image input                | Y                                  | ?           | ?                | ?         | ?           | ?                                            |
| Upsell                     | Y                                  | ?           | ?                | ?         | ?           | V (recommends)                               |
| Proactive / recovery       | ?                                  | Y (cart)    | ?                | Y         | ?           | V (qualify leads)                            |
| Human handoff              | Y (AI stops)                       | ?           | Y                | Y         | Y           | Y (merchant-defined)                         |
| Multi-attendant inbox      | ?                                  | ?           | Y                | Y         | ?           | V (WA Business app)                          |
| Learns from merchant edits | V ("improves")                     | ?           | ?                | ?         | ?           | ?                                            |
| Revenue analytics          | Y (stats, cost; vendor ROI claims) | ?           | Y                | Y         | ?           | ?                                            |
| Official API               | Y                                  | Y           | Y                | Y         | Y           | native                                       |
| Web-chat channel           | N (soon)                           | ?           | ?                | ?         | Y (webchat) | N (WA, IG, Messenger)                        |
| Price stated               | R$ 0,70-1,50 per conversation      | ?           | from R$ 7.292/mo | ?         | ?           | tokens, US$ 2/1M (~4-5 US cents per message) |

**Global**

| Capability                      | Fin                      | Gorgias                                 | Rep AI                 | Zipchat                 | Tidio Lyro       | Sierra / Decagon                | Shopify                                       | Klarna              |
| ------------------------------- | ------------------------ | --------------------------------------- | ---------------------- | ----------------------- | ---------------- | ------------------------------- | --------------------------------------------- | ------------------- |
| Takes order / checkout in chat  | V (sales mode)           | V                                       | V (guides to checkout) | Y (checkout assistance) | V                | V (outcomes incl. transactions) | Y (agentic checkout, Copilot)                 | N                   |
| WhatsApp                        | Y (usage-priced)         | ?                                       | ?                      | Y                       | Y                | Y (Sierra)                      | V (marketing campaigns)                       | ?                   |
| Voice notes / voice calls       | Y (voice agent)          | ?                                       | ?                      | Y (chat voice)          | ?                | Y                               | ?                                             | ?                   |
| Proactive outreach              | V                        | V (discount at intent)                  | Y (exit intent)        | Y                       | V                | Y (Sierra Horizon)              | Y (Sidekick Pulse, merchant side)             | n/a                 |
| Human handoff with summary      | Y                        | Y                                       | Y                      | Y (<3.2%)               | Y                | Y                               | V                                             | Y (restored humans) |
| Learns / improves loop          | Y (flywheel, 1% a month) | ?                                       | Y (brand training)     | ?                       | V                | Y (Ghostwriter, Monitors)       | ?                                             | ?                   |
| Simulation / regression testing | Y                        | ?                                       | ?                      | ?                       | ?                | Y                               | ?                                             | ?                   |
| Revenue attribution             | V                        | V                                       | Y (12.7% case)         | Y (per customer)        | V                | Y (Decagon US$ 1M case)         | V (AI-attributed orders 11x Jan 25 to Mar 26) | n/a                 |
| Pricing model                   | US$ 0,99 per outcome     | US$ 0,90-1,00 per automated interaction | by visitors            | ?                       | per conversation | per outcome / conversation      | included                                      | n/a                 |

Footnote on honesty of the table: where the repo's own tables conflict with a fresh fetch, I followed the fresh
fetch and labelled it (for example Goomer's "own number, no official API" and Nuvem Chat's "no Pix one-click").

### 3.2 (b) The 12 most common complaints about these bots

Shopper-side evidence is thin for Brazilian food bots specifically (no public shopper review corpus found; Reclame
Aqui complaints are overwhelmingly merchants). Items 1-6 are shopper experience, from Brazilian surveys, vendor
failure-mode guidance and global cases; 7-12 are merchant experience and are better evidenced.

1. **Cannot reach a human, or the bot loops.** In Brazilian surveys 73,2% (Locaweb) to 79% (SurveyMonkey 2026) prefer a
   person, 44% are frustrated by being unable to leave the bot, 74% want a human as soon as it is a complaint. Klarna reversed
   AI-only support. [T] consumidormoderno.com.br, exame.com/bussola. Lei do SAC (Decreto 11.034) bars blocking the human
   path but applies only to regulated sectors (telecom, banks, energy, health plans), so it does not bind a restaurant
   directly. [T] [K]: the CDC's duty of clear information still frames it.
2. **Does not understand: rigid "digite 1, 2 ou 3" menus, no audio, off-script messages stall.** Repeated by every
   vendor guide as the thing the "new" AI fixes; the new generative bots have the opposite failure (3).
3. **Invents facts: prices, promotions, stock, ingredients, allergens.** Air Canada was held liable for its chatbot's
   invented refund policy (tribunal: the bot is not a separate legal entity). A developer note in our search
   results tested an allergy question the same day (1 Oct 2026) and concluded the agent may only answer from structured
   menu data, else escalate. Hallucination rates cited at 3-27% [T]. Under Brazilian law an offer made by the supplier binds it
   (CDC art. 30) [K, not verified today], so a quoted price is a cost to the store.
4. **Gets the order wrong:** forgotten items, ignored modifiers, incomplete address, wrong flavour. The standard vendor rule is
   "always send the summary and address for confirmation". [T] sisfood.com.br, brendi blog
5. **Pays elsewhere.** Ailo sent card payers to the iFood app; Nuvem Chat's Pix goes to a checkout link; Delivery Direto and
   Consumer send a link. Every redirect is a drop-off point.
6. **Tone and noise.** "Respostas cínicas" (Anota AI complaint); 59% of WhatsApp users dislike generic automated answers
   (Intelligenzia, via search); the bot keeps replying after the owner has taken over; a bot answering a food complaint "is a
   recipe for a bad review" (Brendi's own guide). Domínio's answer: stay silent 20 min after a human reply [Repo].
7. **Number bans and fragile transports.** Anota AI ban complaints; Cardápio Web needs a PC with Chrome and WhatsApp Web open;
   Goomer v1 needed a Windows app and broke on a WhatsApp update; Meta policy text reserves the right to restrict. [RA-snippet] [V]
8. **Silent failure.** Bot stops working weeks after purchase (OlaClick); "attendant not working" (Goomer); chat feature in the
   plan but not activated (Cardápio Web); Nuvem Chat messages shown as sent that never reached WhatsApp. No vendor states
   health alerts or delivery receipts for the merchant. [RA-snippet]
9. **Support is itself a bot or absent**; the product that sells "attendance" gives the merchant none. Anota AI, Goomer,
   Brendi, Cardápio Web all appear. [RA-snippet]
10. **Billing surprises and unpredictable cost.** Anota AI: fee added to shoppers without notice, ~17% hike with a feature
    removed, plan limits like OlaClick's 40-order cap; global: Tidio bills doubled overnight, Fin bills swing and bill "assumed
    resolution", Gorgias double-bills as a ticket. [RA-snippet] [T]
11. **Setup and knowledge burden; stale data.** Fin teams report multi-week content cleanup; an OlaClick merchant lost money
    when old menu prices stayed live. A bot is only as right as the menu, and merchants cannot see why it said something
    (inference: no vendor in the food set states a transcript audit or "why" view).
12. **Unproven return.** Vendors publish ROI headlines (Nuvem "1 in 4 carts", Rep AI 12.7%, Zipchat 16.4% chat-to-sale) with
    no independent method; the nearest real-world test (ChatGPT Instant Checkout) produced one-third of the site's
    conversion at Walmart and about 30 live merchants. Merchants are asked to trust it.

### 3.3 (c) White space: what nobody does well

Nobody states all of these together, and the food SMB set states almost none.

1. **A money guarantee.** The model never states an amount; it renders the system's quote (items, modifiers, delivery
   fee, coupon, total) and the order is created through the same checkout path. Only Domínio states "a value with no source in
   the system is blocked", and only on its top tier [Repo]. Venduá already computes money only in Core, with `/quote`
   and idempotent order creation, so "price you can't argue with" is claimable and testable.
2. **Closed loop from chat to kitchen to payment.** Pix (copia-e-cola or Meta `order_details`) with reconciliation by
   `reference_id`, expiry handling, nudge before expiry, confirmation back into the thread, then ticket/KDS and status updates.
   Claimants of in-chat Pix are Ailo, Goomer, Domínio, Botmaker, Weni, Blip. None describes reconciliation or what happens to
   expired or partial payments. Nuvem Chat explicitly does not do Pix in chat yet.
3. **A merchant control plane for the agent.** Draft-first mode (the agent proposes, staff tap send), then autonomy raised per
   action class; transcript audit with "why this answer"; one-tap correction that becomes a persistent rule;
   simulation of the store's own menu before going live; delivery receipts and health alerts. Fin, Sierra and Decagon do
   simulation and QA for enterprise; no BR food SMB vendor states any of it. Venduá's agent runtime already has
   autonomy levels, memory and a sim/judge harness [Repo], pointed at leads today.
4. **Revenue the merchant can verify.** Conversation to order link ("source: whatsapp-agent"), recovered vs organic revenue,
   cost per conversation vs revenue, shown in the admin. Food vendors state none; Nuvem and Zipchat give vendor ROI numbers,
   not a merchant-visible ledger. Needs the orders `source` column the repo already lists as a dependency.
5. **One brain across WhatsApp, storefront chat and Instagram with a shared cart.** Domínio says plainly "Instagram or site chat? No".
   Nuvem Chat's web chat is "coming soon". Meta covers WhatsApp/IG/Messenger but not the store's own site. Cart continuity (start
   on the storefront, finish on WhatsApp) is stated by nobody; Venduá identifies carts by phone (ADR 0019).
6. **Proactivity that is budgeted, measured and food-shaped.** Today: one fixed nudge (Domínio), 15-minute coupon (Delivery
   Direto), cashback blast to inactives (Takeat). Open: "the usual" reorder for the store's own customers (Ailo has it only
   for iFood users), mealtime timing, "avise quando abrir", post-delivery feedback to review, win-back under a merchant-set
   cost cap, quiet hours and opt-out, all re-checking conditions before send. Venduá wakeups fit this.
7. **Allergen and dietary safety as a product policy.** No vendor states one; Ailo uses dietary restrictions only as a
   preference. Venduá's catalog has no allergen field (grep) so this is a build item, but "never asserts absence without data,
   else escalates to the owner" is a differentiator and a liability shield.
8. **Cost predictability under Meta's new billing.** From 1 Oct 2026 service replies in the 24 h window are billable after
   a free tier [T: 1,000 per number per month; Meta's page does not state the tier] and Meta's own agent is US$ 2 per 1M tokens.
   Competitor models: per conversation (Nuvem), per outcome (Fin), flat (Goomer, Saipos, Delivery Direto), % of revenue (Brendi).
   A flat price with a visible usage meter and hard caps is unclaimed. (Pricing is the owner's decision.)
9. **Human-and-agent inbox that works for a family restaurant.** "Assumir", reply-as-the-store, agent auto-resumes after N
   minutes, internal notes, a handoff summary, SLA nudge. Rep AI and Zenvia give summaries; no food vendor states a
   multi-attendant inbox [Repo].
10. **Stable transport with owner control.** The market runs on WhatsApp Web hacks (Cardápio Web, Goomer v1, likely Anota AI) or the
    official API (Nuvem Chat, OlaClick, Brendi). The unofficial route is where the ban complaints are. Whoever offers a
    clean onboarding path to the official API with coexistence (keeping the store's phone app) removes the biggest merchant fear.
    This conflicts with Venduá's current unofficial-client decision (open question for the owner).

### 3.4 (d) Table stakes vs differentiators, late 2026

Constraints that shape both lists:

- Meta's own agent is free-to-cheap and native in WhatsApp Business, and Nuvemshop is its LatAm commerce partner.
  FAQ answering and "recommend from catalog" are now commodity.
- From 1 Oct 2026 service messages are billed (rates by market, free tier reported but not on Meta's page);
  Meta Business Agent is billed per token since 1 Aug 2026. Third-party "general-purpose AI" providers in Brazil are charged
  US$ 0,0625 per message under a dispute with CADE that remained unresolved on 24 Sep 2026; task-specific order bots are
  explicitly outside the ban. [T] zapvoxia.com.br, techcrunch.com 15/01/2026, [V] developers.facebook.com

**Table stakes (a store will assume it; absence loses the deal)**

- Text and audio understanding in Brazilian Portuguese, including accents and slang (Ailo, Anota AI, Saipos, Brendi, Consumer).
- Menu, photos, modifiers, combos; address, zone and fee quote; opening-hours awareness; order straight to kitchen printer/KDS.
- Status messages on every transition; feedback request after delivery.
- Human takeover with a bot pause, and a notification when the shopper asks for a person; never block the human path.
- Pix in the chat or one tap away, not a trip to another app (Ailo, Goomer, Domínio set the bar).
- Summary before confirm; prices only from system data; says it is automated.
- Stable transport and a visible connection status; setup in minutes from an existing menu (iFood import in 24 h at Brendi).
- LGPD-compliant opt-in and opt-out for anything outbound.

**Differentiators (what can make Venduá better than all of them)**

- Verifiable money correctness, marketed as a guarantee, with the tests to back it.
- Chat-to-kitchen-to-paid in one tracked flow, including Pix reconciliation and expiry recovery.
- Draft/supervised/autopilot dial per action, with audit, "why", corrections that stick, and pre-launch simulation on the store's menu.
- Attributed revenue and cost per conversation in the merchant's admin; weekly "what the agent sold" digest.
- Omnichannel with a shared cart: storefront chat, WhatsApp, Instagram DM.
- Proactive reorders and win-backs under a merchant budget, re-checked before each send.
- Allergen/dietary policy that refuses to guess.
- Voice replies and read-back confirmation (only Domínio states voice replies).
- Predictable cost (flat or capped) and a visible usage meter.
- Watch-list (not building): agent-readable storefront data for ChatGPT/Gemini/UCP-style shoppers' agents.

## 4. Five strongest competitors for Venduá (one line each)

1. **iFood Ailo**: best shopper-side food agent (Pix end to end, memory, one-click reorder, 500k+ users by Dec 2025) but it sells for iFood, not for the store.
2. **Domínio Tech**: most complete merchant+shopper agent set on a Brazilian restaurant ERP, with price grounding, Pix, voice, handoff; WhatsApp-only and top-tier-only.
3. **Nuvem Chat**: platform-native WhatsApp/Instagram sales agent with images and audio, per-conversation pricing, stats, and Meta partnership; no Pix in chat, web chat not shipped.
4. **Goomer Atendente Virtual 2.0**: generative bot with guardrails, Pix or card link in chat, store's own number, R$ 199/month, about 10,000 stores to convert.
5. **Brendi "Brenda"**: audio, images and stickers, official API, learns, dashboard, 8,500 stores, revenue-linked price; the closest to a modern food-native stack.

Also watch: **Meta Business Agent** (commodity floor for everyone), **Anota AI** (largest installed base, iFood-owned, weakest reputation).

## 5. Sources

Repo: docs/features/whatsapp-bot.md; docs/competitor-parity.md; docs/competitors/*.md (read at start of this task).

Vendor pages fetched [V]:

- https://anota.ai/home/funcionalidade/atendente-virtual/ ; https://anota.ai/blog/faq-anota-ai/
- https://brendi.com.br/atendimento-virtual ; https://brendi.com.br/blog/ia-conversacional-whatsapp/ ; https://brendi.com.br/blog/bot-whatsapp-delivery-restaurante-2026/
- https://www.cardapioweb.com/chatbot/ ; https://ajuda.cardapioweb.com/automacao/chatbot-cardapinho
- https://goomer.com.br/planos ; https://ajuda.goomer.com.br/goomergo/painel/goomergo/atendente-virtual-para-whatsapp/instalacao-do-atendente-virtual
- https://olaclick.com/ia-para-restaurantes/ ; https://olaclick.com/en/whatsapp-robot-with-artificial-intelligence/
- https://saipos.com/sistema/saipos-bot ; https://consumer.com.br/bot-whatsapp
- https://takeat.app/solucoes (via search summary; takeat.app/lp-solucoes-takeat returned 404)
- https://www.nuvemshop.com.br/solucoes/nuvem-chat ; https://atendimento.nuvemshop.com.br/pt_BR/ativar-nuvem-chat/perguntas-frequentes-sobre-o-nuvem-chat ; https://atendimento.nuvemshop.com.br/pt_BR/ativar-nuvem-chat/quais-sao-as-formas-de-pagamento-para-as-vendas-por-whatsapp-com-nuvem-chat ; https://www.nuvemshop.com.br/blog/agentic-commerce/
- https://digital.blip.ai/whatsapp/chatbot/ ; https://zenvia.com/whatsapp/meta-agents/ ; https://zaia.app/
- https://developers.facebook.com/documentation/business-messaging/whatsapp/pricing ; .../pricing/non-template-messages
- https://www.shopify.com/editions/spring2026 ; https://apps.shopify.com/rep-ai-sales-associate ; https://www.intercom.com/pricing ; https://fin.ai/ ; https://www.gorgias.com/pricing ; https://www.tidio.com/pricing/ ; https://www.zipchat.ai/ ; https://sierra.ai/ ; https://decagon.ai/ ; https://support.wix.com/en/article/about-the-wix-ai-chat-assistant

News and trade press [N]:

- https://www.mobiletime.com.br/noticias/27/07/2026/goomer-assistente-ia/ (Goomer 2.0, R$ 199)
- https://www.mobiletime.com.br/noticias/03/03/2026/business-ai-meta-brasil/ (Meta Business AI in Brazil)
- https://portal.clientesa.com.br/ifood-anuncia-nova-fase-do-agente-de-ia-ailo-no-whatsapp/ ; https://www.otempo.com.br/tecnologia-e-games/2026/7/16/atualizacao-na-ia-do-ifood-permite-fazer-pedidos-com-um-clique-saiba-como-funciona ; https://gironews.com/food-service/ifood-atualiza-ailo-e-amplia-autonomia-da-inteligencia-artificial/ ; https://tiinside.com.br/17/12/2025/ia-do-ifood-ja-alcanca-mais-de-500-mil-usuarios-e-amplia-uso-de-agentes-no-whatsapp/
- https://exame.com/negocios/nuvemshop-plataforma-e-commerce-whatsapp/ ; https://itforum.com.br/noticias/com-openai-e-anthropic-nuvemshop-e-commerce/ ; https://centraldovarejo.com.br/nuvemshop-integra-claude-e-openai-a-gestao-de-lojas-via-mcp/
- https://radardigitalbrasilia.com.br/noticias-corporativas-dino/331665-consumer-integra-ia-que-ouve-audios-em-pedidos-via-whatsapp/
- https://www.mobiletime.com.br/noticias/19/02/2026/loja-integrada-copiloto/ (Komea) ; https://www.mobiletime.com.br/noticias/09/09/2025/loja-integrada-agentes/
- https://ppc.land/meta-business-agent-brings-ai-customer-service-to-whatsapp-globally/ ; https://techcrunch.com/2026/01/15/after-italy-whatsapp-excludes-brazil-from-rival-chatbot-ban
- https://sejaefi.com.br/blog/pix-via-open-finance-chatbot-whatsapp ; https://www.letsmoney.com.br/pagamentos/iniciador-lanca-o-primeiro-mcp-de-pagamentos-agenticos-via-pix/ ; https://www.moneyreport.com.br/economia/pix-e-open-finance-podem-acelerar-o-agentic-commerce-no-brasil/
- https://changelog.shopify.com/posts/proactive-business-recommendations-from-sidekick

Third-party and Reclame Aqui snippets [T] [RA-snippet] (weak):

- https://www.reclameaqui.com.br/empresa/anota-ai/ and the complaint pages: .../anota-ai/robo-de-whatsapp-com-respostas-cinicas-e-suporte-falho-causa-banimento-da-empresa_PdW0b1zkTLDeGBOr/ ; .../anota-ai/banimento-do-whatsapp_kgy2Ne69hrkE2QSD/ ; .../anota-ai/problemas-com-o-robo-de-atendimento-e-atendimento-demorado-no-anotai_HmeytUw2wlsWpK22/ ; .../anota-ai/sou-comerciante-e-uso-a-plataforma-anota-ai-para-receber-pedidos-online-re_LApD5WDGcJaEwnxd/
- https://www.reclameaqui.com.br/goomer/atendente-virtual-nao-esta-funcionando_B1cnEtJutjk4NcER/
- https://www.reclameaqui.com.br/cardapio-web-servicos-de-tecnologia/chatbox-nao-funciona-e-falta-de-suporte-no-sistema-cardapio-web_RGraftHa0wago2lb/
- https://www.reclameaqui.com.br/olaclick/problema-no-chatbot_C7YJqQ7vDMD7QEg6/ ; .../olaclick/ola-click-e-sua-propaganda-enganosa_HI4ge3LS4dILA8Ai/
- https://www.reclameaqui.com.br/nuvem-shop/nuvem-chat-nao-funciona-induz-ao-erro-e-propaganda-enganosa_0RCfNzIDh8-akT0u/
- https://www.reclameaqui.com.br/empresa/brendi-servicos-tecnologicos-ltda/
- https://reidodelivery.com.br/blog/anota-ai-vale-a-pena (competitor-authored) ; https://botaihub.com.br/ferramentas/anota-ai/
- https://www.zappy.chat/atendimento-humano-ia-whatsapp-custo-api/ ; https://zapvoxia.com.br/en/blog/chatgpt-whatsapp-ban-what-changed ; https://www.courier.com/blog/whatsapp-pricing-changes-october-2026 ; https://techweez.com/2026/09/28/whatsapp-business-pricing-october-2026/
- https://consumidormoderno.com.br/chatbots-consumidores-preferem-humano/ ; https://exame.com/bussola/marcas-comecam-a-desistir-de-chatbots-e-resgatar-o-atendimento-humano-entenda/ ; https://noticiapreta.com.br/consumidores-preferem-atendimento-humano-chatbots-ia/
- https://www.planalto.gov.br/ccivil_03/_ato2019-2022/2022/decreto/d11034.htm (Lei do SAC; scope read via search summaries)
- https://www.agenciaeplus.com.br/vtex-whatsapp-integracao-pagamento-nativo/ (Weni) ; https://nacao.digital (AI agent comparisons) ; https://www.getmacha.com/blog/intercom-review ; https://www.getmacha.com/blog/decagon-vs-sierra-ai ; https://www.hellorep.ai/blog/best-ai-agents-for-ecommerce (vendor-authored)
- https://www.hypotenuse.ai/blog/chatgpts-instant-checkout-the-next-phase-of-agentic-commerce ; https://kenhuangus.substack.com/p/googles-ucp-just-won-agentic-commerce
- https://www.cbsnews.com/news/aircanada-chatbot-discount-customer/ ; https://www.fortune.com/2025/05/09/klarna-ai-humans-return-on-investment

## 6. Caveats and conflicts to resolve before acting

- **Meta billing.** Meta's non-template-messages page says service messages and utility templates in-window become
  billable on 2026-10-01 and Meta Business Agent is US$ 2 per 1M tokens from 2026-08-01. Meta's main pricing page, fetched in the same
  session, still lists "Service: free" (probably a stale cache). The 1,000 free service messages per number per month figure is from
  third parties only. Pull the Brazil BRL rate card before any cost model.
- **Anota AI price and transport**: sources conflict; Reclame Aqui bans suggest a non-official route, third parties say
  Business API. Unknown.
- **Goomer**: MobileTime says in-house, not official API; the install doc describes WhatsApp Web (older bot).
- **Nuvem Chat Pix**: press says "Pix or card"; the help center says one-click is card-only and Pix goes through the link.
- **Fresh vs repo**: Takeat "Teka" order taking comes from a search summary of the vendor page; confirm before relying on it.
- **Shopper-side complaints** about merchant bots in Brazilian food are not public in any quantity found; items 1-6 of 3.2 rely
  on surveys, vendor guidance and global cases. A short test (mystery-shop 5 competitors' bots with an audio order, an
  allergy question, a modifier, a Pix payment and a "falar com atendente") would be better evidence than any of this.
- Not researched: Menu Dino's own bot (relies on Consumer), Delivery Direto's current AI claims beyond the repo, Takeat/Saipos
  Reclame Aqui, Meta Business Calling voice agents in Brazil, LGPD and Meta opt-in rules for Brazil (the repo already marks these as
  needing a legal read).
