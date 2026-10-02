# Brazilian gateways/billing platforms for Venduá's own recurring subscriptions (R$ 39,90 and R$ 99/mês)

Research date: 2026-10-02. Prices are BRL. All fetches were via WebFetch/WebSearch; several official pages were unreachable (Mercado Pago custos 403, iugu /precos 404, Asaas blog 403, Asaas /precos-e-prazos redirected to login), so some rows rely on secondary sources and are flagged. Arithmetic cost examples are my own calculation from the cited rates, not published figures.

## 1. Pix Automático / Pix cobrança / card recorrente + retry / bolix: who supports what?

### Takeaway

Asaas, Vindi, Efí, Inter, PagBank and Mercado Pago (per secondary sources and MP docs wording) support Pix Automático. Stripe Brasil does not (Pix is invite-only, one-off, no Pix Automático), and Pagar.me does not document it for merchants as of Jul/2026. Iugu, Galax Pay and Superlógica were not confirmed from primary sources. Vindi and Pagar.me have the most explicit card-recurrence dunning/retry; Mercado Pago preapproval is card-first and its Pix Automático path is unclear.

### Cited Findings

- Pix Automático went live 16 Jun 2025 (PagBank article); interbank automatic debits had to migrate to Pix Automático from 13 Oct 2025, with bank adaptation deadline 1 Jan 2026 — [PagBank blog](https://blog.pagbank.com.br/pix-automatico-pagbank), [Cora blog](https://www.cora.com.br/blog/boletos-recorrentes-vs-pix-automatico/)
- Asaas: Pix Automático available for PJ customers; eligibility = CNPJ active for at least 6 months, approved account, no DICT fraud flags; API activated with `paymentCreationMode: SUBSCRIPTION`; Asaas generates later charges automatically after payer authorization — [Asaas search snippet citing blog.asaas.com/release/pix-automatico](https://blog.asaas.com/release/pix-automatico/), [Asaas API docs changelog](https://docs.asaas.com/changelog/pix-autom%C3%A1tico-cobran%C3%A7as-recorrentes-automatizadas)
- Asaas: Pix Automático has no extra cost; priced like normal Pix at the plan's standard rate — [blog.asaas.com (via search result, page itself returned 403)](https://blog.asaas.com/release/pix-automatico/)
- Vindi: Pix Automático available (single authorization, charges sent automatically; cited use cases include SaaS); card renewal ("Card Renewal: automatic updates for expired cards") and "Smart Retries"/retry with balance intelligence on all plans; auto-retry listed in Premium row — [Vindi preços](https://vindi.com.br/precos/), [Vindi Pix](https://vindi.com.br/formas-de-pagamentos/pix/)
- Vindi also offers Bolepix (0,95% via QR or R$ 2,99 via barcode) — [Vindi preços](https://vindi.com.br/precos/)
- Efí: Pix Automático is offered at R$ 3,50 fixed per processed transaction (Efí's own tariff page and blog, updated 23 Sep 2026) — [Efí tarifas](https://sejaefi.com.br/tarifas), [Efí blog](https://sejaefi.com.br/blog/qual-custo-do-pix). Efí also lists "Pagamento Recorrente" as a free feature with no tariff detail on the page.
- Pagar.me: recurrence via API v5 (plans, trials, pre/postpaid, configurable dunning), but "Pix Automático: não documentado na API do lojista para cobrar (jul/2026). A recorrência é cartão, boleto e débito." This is from a competitor (Chargefy) comparison — treat as secondary — [Chargefy vs Pagar.me](https://chargefy.io/alternativas/pagarme)
- Stripe Brasil: Pix is invite-only, requires 60 days of processing history; Brazilian accounts support one-time Pix, BRL settlement only, Pix Automático "not available" — [search summary of Stripe Support/docs](https://support.stripe.com/questions/how-to-enable-pix-as-a-payment-method-in-brazil), [Stripe Pix recurring doc](https://docs.stripe.com/payments/pix/accept-a-recurring-payment). Stripe pricing page confirms Pix "por convite" — [Stripe BR pricing](https://stripe.com/br/pricing)
- Mercado Pago: preapproval subscriptions are created with a `card_token_id` (card-first); a search summary of MP docs says plan-based subscription checkout accepts card or Pix Automático and refuses if neither is enabled; an MP-sourced article says plans "aceita cartão de crédito, Pix e boleto" — [MP developers docs](https://www.mercadopago.com.br/developers/pt/docs/subscriptions/integration-configuration/subscription-associated-plan), [search result summary](https://www.mercadopago.com.br/blog/quanto-custa-receber-pagamentos-via-pix-e-codigo-qr). Conflicting/unclear whether Pix Automático is available via the preapproval API for Venduá's use.
- PagBank: Pix Automático active, "no merchant API detail provided" on the page; merchants with active CNPJ can initiate proposals — [PagBank blog](https://blog.pagbank.com.br/pix-automatico-pagbank)
- Inter has a documented API for Pix Automático (recurrence + recurring charges created by receiver after payer authorization) — [Inter developers](https://developers.inter.co/references/pix-automatico). Cora has a public API (developers.cora.com.br) but Pix Automático via its API was not confirmed — [Cora API](https://developers.cora.com.br/)
- A generic list claims Stripe Brasil, Pagar.me, Mercado Pago, Stone, Cielo, Asaas, Iugu, Vindi and PagSeguro are all Pix Automático participants — [FWC Tecnologia blog](https://fwctecnologia.com/blog/post/pix-automatico-apps-recorrencia-sem-cartao-2026); contradicted for Stripe and Pagar.me merchant APIs by Stripe docs and Chargefy above. Low-reliability aggregator.
- Dunning pattern suggested for Pix Automático SaaS: retries at 1, 3 and 7 days with notifications, then card fallback or pause; one case study (clinic SaaS migrating from Stripe) reports 60-75% acceptance when discount is clear, 22% stayed on card, delinquency 11% to 4% — single anecdote, [SystemForge blog](https://forjadesistemas.com.br/blog/pix-automatico-recorrencia-saas-proprio-2026/)
- Payers can cancel authorization or stop an individual debit until 23:59 the day before — [PagBank blog](https://blog.pagbank.com.br/pix-automatico-pagbank)
- Mind Group's July 2026 comparison lists "Scheduled Pix" (not Pix Automático) for Cielo, Asaas, Adyen — [Mind Group, 22 Jul 2026](https://mindconsulting.com.br/2026/07/gateways-pagamento-online-brasil-comparativo-2026/)

### Inferences

- For Venduá, a "Pix com vencimento + Pix Automático" setup realistically exists on Asaas, Vindi and Efí (plus Inter/PagBank bank APIs). Stripe and Pagar.me cannot replace the monthly manual Pix flow.
- Mercado Pago remains the incumbent for cards; moving only the Pix leg to a gateway with Pix Automático and keeping MP preapproval for cards is a viable "complement" architecture.
- No source confirmed card updater (network account updater) at Asaas, Iugu, Efí or MP; only Vindi advertises card renewal.

### Gaps

- Iugu Pix Automático status: no primary source retrieved. Iugu's pricing page returned 404.
- Galax Pay and Superlógica Pix Automático support: not found in sources.
- Whether Mercado Pago preapproval API supports Pix Automático for subscription plans, and at what fee: unresolved; MP pages 403.
- Asaas card retry/dunning rules (number of retries) not retrieved.

## 2. Fees, monthly minimums, settlement, antecipação

### Takeaway

Asaas, Vindi (card), Mercado Pago (Pix) are cheapest on percentage; Asaas and Galax Pay charge flat per-Pix amounts that hurt at R$ 39,90. Iugu (R$ 149+/mês) and Vindi (R$ 299+/mês) have platform fees that dwarf Venduá's per-charge economics at small scale. Efí's Pix Automático at R$ 3,50 is expensive for these tickets.

### Cited Findings

**Asaas** (official /precos-e-taxas, fetched 2026-10-02; no monthly fee):

- Pix R$ 1,99/transação; promo R$ 0,99 for first 3 months from account creation; first 100 monthly Pix received by key/static QR are free — [Asaas preços](https://www.asaas.com/precos-e-taxas); free 100 detail from search snippet of the same site
- Boleto R$ 1,99 (promo R$ 0,99); Correios-sent boleto R$ 2,91
- Credit card à vista R$ 0,49 + 2,99% (promo 3 months R$ 0,49 + 1,99%); 2-6x 3,49%; 7-12x 3,99%
- Notifications: WhatsApp R$ 0,55/msg; email+SMS package R$ 0,99/cobrança; voice robot R$ 0,55
- Antecipação: card à vista 1,25%/mês, parcelado 1,70%/mês; boleto from 5,79%/mês
- Receipt: card D+2 to D+3 (subject to credit analysis); boleto D+32 (as listed)
- NFS-e: R$ 0,49 per note, no monthly fee; can be issued with the charge, scheduled for recurring charges; integrates 1.347+ municipalities (page also says 2.000+ prefeituras) and the NFS-e Nacional portal — [Asaas nota fiscal](https://www.asaas.com/nota-fiscal)
- Promo valid "until 01/02/2027 for accounts created today" (i.e., 3 months)
- A third-party blog lists "Asaas Pix Recorrente 0,99%" — [SystemForge](https://forjadesistemas.com.br/blog/pix-automatico-recorrencia-saas-proprio-2026/); conflicts with Asaas's R$ 0,99 flat promo; likely misread, do not use. Mind Group lists Asaas Pix R$ 0,49 and card 2,99% — [Mind Group](https://mindconsulting.com.br/2026/07/gateways-pagamento-online-brasil-comparativo-2026/) — also conflicts with the official R$ 1,99 (older/other tier?).

**Iugu**

- Plans: Essencial R$ 149/mês; Essencial + Split R$ 649/mês; Motor iugu sob consulta (from search summary of iugu.com/plano_conhecaaiugu; page itself named plans but fetch did not show prices). Page FAQ: resources billed as subscription, "taxas de configuração inicial e tarifas variáveis" may add — [iugu planos](https://iugu.com/plano_conhecaaiugu)
- Per-transaction (secondary summary of iugu pages): Pix 0,99%; boleto R$ 2,19; card 3,34%; 2-6x 4,28%; 7-12x 4,79%; "cartão a partir de 2,49%" — [search summary of iugu pages](https://www.iugu.com/metodo-pagamento-pix), [Mind Group](https://mindconsulting.com.br/2026/07/gateways-pagamento-online-brasil-comparativo-2026/). Unverified on official /precos (404). Likely negotiable.

**Vindi** (official, fetched 2026-10-02): plans Essential R$ 299/mês (1 user), Pro R$ 499/mês, Premium R$ 1.119/mês, Enterprise sob consulta; transaction fees on top. Card 2,75% (D+30) or 3,25% (D+14); Pix 0,95% (min R$ 1,60); boleto R$ 2,99; Bolepix 0,95%/R$ 2,99; processing fee R$ 0,39 per approved transaction (waivable). Pix settlement twice daily (10h and 15h on business days) — [Vindi preços](https://vindi.com.br/precos/), [Vindi Pix](https://vindi.com.br/formas-de-pagamentos/pix/)

**Efí** (official tarifas, fetched 2026-10-02): Pix cobrança API 1,19%; Pix Automático R$ 3,50/transação; boleto R$ 3,45; card à vista 3,49%; 2-6x 3,99%; 7-12x 4,39%; antecipação 4% per borderô capped R$ 30; boleto compensation 1 business day; card settlement up to 31 days — [Efí tarifas](https://sejaefi.com.br/tarifas)

**Stripe Brasil** (official, fetched 2026-10-02): cards nacionais 3,99% + R$ 0,39 (+2% international); Pix 1,19% (por convite); boleto R$ 3,45; Billing +0,7% of Billing volume; payouts continuous/weekly/monthly — [Stripe BR pricing](https://stripe.com/br/pricing). Mind Group: settlement D+2 to D+7. NFS-e: not offered/not stated.

**Pagar.me** (secondary): Pix 1,19% + R$ 0,99; card à vista 4,39% (Plano à Vista) or 5,59% (Plano Parcelado) + R$ 0,99; boleto R$ 3,49; Pix same day, boleto D+1, credit D+2 — [Chargefy comparison](https://chargefy.io/alternativas/pagarme), [search summary of Pagar.me rates](https://sejaefi.com.br/blog/qual-custo-do-pix). Mind Group lists card 3,19% (conflict). Negotiable by volume.

**Mercado Pago**: Pix online 0,99% (R$ 0,49 for new CNPJ billing >= R$ 15 mil/mês); credit à vista 4,98% (immediate) to 3,03% (30 days); debit 1,99% — [search results from MP blog/calculators](https://www.mercadopago.com.br/blog/quanto-custa-receber-pagamentos-via-pix-e-codigo-qr), [marreiradigital](https://marreiradigital.com.br/calculadora-mercadopago/). Mind Group lists card 4,99%, Pix 0,99%, boleto R$ 3,49, D+14 standard. A blog quotes Pix Automático "R$ 0,05 a R$ 0,30" with D+0 — low reliability, unsourced. Official MP page 403 — Venduá should read its own MP account's real "assinaturas" rate.

**PagBank**: Pix up to 1,89% and boleto R$ 3,99 (PagBank blog); Mind Group lists card 4,99%, boleto R$ 3,49, D+14 — [PagBank blog](https://blog.pagbank.com.br/pix-automatico-pagbank), [Mind Group](https://mindconsulting.com.br/2026/07/gateways-pagamento-online-brasil-comparativo-2026/). Pix Automático: "max 1,89%", free to payers.

**Galax Pay** (Celcoin-owned since 2022; page updated 26 Dec 2025): no monthly fee; card 3,49% + R$ 0,69 (negotiable above R$ 20 mil/mês); boleto R$ 1,99 (first 30 days); Pix dynamic QR R$ 1,50; Pix via boleto R$ 2,99 — [iDinheiro](https://www.idinheiro.com.br/negocios/galax-pay/). Pix Automático/NFS-e not mentioned.

**Cora**: free Pix sent and received and free boleto issuance on PJ account (Cora's statements; API existence at developers.cora.com.br) — [Cora blog](https://www.cora.com.br/blog/boletos-recorrentes-vs-pix-automatico/). Typical bank Pix tariffs: Caixa 0,89%, BB 0,99%, Bradesco 1,40%, Santander 1,40%, Itaú 1,45%; Efí says Pix Automático fees generally R$ 0,20-0,50 per charge by institution — [Efí blog](https://sejaefi.com.br/blog/qual-custo-do-pix), [search summary](https://sejaefi.com.br/blog/qual-custo-do-pix) (generic; not a per-PSP quote).

**Superlógica Assinaturas**: pricing not found. Feature: option "Emitir NF na geração de cobranças" auto-creates NFs when charges are generated (waits for transmission to the Prefeitura) — [Superlógica help](https://assinaturas.superlogica.com/hc/pt-br/articles/360008826593-Como-emitir-nota-fiscal-automaticamente-na-gera%C3%A7%C3%A3o-da-cobran%C3%A7a)

### Inferences

- Mind Group (Jul 2026) shows Asaas card 2,99% and Pix R$ 0,49 vs Asaas's own fetched page R$ 0,49 + 2,99% card and R$ 1,99 Pix; treat the official page as truth.
- Cheapest Pix at these tickets: Mercado Pago 0,99% (R$ 0,39/0,98), iugu 0,99%, Efí 1,19%. Asaas R$ 1,99 is cheaper than % only above ~R$ 200 tickets, so for R$ 39,90 it is worse.

### Gaps

- Official Mercado Pago assinaturas fee and settlement; official iugu /precos (404); Pagar.me official pricing page; PagBank official recurrence tariff; Cora Pix Automático API; Superlógica pricing.
- Which of these carry "a partir de"/negotiated rates for a small SaaS: Iugu, Pagar.me, Vindi (fee waivers), Galax Pay (>R$ 20k) are explicitly negotiable.

## 3. NFS-e, customer portal, webhooks, API, sandbox, SDK

### Takeaway

Only Asaas (R$ 0,49/nota, automatic with the charge, NFS-e Nacional integration) and Superlógica (automatic NF at charge generation) clearly issue NFS-e; no source confirmed it for the others. Venduá would otherwise need its own NFS-e issuer (e.g., Focus NFe/eNotas — not researched).

### Cited Findings

- Asaas NFS-e as above — [Asaas nota fiscal](https://www.asaas.com/nota-fiscal)
- Mind Group says only Asaas is mentioned as offering "integrated tax invoice issuance" among the gateways surveyed — [Mind Group](https://mindconsulting.com.br/2026/07/gateways-pagamento-online-brasil-comparativo-2026/)
- Pix Automático article by SystemForge and Chargefy comparison do not address NFS-e — [SystemForge](https://forjadesistemas.com.br/blog/pix-automatico-recorrencia-saas-proprio-2026/), [Chargefy](https://chargefy.io/alternativas/pagarme)
- Stripe pricing page does not state Brazil NFS-e pricing — [Stripe BR pricing](https://stripe.com/br/pricing)
- Mercado Pago preapproval: PUT /preapproval/{id} can change amount; plans via /preapproval_plan — [MP docs](https://www.mercadopago.com.br/developers/pt/docs/subscriptions/subscription-management)
- Asaas has documented API (docs.asaas.com, with llms.txt index) and a public Pix Automático API mode — [Asaas docs](https://docs.asaas.com/changelog/pix-autom%C3%A1tico-cobran%C3%A7as-recorrentes-automatizadas)
- Vindi: notifications by SMS/email/WhatsApp, refunds centralized, custom payment pages included in all plans; API integration listed under Pro and above — [Vindi preços](https://vindi.com.br/precos/)

### Inferences

- Plan-gated API access at Vindi (Pro, R$ 499/mês) makes it a poor fit for Venduá's own tiny use.

### Gaps

- Customer-portal features, sandbox quality and TypeScript SDK status per gateway were not verified (no docs read for Iugu, Vindi, Efí, Pagar.me, Stripe SDK beyond general knowledge).
- NFS-e for Iugu, Vindi, Efí, Pagar.me, PagBank, Galax Pay: not found.

## 4. Dunning, built-in reminders, chargeback

### Takeaway

Built-in reminders with price tags: Asaas (WhatsApp R$ 0,55/msg, email+SMS R$ 0,99); Vindi includes WhatsApp/SMS/email notifications and retries in plan fees. Chargeback handling not documented in what was retrieved.

### Cited Findings

- Asaas notification costs — [Asaas preços](https://www.asaas.com/precos-e-taxas)
- Vindi retries, card renewal, notifications — [Vindi preços](https://vindi.com.br/precos/)
- Pagar.me configurable dunning workflows in v5 recurrence — [Chargefy](https://chargefy.io/alternativas/pagarme)
- Suggested Pix Automático retry cadence (1, 3, 7 days) — [SystemForge](https://forjadesistemas.com.br/blog/pix-automatico-recorrencia-saas-proprio-2026/)
- Pix Automático inherently lowers chargeback exposure (no card) — [FWC Tecnologia](https://fwctecnologia.com/blog/post/pix-automatico-apps-recorrencia-sem-cartao-2026) (claim about MDR absence; aggregator)

### Inferences

- Pix payments have no card chargeback; the MED/refund dispute exists but was not researched.

### Gaps

- Chargeback fees and process for every candidate.

## 5. Concrete cost per charge (my calculations from cited rates)

| Gateway / method                                | R$ 39,90           | %           | R$ 99,00    | %    | Notes                                                        |
| ----------------------------------------------- | ------------------ | ----------- | ----------- | ---- | ------------------------------------------------------------ |
| Asaas Pix (std R$ 1,99)                         | 1,99               | 5,0%        | 1,99        | 2,0% | promo R$ 0,99 first 3 months                                 |
| Asaas Pix Automático                            | 1,99 (same as Pix) | 5,0%        | 1,99        | 2,0% | per Asaas blog                                               |
| Asaas card (R$ 0,49 + 2,99%)                    | 1,68               | 4,2%        | 3,45        | 3,5% | promo 1,99%: 1,28 / 2,46                                     |
| Asaas NFS-e                                     | +0,49              |             | +0,49       |      |                                                              |
| Mercado Pago Pix 0,99%                          | 0,39               | 1,0%        | 0,98        | 1,0% | secondary source                                             |
| Mercado Pago card 3,03% (30d) / 4,98% (instant) | 1,21 / 1,99        | 3,0% / 5,0% | 3,00 / 4,93 |      | assinatura rate unverified                                   |
| Iugu Pix 0,99%                                  | 0,39               | 1,0%        | 0,98        | 1,0% | + R$ 149/mês plan                                            |
| Iugu card 3,34%                                 | 1,33               | 3,3%        | 3,31        | 3,3% | fixed component unknown; + R$ 149/mês                        |
| Vindi Pix 0,95% (min 1,60)                      | 1,60               | 4,0%        | 1,60        | 1,6% | + R$ 299/mês plan                                            |
| Vindi card 2,75% + R$ 0,39                      | 1,49               | 3,7%        | 3,11        | 3,1% | D+30; D+14 3,25%: 1,69 / 3,61                                |
| Efí Pix cobrança 1,19%                          | 0,47               | 1,2%        | 1,18        | 1,2% |                                                              |
| Efí Pix Automático R$ 3,50                      | 3,50               | 8,8%        | 3,50        | 3,5% |                                                              |
| Efí card 3,49%                                  | 1,39               | 3,5%        | 3,45        | 3,5% |                                                              |
| Stripe card 3,99% + 0,39                        | 1,98               | 5,0%        | 4,34        | 4,4% | + Billing 0,7%: 2,26 / 5,03                                  |
| Pagar.me Pix 1,19% + 0,99                       | 1,47               | 3,7%        | 2,17        | 2,2% | no Pix Automático                                            |
| Pagar.me card 4,39% + 0,99                      | 2,74               | 6,9%        | 5,34        | 5,4% |                                                              |
| Galax Pay card 3,49% + 0,69                     | 2,08               | 5,2%        | 4,15        | 4,2% |                                                              |
| Galax Pay Pix R$ 1,50                           | 1,50               | 3,8%        | 1,50        | 1,5% |                                                              |
| Cora Pix                                        | 0                  | 0%          | 0           | 0%   | needs PJ Cora account; no recurrence/NFS-e tooling confirmed |
| PagBank Pix (up to 1,89%)                       | 0,75               | 1,9%        | 1,87        | 1,9% | ceiling                                                      |

### Inferences

- With no monthly fee and NFS-e at R$ 0,49, Asaas is the strongest one-stop for a small SaaS; its flat R$ 1,99 Pix is the weakness at R$ 39,90 (5%). Its R$ 0,99 promo lasts only 3 months.
- Iugu and Vindi fixed monthly plans (R$ 149 / R$ 299+) only pay off at hundreds of merchants (R$ 149 equals ~3,7 Basic charges of 39,90 in fees alone, before per-transaction costs).
- Recommended shape (a judgment, needs Venduá's volume data): keep Mercado Pago preapproval for card if its real rate is ~3-4%; evaluate Asaas as the Pix Automático + boleto + NFS-e layer; avoid Stripe and Pagar.me for Pix recurrence; Efí is competitive only for non-automatic Pix cobrança (1,19%).

### Gaps

- Venduá's merchant volume, mix and acceptance rates are unknown, so break-even for Iugu/Vindi plans cannot be computed.
- Fee data for many entries come from aggregators and may be stale; verify on each official page / sales quote before deciding.
