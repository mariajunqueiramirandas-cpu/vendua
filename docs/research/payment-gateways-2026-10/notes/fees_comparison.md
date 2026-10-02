# Merchant fees (taxas) of Brazilian online payment providers for small merchants — as of October 2026

All sources accessed 2026-10-02. Method caveat: official pages for Mercado Pago (mercadopago.com.br/costs-section/..., /ajuda/custos...) and a Mercado Pago blog returned HTTP 403 to my fetch tool, so Mercado Pago numbers come from secondary sources that say they mirror the official table. Pages fetched via WebFetch were summarised by a small model (not read verbatim); the infinitepay.io/taxas and pagar.me/precos pages in particular looked like maquininha/landing content rather than a clean online table. Sources conflict a lot (flagged "DISCREPANCY"). Treat every number as "verify in the merchant dashboard before publishing copy" (project rule: price copy needs the user's decision).

## 1. Pix received (online: checkout / link / API) — which provider is cheapest?

### Takeaway

Pix online is roughly R$ 0.00–0.71 on a R$ 60 order at most providers (0.99%–1.19%), with Asaas the outlier (flat R$ 1.99, promo R$ 0.99) and InfinitePay free. Mercado Pago charges 0.99% with instant availability. Sources disagree on Pagar.me/Stone/Ton (free vs 0.99% vs 1.19% + R$ 0.99).

### Cited Findings

| Provider                    | Pix online fee                                                                                                                                                                                                                                                                           | Settlement                                                         | Notes / flags                                                                                                                       | Source                                                                                                                                                                                                                                                                                                                                             |
| --------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Mercado Pago                | 0.99% (checkout/link/API); no cap found                                                                                                                                                                                                                                                  | Instant ("na hora")                                                | Pix transfers free; 0.49% mentioned for sellers >R$ 15k/month (Nuvemshop, unverified)                                               | [Marreira Digital](https://marreiradigital.com.br/calculadora-mercadopago/) ("confirmed Sep 2026 per official table"); [Negócios Financeiros, 21 May 2026](https://www.negociosfinanceiros.com/taxas-mercado-pago-checkout-transparente-como-funcionam/); [Nuvemshop, updated 19 Jun 2026](https://www.nuvemshop.com.br/blog/pix-pessoa-juridica/) |
| PagBank                     | Link de Pagamento: 0% promo (first 30 days or R$ 5,000 TPV, new merchants, campaign from 8 Apr 2026, no end date), then 0.99%; funds instant in PagBank account. Nuvemshop says "up to 1.89%" for QR/checkout (maquininha-era figure; DISCREPANCY)                                       | Instant (link)                                                     | Promo is conditional/ revocable                                                                                                     | [PagBank FAQ regulation](https://faq.pagbank.com.br/duvida/quais-sao-as-taxas-para-vender-com-link-de-pagamento/1929); [Calculadora de Taxas, updated 30 Sep 2026](https://www.calculadoradetaxas.com.br/pagseguro/taxas); [Nuvemshop](https://www.nuvemshop.com.br/blog/pix-pessoa-juridica/)                                                     |
| Pagar.me (Stone)            | 0.99% (pagar.me/precos landing text); 1.19% + R$ 0.99 (Chargefy-type comparison, 2026); "free" for Stone/Ton link (iDinheiro). THREE-WAY DISCREPANCY                                                                                                                                     | Next business day for card per official page; Pix timing not found | Pagar.me is mid-migration into Stone (landing page promos)                                                                          | [pagar.me/precos](https://pagar.me/precos); [Chargefy vs Pagar.me search snippet](https://chargefy.io/alternativas/pagarme); [iDinheiro, 2 Jul 2026](https://www.idinheiro.com.br/negocios/melhores-links-de-pagamento/)                                                                                                                           |
| Stripe Brasil               | 1.19% per Pix paid; "invitation-only"                                                                                                                                                                                                                                                    | Payout continuous/weekly/monthly (Pix timing not stated)           | Not self-serve                                                                                                                      | [stripe.com/br/pricing](https://stripe.com/br/pricing)                                                                                                                                                                                                                                                                                             |
| Asaas                       | R$ 1.99 per Pix standard; R$ 0.99 promo for 3 months. DISCREPANCY: a Mind Group article lists R$ 0.49                                                                                                                                                                                    | Instant not confirmed                                              | Up to 30 free Pix transfers/month for PJ (outbound)                                                                                 | [asaas.com/precos-e-taxas](https://www.asaas.com/precos-e-taxas); [Mind Group, Jul 2026](https://mindconsulting.com.br/2026/07/gateways-pagamento-online-brasil-comparativo-2026/)                                                                                                                                                                 |
| Efí Bank                    | 1.19% (API/cobrança, static and dynamic); Pix Automático R$ 3.50 per settled Pix                                                                                                                                                                                                         | Not stated                                                         | 30 free Pix/month via app does not apply when key is tied to API/webhook                                                            | [sejaefi.com.br/tarifas](https://sejaefi.com.br/tarifas); [Efí blog](https://sejaefi.com.br/blog/qual-custo-do-pix)                                                                                                                                                                                                                                |
| InfinitePay                 | 0% ("PIX É TAXA 0,0%", all plans/settlements)                                                                                                                                                                                                                                            | Instant                                                            | Fetched page may be maquininha-oriented; iDinheiro lists link Pix "not disclosed"                                                   | [infinitepay.io/taxas](https://www.infinitepay.io/taxas); [iDinheiro](https://www.idinheiro.com.br/negocios/melhores-links-de-pagamento/)                                                                                                                                                                                                          |
| Iugu                        | 0.99%; no activation fee; Pix refunds up to 90 days, no fee                                                                                                                                                                                                                              | Not stated                                                         | Search snippet; official iugu.com/precos not fetched                                                                                | [Iugu Pix blog](https://www.iugu.com/blog/pix-na-iugu) (via search snippet)                                                                                                                                                                                                                                                                        |
| PicPay (link)               | 0.99% (secondary); official help page lists no percentages, says check app                                                                                                                                                                                                               | Not stated                                                         | Unverified against official                                                                                                         | [Calculadora/search result via melhorescartoes & PicPay help](https://meajuda.picpay.com/hc/pt-br/articles/43844947885075-O-link-de-pagamento-do-PicPay-tem-mensalidade-ou-taxas-de-ades%C3%A3o-Quais-s%C3%A3o-as-taxas-aplicadas); [Nuvemshop PicPay Empresas](https://www.nuvemshop.com.br/blog/picpay-empresas/)                                |
| Ton / Stone                 | Free (iDinheiro, 2 Jul 2026)                                                                                                                                                                                                                                                             | —                                                                  | Conflicts with Pagar.me 0.99%                                                                                                       | [iDinheiro](https://www.idinheiro.com.br/negocios/melhores-links-de-pagamento/)                                                                                                                                                                                                                                                                    |
| Nubank / Inter / C6 PJ      | Reported free for PJ receiving via key/static QR, but banks charge on dynamic QR/API, or beyond 30 Pix/month if contract says so. Inter QR immediate: 0.9% (min R$ 0.10, max R$ 1.50); QR with due date 0.99% (min 0.10, max 1.99) — from a search summary, not verified on Inter's page | Instant                                                            | None of these three offers a checkout/gateway; they are only collection accounts. DISCREPANCY between "free" lists and Inter QR fee | [Nuvemshop Pix PJ](https://www.nuvemshop.com.br/blog/pix-pessoa-juridica/); [InfoMoney](https://www.infomoney.com.br/consumo/pix-pj-pessoa-juridica-taxas-bb-banco-do-brasil-santander-caixa-bancos/); [Wise on Inter](https://wise.com/br/blog/banco-inter-cobra-pix-pj)                                                                          |
| Banks that cap Pix receipts | BB up to 0.99% (max R$ 140), Itaú up to 1.45% (max R$ 150), Bradesco up to 1.40% (max R$ 145), Santander R$ 6.54 fixed or 1.4% checkout                                                                                                                                                  | Instant                                                            | Not relevant to small merchants at R$ 40–120 tickets (caps never reached)                                                           | [Nuvemshop](https://www.nuvemshop.com.br/blog/pix-pessoa-juridica/)                                                                                                                                                                                                                                                                                |
| Cielo / Getnet / Rede       | Pix "variable or negotiable"; no published online Pix price found                                                                                                                                                                                                                        | —                                                                  |                                                                                                                                     | [Mind Group](https://mindconsulting.com.br/2026/07/gateways-pagamento-online-brasil-comparativo-2026/)                                                                                                                                                                                                                                             |

### Inferences

- For R$ 40–120 tickets a percentage Pix fee (0.99%) costs R$ 0.40–1.19; Asaas's flat R$ 1.99 is worse for tickets below ~R$ 200 (and R$ 0.99 promo is better below ~R$ 100).
- Caps are irrelevant at this ticket size.
- Free Pix (InfinitePay, PagBank promo, possibly Ton/Stone) is the cheapest, but the PagBank one expires and the others conflict across sources.

### Gaps

- No official page read for Mercado Pago, Pagar.me detail, Iugu, Cielo, Getnet, Rede, Ton, Nubank PJ (checkout), PicPay (percentages).
- Pix Automático fees found only for Efí (R$ 3.50); none found for Mercado Pago, Asaas, Pagar.me, Iugu.
- Pix settlement time not stated for Asaas, Efí, Iugu, Pagar.me.

## 2. Credit card à vista — fee and settlement options

### Takeaway

Cheapest published online à vista rates: Ton/Stone/Pagar.me-secondary/PicPay ≈ 3.19%, Asaas 2.99% + R$ 0.49 (1.99% promo), Iugu 3.34% + R$ 0.40, Efí 3.49%. Mercado Pago is the most expensive of the mainstream options at fast settlement (≈ 4.98–4.99% na hora, ≈ 4.49% 14 dias, ≈ 3.98–3.99% 30 dias); its 30-day rate is close to the others' standard rate, but they usually settle faster.

### Cited Findings

- **Mercado Pago** (Checkout Pro, Transparente, link, same rates): na hora 4.98% (Negócios Financeiros, 21 May 2026) / 4.99% (Marreira Digital, "Sep 2026") — DISCREPANCY of 0.01 pp; 14 dias 4.49%; 30 dias 3.98% / 3.99%. Debit "virtual Caixa" 3.99% na hora — [Negócios Financeiros](https://www.negociosfinanceiros.com/taxas-mercado-pago-checkout-transparente-como-funcionam/), [Marreira Digital](https://marreiradigital.com.br/calculadora-mercadopago/), [InfinitePay blog snippet](https://www.infinitepay.io/blog/pix-com-cartao-de-credito). iDinheiro (2 Jul 2026) lists MP link 1x at 3.99% with same day/14/30 days — probably the 30-day rate quoted without the option.
- **PagBank** Link de Pagamento: 5-day receiving plan 4.20% standard (0% Visa/Mastercard promo for first 30 days or R$ 5,000 TPV; 4.20% other brands) — [PagBank FAQ](https://faq.pagbank.com.br/duvida/quais-sao-as-taxas-para-vender-com-link-de-pagamento/1929). 14-day: 3.97% + R$ 0.00 (search snippet of same FAQ). Other secondary sources: 4.99% + R$ 0.40 per transaction (Máquina de Cartão Boa, link), and maquininha table 4.99% instant / 3.99% 14d / 3.19% 30d — [Máquina de Cartão Boa](https://maquinadecartaoboa.com/link-de-pagamento-pagseguro/). DISCREPANCY: PagBank online 4.20% vs 4.99%; unclear which applies to a new account in Oct 2026.
- **Pagar.me**: 4.19% (pagar.me/precos, D+1) — [pagar.me/precos](https://pagar.me/precos); 3.19% (Mind Group, Jul 2026) — [Mind Group](https://mindconsulting.com.br/2026/07/gateways-pagamento-online-brasil-comparativo-2026/); 4.39% (Plano à Vista) or 5.59% (Plano Parcelado) + R$ 0.99 — [Chargefy snippet](https://chargefy.io/alternativas/pagarme). THREE-WAY DISCREPANCY; Stone/Pagar.me link 3.19% with 1/14/30 days per [iDinheiro](https://www.idinheiro.com.br/negocios/melhores-links-de-pagamento/).
- **Stripe Brasil**: 3.99% + R$ 0.39 domestic cards; 2% international — [stripe.com/br/pricing](https://stripe.com/br/pricing). D+2 settlement per [Mind Group](https://mindconsulting.com.br/2026/07/gateways-pagamento-online-brasil-comparativo-2026/) (secondary).
- **Asaas**: 2.99% + R$ 0.49 standard; 1.99% + R$ 0.49 promo — [asaas.com/precos-e-taxas](https://www.asaas.com/precos-e-taxas). Settlement D+2 per Mind Group (secondary; official summary did not state it; Asaas's published norm is D+30 for credit with anticipation at 1.25% a.m., unverified here).
- **Efí Bank**: 3.49% à vista — [sejaefi.com.br/tarifas](https://sejaefi.com.br/tarifas).
- **InfinitePay**: 3.15% (D+1, up to R$ 20k/month) → 2.69% (>R$ 80k); instant 5.99% — [infinitepay.io/taxas](https://www.infinitepay.io/taxas); BUT iDinheiro lists link 1x at 4.20% with same-day/1-day — DISCREPANCY (likely maquininha vs link tables).
- **Iugu**: 3.34% + R$ 0.40; "from 2.49%" negotiated — [Iugu via search snippet](https://www.iugu.com/blog/pix-na-iugu), [Mind Group](https://mindconsulting.com.br/2026/07/gateways-pagamento-online-brasil-comparativo-2026/).
- **PicPay** link: 3.19% (secondary, snippet) vs 3.49% (iDinheiro, 2 Jul 2026; "same day/14/30 days") — DISCREPANCY; official help page gives no number — [iDinheiro](https://www.idinheiro.com.br/negocios/melhores-links-de-pagamento/).
- **Ton**: 3.19%, 14–30 days; **Stone** 3.19%, 1/14/30 days; **Getnet** 3.50%, 30 days; **Nubank** 4.20%, 1 business day; **SumUp** 5.99% — [iDinheiro](https://www.idinheiro.com.br/negocios/melhores-links-de-pagamento/).
- **Cielo / Rede**: no published e-commerce table; Cielo maquininha 4.30% (up to R$ 15k/month), 3.45% above; Getnet lowest à vista 2.69% (high-volume maquininha); Rede and Stone "price case by case" — maquininha figures, not online — [Calculadora de Taxas](https://www.calculadoradetaxas.com.br/cielo), [Calculadora de Taxas Getnet](https://www.calculadoradetaxas.com.br/getnet).

### Inferences

- A fair planning range for a small merchant: 3.2%–4.2% at "standard" fast settlement; Mercado Pago na hora ≈ 5%.
- Settlement choice matters most at Mercado Pago (≈ 1 pp between na hora and 30 dias); for others the published rate is tied to D+1/D+2 or a single option.

### Gaps

- Official online price of PagBank (current), Pagar.me (current), InfinitePay link, Cielo/Rede/Getnet e-commerce not verified.
- Rates for D+30 at providers other than Mercado Pago not found.

## 3. Parcelado (2–6x, 7–12x), interest bearer, antecipação

### Takeaway

Merchant-absorbed installments are expensive everywhere: roughly 6–9% at 2–3x and 15–21% at 12x. Mercado Pago "parcelado vendedor" adds a per-instalment cost (2.03% at 2x → 14.80% at 12x) on top of the settlement-term fee; Asaas, Efí and PicPay publish tiered percentages, with Asaas cheapest on paper.

### Cited Findings

- **Mercado Pago**: two modes — "parcelado vendedor" (merchant absorbs, shopper pays no interest) and "parcelado comprador" (cost passed to shopper). Installment cost 2x 2.03%, 3x 4.06%, 4x–12x from 6.09% up to 14.80%, added to the settlement-term fee — [Marreira Digital](https://marreiradigital.com.br/calculadora-mercadopago/), [MP blog (search snippet)](https://www.mercadopago.com.br/blog/oferecer-parcelamento-sem-juros-margem-de-lucro). iDinheiro: 2x 4.59%, 12x 17.28% for MP link — DISCREPANCY with additive model (additive 12x at 30 days = 14.80 + 3.99 = 18.79%) — [iDinheiro](https://www.idinheiro.com.br/negocios/melhores-links-de-pagamento/).
- **PagBank** link: 2x 8.52%, 12x 21.20% standard (5-day plan); promo 2x 6.58%, 12x 13.74% (Visa/Mastercard; 8.31%/15.16% other brands), only first 30 days/R$ 5,000 TPV — [PagBank FAQ](https://faq.pagbank.com.br/duvida/quais-sao-as-taxas-para-vender-com-link-de-pagamento/1929). Another table: parcelado 5.59% instant / 4.59% 14d / 3.79% 30d (maquininha, [search snippet](https://www.calculadoradetaxas.com.br/pagseguro/taxas)).
- **Asaas**: 2–6x 3.49% + R$ 0.49 (promo 2.49%); 7–12x 3.99% + R$ 0.49 (promo 2.99%); 13–21x 4.29% (promo 3.29%); antecipação credit 1.25% a.m.; boleto antecipação from 5.79% a.m. — [asaas.com/precos-e-taxas](https://www.asaas.com/precos-e-taxas).
- **Efí**: 2–6x 3.99%; 7–12x 4.39%; antecipação 1.29% per anticipated parcel (older snippet: 3.49% + 1.29% per parcel anticipated up to 12x — DISCREPANCY) — [sejaefi.com.br/tarifas](https://sejaefi.com.br/tarifas).
- **Pagar.me**: 2–12x 8.19%–25.29% (Plano à Vista) or 8.59%–21.59% (Plano Parcelado) + R$ 0.99; antecipação = per-transaction fee + % per parcel — [Chargefy snippet](https://chargefy.io/alternativas/pagarme).
- **PicPay**: 2–6x 4.80%, 7–12x 5.10% (secondary snippet, perhaps per-instalment style) vs iDinheiro 2x 6.95%, 12x 16.45% — DISCREPANCY — [iDinheiro](https://www.idinheiro.com.br/negocios/melhores-links-de-pagamento/).
- **Ton/Stone** 2x 5.59%, 12x 15.99%; **Getnet** 2x 6.09%, 12x 16.59%; **Nubank** 2x 6.09%, 12x 16.53%; **InfinitePay** 2x 6.09%, 12x 16.66% — [iDinheiro, 2 Jul 2026](https://www.idinheiro.com.br/negocios/melhores-links-de-pagamento/). InfinitePay's own page: 12x 12.40% (D+1, <R$ 20k) to 18.79% instant — [infinitepay.io/taxas](https://www.infinitepay.io/taxas).
- **Stripe**: installment pricing not detailed on pricing page — [stripe.com/br/pricing](https://stripe.com/br/pricing).
- **Iugu, Cielo, Rede**: no installment rates found.

### Inferences

- With a R$ 40–120 average ticket and Pix-first shoppers, installment fees apply to a minority of orders; default to shopper-pays-interest or limit installments where the provider allows.

### Gaps

- 3x rate not published separately by most providers (see §6 for the proxies used).
- Who bears interest: only Mercado Pago explicitly documents both modes in what I read; others not verified.

## 4. Debit, boleto, other fees (monthly, setup, refund/chargeback, withdrawal)

### Takeaway

No major provider charges monthly or setup fees for link/API accounts (Asaas, PicPay confirmed). Boleto is R$ 1.99–3.99 per paid slip. Chargebacks are only published at Stripe (R$ 55). Withdrawals are free to own bank at some (Mercado Pago, InfinitePay Pix) but R$ 5 TED at Asaas/Efí.

### Cited Findings

- Boleto: Mercado Pago R$ 3.49 (3-day release) — [Marreira Digital](https://marreiradigital.com.br/calculadora-mercadopago/); Efí R$ 3.45 paid (issue/cancel free) — [Efí](https://sejaefi.com.br/tarifas); Stripe R$ 3.45 — [Stripe](https://stripe.com/br/pricing); Asaas R$ 1.99 (promo R$ 0.99 for 3 months) — [Asaas](https://www.asaas.com/precos-e-taxas); Iugu R$ 2.19 — [Iugu snippet](https://www.iugu.com/blog/bolepix); PagBank R$ 3.99, 2 business days (maquininha-era snippet) — [search result](https://www.calculadoradetaxas.com.br/pagseguro). Range R$ 1.99–3.49 "most providers" — [Mind Group](https://mindconsulting.com.br/2026/07/gateways-pagamento-online-brasil-comparativo-2026/).
- Debit online: Asaas R$ 0.35 + 1.89%; Mercado Pago 3.99% (virtual Caixa debit); InfinitePay 1.37% (D+1) to 2.79% (instant) in the page I fetched; PagBank link does NOT accept debit — [Asaas](https://www.asaas.com/precos-e-taxas), [Marreira Digital](https://marreiradigital.com.br/calculadora-mercadopago/), [InfinitePay](https://www.infinitepay.io/taxas), [PagBank table](https://www.calculadoradetaxas.com.br/pagseguro/taxas).
- Monthly/setup fees: Asaas none ("sem mensalidade nem abertura") — [Asaas](https://www.asaas.com/precos-e-taxas); PicPay link none — [PicPay help](https://meajuda.picpay.com/hc/pt-br/articles/43844947885075-O-link-de-pagamento-do-PicPay-tem-mensalidade-ou-taxas-de-ades%C3%A3o-Quais-s%C3%A3o-as-taxas-aplicadas); Efí no maintenance fee listed (not confirmed absent); Mind Group: no monthly minimums for most mid-market gateways.
- Chargeback/dispute: Stripe R$ 55 per dispute received, R$ 55 per manual response (refunded if won), Smart Disputes 30% of contested amount if won; refunds free for most domestic methods — [Stripe](https://stripe.com/br/pricing). Others: not found.
- Withdrawals: Asaas TED R$ 5.00; "national withdrawals" R$ 10.00 + 3.5% IOF; card withdrawals R$ 8.60 — [Asaas](https://www.asaas.com/precos-e-taxas); Efí TED R$ 5.00 (same-bank TED above R$ 300 free) — [Efí](https://sejaefi.com.br/tarifas); Mercado Pago Pix transfers free — [Nuvemshop](https://www.nuvemshop.com.br/blog/pix-pessoa-juridica/).
- Pix refunds: Iugu up to 90 days, no fee — [Iugu](https://www.iugu.com/blog/pix-na-iugu).
- Pix Automático: Efí R$ 3.50 per settled Pix — [Efí](https://sejaefi.com.br/tarifas).

### Inferences

- Fixed-fee items (R$ 5 TED, R$ 55 chargeback) matter more than % for tiny tickets; prefer providers where payout to the merchant's bank by Pix is free.

### Gaps

- Chargeback fees for Mercado Pago, PagBank, Pagar.me, Asaas, Efí, Iugu not found; no refund fee info except Stripe/Iugu.
- Monthly fees for Pagar.me, Iugu, Cielo, Rede, Getnet e-commerce not confirmed.
- Debit online not found for most providers.

## 5. Promotional rates vs standard; negotiation thresholds

### Takeaway

Promos are real but narrow: PagBank (0% Pix and Visa/Mastercard à vista, first 30 days or R$ 5k TPV), Asaas (3 months, about 1 pp lower on card, R$ 1 lower on Pix/boleto). InfinitePay's rates are TPV-tiered; Cielo/Stone/Rede/Iugu/Getnet negotiate.

### Cited Findings

- PagBank promo: first 30 days or until R$ 5,000 TPV, new Merchant-profile acquiring clients, 5-day receiving plan; campaign since 8 Apr 2026 without end date, revocable without notice — [PagBank FAQ](https://faq.pagbank.com.br/duvida/quais-sao-as-taxas-para-vender-com-link-de-pagamento/1929).
- Asaas promo: first 3 months (Pix/boleto R$ 0.99; credit 1.99% / 2.49% / 2.99% / 3.29% + R$ 0.49) — [Asaas](https://www.asaas.com/precos-e-taxas).
- InfinitePay tiers by monthly TPV (up to R$ 20k, 20–40k, 40–80k, >80k): à vista D+1 3.15% / 2.89% / 2.79% / 2.69%; 12x D+1 12.40% / 10.12% / 9.56% / 8.99% — [InfinitePay](https://www.infinitepay.io/taxas).
- Mercado Pago: sellers above ~R$ 15k/month get reduced Pix transfer fee (0.49%, per Nuvemshop) and progressive pricing exists for Point — [Nuvemshop](https://www.nuvemshop.com.br/blog/pix-pessoa-juridica/), [MP Point progressive](https://www.mercadopago.com.br/blog/taxa-progressiva-point-mercado-pago).
- Cielo maquininha model 1 (up to R$ 15k/month): 4.30% à vista; model 2 above: 3.45% — [Calculadora de Taxas Cielo](https://www.calculadoradetaxas.com.br/cielo). Cielo, Stone, Adyen "negotiable by volume" — [Mind Group](https://mindconsulting.com.br/2026/07/gateways-pagamento-online-brasil-comparativo-2026/). Sebrae: merchants who negotiate pay about 0.4 pp less — [Calculadora de Taxas search summary](https://www.calculadoradetaxas.com.br/marcas/cielo-vs-getnet).
- Iugu "from 2.49%" is a negotiated floor vs 3.34% + R$ 0.40 list — [Mind Group](https://mindconsulting.com.br/2026/07/gateways-pagamento-online-brasil-comparativo-2026/).

### Inferences

- Do not quote promo rates in Venduá copy; use standard rates and a "from" range.

### Gaps

- No exact TPV thresholds found for Mercado Pago online, Pagar.me, Iugu, Stripe.

## 6. Illustrative cost per order (R$, computed from the rates above)

### Takeaway

At R$ 60 Pix costs ≈ R$ 0.00–0.71 almost everywhere (R$ 1.70–1.99 at Pagar.me secondary figure/Asaas standard). Credit à vista R$ 60 costs ≈ R$ 1.68–3.59; Mercado Pago na hora ≈ R$ 2.99, 30 dias ≈ R$ 2.39. R$ 300 in 3x costs ≈ R$ 8–27 depending on provider, Mercado Pago ≈ R$ 24–27 (estimate from additive model, see caveats).

### Cited Findings

Formula: fee = value × % + fixed. Rates and sources are those in §1–§3. "Std" = standard, "Promo" = promotional.

| Provider (rate basis)                                                 | (a) R$ 60 Pix     | (b) R$ 60 credit, fastest settlement | (c) R$ 60 credit, 30 days       | (d) R$ 300 card 3x (merchant pays)                                                                              |
| --------------------------------------------------------------------- | ----------------- | ------------------------------------ | ------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| Mercado Pago (0.99%; na hora 4.98%; 30d 3.98%; 3x = 4.06% + term fee) | 0.59              | 2.99 (D0)                            | 2.39                            | 27.12 (D0) / 25.65 (14d) / 24.15 (30d) — estimate: 3x 4.06% added to term fee; DISCREPANCY with iDinheiro table |
| PagBank link std (0.99%; 4.20%)                                       | 0.59 (promo 0.00) | 2.52 (4.20%; 3.97% at 14d = 2.38)    | n/a (no 30-day link rate found) | n/a (3x not found; 2x std 8.52% = 25.56 as proxy)                                                               |
| Pagar.me — (i) official page 4.19%/0.99%                              | 0.59              | 2.51                                 | n/a                             | n/a                                                                                                             |
| Pagar.me — (ii) Mind Group 3.19%                                      | n/a               | 1.91                                 | n/a                             | n/a                                                                                                             |
| Pagar.me — (iii) secondary 1.19% + 0.99; 4.39% + 0.99                 | 1.70              | 3.62                                 | n/a                             | n/a (2–12x range 8.19%–25.29%)                                                                                  |
| Stripe (1.19% invite-only; 3.99% + 0.39)                              | 0.71              | 2.78                                 | n/a                             | n/a (installments not published)                                                                                |
| Asaas std (R$ 1.99; 2.99% + 0.49; 2–6x 3.49% + 0.49)                  | 1.99              | 2.28                                 | n/a (check D+30 default)        | 10.96                                                                                                           |
| Asaas promo (R$ 0.99; 1.99% + 0.49; 2.49% + 0.49)                     | 0.99              | 1.68                                 | n/a                             | 7.96                                                                                                            |
| Efí (1.19%; 3.49%; 2–6x 3.99%)                                        | 0.71              | 2.09                                 | n/a                             | 11.97 (+1.29% per parcel if anticipated)                                                                        |
| InfinitePay (0%; D+1 3.15% / instant 5.99%)                           | 0.00              | 1.89 (D+1) / 3.59 (instant)          | n/a                             | n/a (iDinheiro: 2x 6.09% = 18.27 as proxy)                                                                      |
| Iugu (0.99%; 3.34% + 0.40)                                            | 0.59              | 2.40                                 | n/a                             | n/a                                                                                                             |
| PicPay (0.99%; 3.19%; 2–6x 4.80%)                                     | 0.59              | 1.91 (3.49% = 2.09)                  | n/a                             | 14.40 (iDinheiro 2x 6.95% = 20.85 — DISCREPANCY)                                                                |
| Ton/Stone link (free; 3.19%; 2x 5.59%)                                | 0.00              | 1.91                                 | n/a                             | n/a (2x proxy 16.77)                                                                                            |

Arithmetic checks: 60 × 4.98% = 2.99; 60 × 4.49% = 2.69; 60 × 3.98% = 2.39; 60 × 3.99% + 0.39 = 2.78; 60 × 2.99% + 0.49 = 2.28; 300 × 9.04% = 27.12 (4.98% + 4.06%); 300 × 8.05% = 24.15 (3.99% + 4.06%).

### Inferences

- Mercado Pago is among the most expensive for credit à vista with fast settlement (about R$ 0.5–1.1 more per R$ 60 order than Ton/Stone/PicPay/Asaas/Efí/Iugu), and its Pix is on par (0.99%) with most; it is cheaper than Asaas Pix standard on tickets under R$ 200.
- For Pix-heavy food-delivery merchants, the total difference between providers is mostly in the card slice; Pix is nearly a wash except Asaas flat fee and the free ones.
- Cheapest on paper for the R$ 60 credit: Asaas promo (1.68), InfinitePay D+1 (1.89), PicPay/Ton/Stone (1.91), but several of these figures rest on single secondary sources.

### Gaps

- 3x rates for PagBank, InfinitePay, Ton/Stone, Stripe, Iugu, Pagar.me were not found; proxies from 2x only provide a floor.
- 30-day settlement rates other than Mercado Pago missing (Ton 14–30 d, Getnet 30 d listed with single rate only).
- Cielo, Getnet, Rede, Nubank/Inter/C6 online gateway not computed: no published online rates (Inter Pix QR 0.9% = R$ 0.54 at R$ 60 per unverified summary).
