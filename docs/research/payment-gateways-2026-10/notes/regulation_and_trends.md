# Brazil payments regulation and market trends (2025-2026) relevant to gateway choice for Venduá — as of 2 Oct 2026

Source-quality note: primary sources used where possible (BCB Fórum Pix deck of 26 Mar 2026; BCB Voto 159/2025 text for Res. BCB 522/2025). Many other items come from law-firm, fintech-vendor or news-aggregator pages (marked "secondary"); numbers from vendors (fees, shares) are indicative only. Items "announced, not in force" are labelled NOT YET IN FORCE with dates.

## 1. Pix evolution (Pix Automático, Pix por aproximação, Pix Parcelado/Garantido, cobrança, MED 2.0, 2026 changes)

### Takeaway

Pix Automático is live (since 16 Jun 2025) and growing fast from a small base, with payer-side support mandatory but receiver-side (PSP) support optional, so gateway support is uneven and must be checked per PSP. MED 2.0 (mandatory since 2 Feb 2026) raises the chance that a merchant's incoming Pix is blocked/clawed back after fraud claims; there is no BCB "Pix Parcelado" product (BCB dropped it on 4 Dec 2025), so Pix-based installments are PSP/BNPL-specific credit products.

### Cited Findings

**Pix Automático**

- Launched 16 Jun 2025. All institutions offering transactional accounts to payers must offer it; institutions that serve receivers may choose whether to offer it. Charging payers is prohibited; PSPs may charge receivers (merchants). — [Finsiders / search summary of BCB rules](https://finsidersbrasil.com.br/regulamentacao/bc-publica-novas-regras-para-pix-automatico/) and [Agência Gov, Jun 2025](https://agenciagov.ebc.com.br/noticias/202506/pix-automatico-chega-em-16-de-junho) (secondary; I read only the search snippet for these two, so verify the exact text in the BCB FAQ [bcb.gov.br FAQ participantes](https://www.bcb.gov.br/content/estabilidadefinanceira/pix/pix-automatico-FAQ-participantes.pdf)).
- Flow: single payer authorization (via push notification journey, QR for future payment, QR with immediate payment, post-Pix offer, or Open Finance initiation); payer notified 2-10 days before each debit; payer can revoke any time in bank app; recurrence frequencies weekly to annual; API groups Rec, SolicRec, CobR, PayloadLocationRec, WebhookRec, WebhookCobR. — [Efí technical guide](https://sejaefi.com.br/blog/pix-automatico-guia-tecnico) and [Tecnospeed](https://blog.tecnospeed.com.br/pix-por-aproximacao-pix-automatico/) (both vendor blogs).
- Adoption: BCB dashboard shows ~R$ 568.7 million in Jan 2026 rising to over R$ 1.2 billion in May 2026 (about 2.8-2.9 million payments in May); accumulated R$ 4.5 billion in 2026 to date. Ebanx says 64% of Pix Automático payers are new subscribers of digital services; Ebanx processes ~38% of all Pix Automático transactions. — [Let's Money, Jun 2026](https://www.letsmoney.com.br/noticias/pix-automatico-1-ano-1-bilhao-mes/); [Finsiders, "Um ano depois, Pix Automático ainda não pegou"](https://finsidersbrasil.com.br/pagamentos/pix/um-ano-depois-pix-automatico-ainda-nao-pegou-e-ha-um-motivo); [CartaCapital/Ebanx](https://www.cartacapital.com.br/do-micro-ao-macro/pix-automatico-novos-assinantes-economia-digital-ebanx/). Note: the Finsiders summary I fetched printed "2.87 billion transactions", which is inconsistent with R$ 1.2 bn volume; Let's Money's "2.8 million payments" is the plausible figure.
- Adoption barriers named by Finsiders: explicit consumer opt-in, balance dependency (no overdraft like debit automático), habit, trust in recurring authorizations. — [Finsiders](https://finsidersbrasil.com.br/pagamentos/pix/um-ano-depois-pix-automatico-ainda-nao-pegou-e-ha-um-motivo)
- Merchant fees vary by PSP (no BCB-set price). Indicative vendor figures: Efí R$ 3.50 flat per Pix Automático received; one source cites 0.22%-0.35% range; Tecnospeed cites ~0.4%-1.2%; Asaas R$ 0.99/R$ 1.99 per Pix charge (not Automático-specific). — [Kataly/Efí/Asaas comparison via search](https://sejaefi.com.br/blog/melhor-gateway-de-pagamento), [Tecnospeed](https://blog.tecnospeed.com.br/pix-por-aproximacao-pix-automatico/). Figures conflict and are vendor-reported; treat as unverified.
- Mercado Pago markets Pix Automático for subscriptions; a developer-issue thread notes its /preapproval and /preapproval_plan endpoints route to a hosted subscription checkout and that enabling a receiver API for Pix Automático needs MP support. — [Mercado Pago blog](https://www.mercadopago.com.br/blog/pix-automatico-gestao-assinaturas-receita-recorrente); [GitHub issue #603 (user report, low reliability)](https://github.com/Georlan/sistema-gourmet-bistro/issues/603). Other PSPs documenting Pix Automático APIs: Efí, PagBrasil. — [PagBrasil](https://www.pagbrasil.com/pt-br/blog/pix/api-pix-automatico-da-pagbrasil-guia-de-integracao-para-desenvolvedores/)
- Pix Automático on salary accounts: authorized by CMN Res. 5251/2025, BCB Res. 505/2025 and Lei 15.252/2025; BCB Fórum plan said Oct 2026, but Res. BCB 587/2026 (18 Sep 2026) sets salary-account Pix Automático rules from 1 Jul 2027 (NOT YET IN FORCE). — [BCB Fórum Pix 26 Mar 2026](https://www.bcb.gov.br/content/estabilidadefinanceira/pix/Forum_Pix_Plenaria/20260326-Forum_Pix.pdf); [Cescon Barrieu on Res. 587/2026](https://cesconbarrieu.com.br/resolucao-bcb-no-587-2026-novas-obrigacoes-e-impactos-para-participantes-do-pix/)
- Res. 587/2026 also obliges Pix participants to monitor and prevent excessive Pix Automático authorization requests. — [Cescon Barrieu](https://cesconbarrieu.com.br/resolucao-bcb-no-587-2026-novas-obrigacoes-e-impactos-para-participantes-do-pix/)

**Pix por aproximação (NFC) and Jornada sem Redirecionamento (JSR)**

- Pix por aproximação launched 28 Feb 2025 with fixed R$ 500 per-transaction cap; BCB IN 746 (Jun 2026) removes the fixed cap from 1 Oct 2026 — limits then follow each payer's institution limits. The cap removal also applies to JSR payments via Open Finance (IN 512 amendment on the Fórum Pix agenda). — [ADVFN, Jun 2026](https://br.advfn.com/jornal/2026/06/pix-por-aproximacao-tera-limite-flexivel-a-partir-de-outubro-banco-central-amplia-autonomia-dos-usuarios) (secondary); [BCB Fórum Pix deck: "IN 512: Limites Jornada Sem Redirecionamento e Pix por aproximação"](https://www.bcb.gov.br/content/estabilidadefinanceira/pix/Forum_Pix_Plenaria/20260326-Forum_Pix.pdf)
- Rules: Res. BCB 406/407 (2 Aug 2024). All Pix participants required to offer it by 2 Jan 2026 (Tecnospeed says "April 2026"; sources differ). — [Demarest](https://www.demarest.com.br/bc-regulamenta-pix-por-aproximacao-e-altera-regras-para-instituicoes-de-pagamento/); [Tecnospeed](https://blog.tecnospeed.com.br/pix-por-aproximacao-pix-automatico/)
- Works only on Android (Google Wallet/Samsung Wallet) as of mid-2026; Apple restricts NFC on iPhone. CADE investigation opened Apr 2025; Apple defence 13 Feb 2026; Apple signalled in Jun 2026 willingness to agree to open NFC for Pix without fees; no settlement finalized as of 12 Sep 2026. — [Let's Money](https://www.letsmoney.com.br/noticias/apple-cade-pix-aproximacao-nfc-iphone/); [Payment Expert, 10 Jun 2026](https://paymentexpert.com/2026/06/10/apple-iphone-nfc-access-pix/)
- JSR: mandatory for Pix account-holding institutions from 6 Feb 2026 (Res. BCB 541/2025); pilot v2.2.0 (PJ, desktop, Pix Automático) 6 Feb-21 Apr 2026; open to the general market from 22 Apr 2026; 20 pilot institutions incl. Itaú, Bradesco, BB, Nubank, Mercado Pago, PagSeguro, PicPay. — [Pluggy, Open Finance 2026](https://www.pluggy.ai/blog/open-finance-2026-novidades) (secondary; Res. number not verified against bcb normativos).

**Pix Parcelado / Pix Garantido**

- BCB decided (reported 4 Dec 2025) NOT to regulate Pix Parcelado after promising rules for Sep then Nov 2025. Institutions may offer their own solutions; the name "Pix Parcelado"/"Pix Crédito" is banned under the Pix brand manual, "Pix no crédito" is allowed. — [Finsiders, exclusive](https://finsidersbrasil.com.br/pagamentos/pix/exclusivo-bc-desiste-de-regulamentar-pix-parcelado-mas-veta-uso-do-nome/)
- Market offers exist anyway (merchant receives full amount up-front; payer pays installments with interest/IOF; CET commonly cited at 5%-9% a month): Nubank, Mercado Pago, PicPay, Itaú, Santander, Bradesco, BB, Inter, InfinitePay, and BNPL Pagaleve. — [Serasa list](https://www.serasa.com.br/limpa-nome-online/blog/bancos-pix-parcelado/); [Ecarts](https://ecarts.com.br/financas/pix-parcelado-2026-como-funciona-quais-bancos/) (consumer-finance blogs, low rigour on rates).
- "Pix em Garantia" (Pix as credit collateral) is a separate 2027 BCB agenda item. — [BCB Fórum Pix](https://www.bcb.gov.br/content/estabilidadefinanceira/pix/Forum_Pix_Plenaria/20260326-Forum_Pix.pdf)

**Pix Cobrança / cobrança híbrida / duplicata**

- Pix Cobrança (dynamic QR, with vencimento) is established; dynamic QR codes exceeded 150 million monthly transactions in 2025. — [Matera](https://www.matera.com/br/blog/entenda-agenda-evolutiva-do-pix/) (secondary).
- Cobrança híbrida (boleto + Pix QR in one document): BCB plan was production Oct 2026; Res. BCB 587/2026 (18 Sep 2026) puts hybrid billing, with a 24-hour refund requirement for duplicate payment, in force 1 Feb 2027 (NOT YET IN FORCE). — [BCB Fórum Pix](https://www.bcb.gov.br/content/estabilidadefinanceira/pix/Forum_Pix_Plenaria/20260326-Forum_Pix.pdf); [Cescon Barrieu](https://cesconbarrieu.com.br/resolucao-bcb-no-587-2026-novas-obrigacoes-e-impactos-para-participantes-do-pix/). Conflict: Matera still says Oct 2026.
- "Duplicata no Pix" continues into 2027. — [BCB Fórum Pix](https://www.bcb.gov.br/content/estabilidadefinanceira/pix/Forum_Pix_Plenaria/20260326-Forum_Pix.pdf)

**MED 2.0 (Mecanismo Especial de Devolução)**

- Created by Res. BCB 493 of 28 Aug 2025. Timeline per BCB: optional use from 25/26 Nov 2025; mandatory for all participants from 2 Feb 2026; 11 May 2026 production phase widening graph depth and switching off the old "Notificação de Infração" endpoint. — [BCB Fórum Pix 26 Mar 2026](https://www.bcb.gov.br/content/estabilidadefinanceira/pix/Forum_Pix_Plenaria/20260326-Forum_Pix.pdf); [Chambers on Res. 493](https://chambers.com/articles/resolu%C3%A7%C3%A3o-bcb-n%C2%BA-493-2025-aperfei%C3%A7oamento-do-mecanismo-especial-de-devolu%C3%A7%C3%A3o-med-do-pix). Matera's "11 May 2026" as MED 2.0 start date is the depth-expansion milestone, not the mandatory date.
- Mechanics: tracks funds through chained accounts (reports of up to five layers), precautionary block while analysed (up to 72 hours reported), refund expected within 11 days of the dispute; covers fraud, coercion or institution error, not buyer's remorse. — [InfoMoney](https://www.infomoney.com.br/minhas-financas/med-2-0-passa-a-ser-obrigatorio-em-todas-as-plataformas-que-oferecem-pix/); [Transfeera](https://transfeera.com/blog/med-pix-2-0/) (secondary).
- Merchant impact: funds that were received and moved onward can be blocked/recovered from the receiver chain; Transfeera advises integrating payment platforms with back-office, fraud detection and team procedures. — [Transfeera](https://transfeera.com/blog/med-pix-2-0/)
- Self-service MED in apps planned for production Oct 2026; criteria for "fundada suspeita de fraude" and "suspeita de fraude" planned for 2H 2026. — [BCB Fórum Pix](https://www.bcb.gov.br/content/estabilidadefinanceira/pix/Forum_Pix_Plenaria/20260326-Forum_Pix.pdf)
- Res. BCB 587/2026 (18 Sep 2026): institutions can flag fraud-suspected accounts for up to 5 years (blocking Pix registration/transactions) with 7 days' notice to the user; participants may appeal BCB decisions within 10 business days; security incident communication duties from 1 Feb 2027. — [Cescon Barrieu](https://cesconbarrieu.com.br/resolucao-bcb-no-587-2026-novas-obrigacoes-e-impactos-para-participantes-do-pix/)

**Other 2026-27 Pix changes**

- Pix Saque/Troco rule changes 1H 2026; inappropriate-message rules 2H 2026; R$ 5 million minimum capital/net equity for Pix participants verified from Jan 2026 (non-compliant lose Pix participant status). — [BCB Fórum Pix](https://www.bcb.gov.br/content/estabilidadefinanceira/pix/Forum_Pix_Plenaria/20260326-Forum_Pix.pdf)
- Res. BCB 587/2026 lets BCB exempt institutions with >500k active accounts from mandatory Pix participation (if no technical/economic justification) — [Jornal de Brasília](https://jornaldebrasilia.com.br/noticias/economia/banco-central-muda-regras-do-pix-para-ampliar-seguranca-e-funcionalidades/) (secondary).
- Pix outages: a widespread instability on 19 Jan 2026 and another on 23 Aug 2026 (BCB said systems "promptly restored"). — [TechTudo](https://www.techtudo.com.br/noticias/2026/03/pix-fora-do-ar-hoje-18-usuarios-reclamam-de-falhas-no-pagamento-edapps.ghtml) (search snippet); [CNN Brasil, 23 Aug 2026](https://www.cnnbrasil.com.br/economia/money/macroeconomia/pix-instabilidade-hoje-23-agosto-2026/) (snippet only; I did not open these).

### Inferences

- A Pix Automático monthly plan for Venduá is feasible, but Mercado Pago's receiver-side API availability must be confirmed; a fallback is Pix Cobrança with manual monthly QR/reminder, or a second PSP (Efí/Asaas/PagBrasil-class) used for platform billing only.
- Because there is no standard "Pix Parcelado", any parcelamento-via-Pix at checkout is a PSP/BNPL product with its own fees, contract and risks; it should not be assumed portable across gateways.
- Per-merchant PSP accounts means MED 2.0 blocks fall on the merchant's PSP account, not on Venduá; the platform's role is to surface blocked/refunded Pix statuses and not treat Pix "approved" as final.
- With JSR live since Apr 2026 and the R$ 500 cap lifted 1 Oct 2026, Pix initiated by Open Finance without redirect becomes viable for higher tickets; availability depends on the PSP exposing JSR to the checkout.

### Gaps

- No primary-source statistics on which PSPs support Pix Automático as receiver (BCB participant list not located); fee figures are vendor claims.
- Exact BCB text of Res. 587/2026 and IN 746/2026 not read directly (only secondary summaries).
- Whether Mercado Pago Brazil exposes a public Pix Automático receiver API to marketplace OAuth sellers: not confirmed.
- "Pix Garantido" as a named product: I found only that "Pix Parcelado/Pix Garantido" was a planned BCB item that was dropped; no separate status source.
- The date for Pix por aproximação mandatory adoption conflicts (2 Jan 2026 vs Apr 2026).

## 2. Payment method shares in Brazilian e-commerce (2025-2026), installments, ticket size, food delivery

### Takeaway

Pix has become the most-used e-commerce method by order count (about half of orders on Nuvemshop, the best data found), but credit card still leads in value and in higher-ticket purchases, and installments (especially long ones, 10-12x) are growing. Boleto is nearly negligible (0.9% on Nuvemshop). I found no reliable food-delivery-specific method share.

### Cited Findings

- Nuvemshop data (Jun-Aug 2026): Pix about half of transactions, up ~50% vs Jun-Aug 2025; avg ticket Pix R$ 233.80 vs credit R$ 339.97; boleto share fell 1.4% to 0.9%; single-payment (à vista) credit share fell 60.7% to 57.2%; 10-installment revenue +54%; 12-installment ticket R$ 825 to R$ 1,003; 52% of merchants offer Pix discounts, 43% offer zero-interest installments. — [E-Commerce Brasil](https://www.ecommercebrasil.com.br/noticias/pix-ou-cartao-dados-mostram-como-o-brasileiro-paga-no-comercio-eletronico) (page extract; sample is Nuvemshop stores only; the date label of the extract is not fully certain).
- NuvemCommerce 2026: Pix 49% of online transactions in 2025 (35% in 2022), credit 45%; Radar D2C May 2026: Pix 50.2% of orders (+2.1 pp YoY); Pix moves over 40% of D2C e-commerce GMV. — [Nuvemshop blog, updated 30 Sep 2026](https://www.nuvemshop.com.br/blog/pix-ecommerce/); [Nuvemshop meios de pagamento](https://www.nuvemshop.com.br/blog/nuvemcast-meios-de-pagamento/)
- Whole-economy view (2025, Colink/Let's Money): electronic payments R$ 4.34 trillion; Pix (P2B/consumer) R$ 3.5 trillion (44.6%), credit cards R$ 3.06 trillion (39%); Pix avg ticket R$ 442 vs credit R$ 144; embedded financing/BNPL adoption in e-commerce rose from 45.8% to 62.7% in 2025. Note: the 44.6%/39% shares do not sum consistently with the R$ amounts quoted in the extract; use with caution. — [Let's Money](https://www.letsmoney.com.br/noticias/varejo-finance-report-2026-pix-credito-checkout)
- ABECS Q1 2026: cards R$ 1.1 trillion (+8.3%): credit R$ 810.2 bn (+12.8%), debit R$ 236 bn (-2.4%), prepaid R$ 94.5 bn (+1%); 11.7 bn transactions (+3%). — [Mercado & Consumo, 11 May 2026](https://mercadoeconsumo.com.br/11/05/2026/meios-de-pagamento/uso-de-cartoes-no-brasil-cresce-83-e-movimenta-r-11-trilhao-no-1o-trimestre/); [Panorama Abecs](https://panoramaabecs.com.br/numeros-do-setor-balanco-cartoes-1t26-crescimento/)
- ABECS Q1 2026 online (non-present) card volume R$ 310.5 bn (+18.8%): credit R$ 301.3 bn, debit R$ 4.9 bn (+16.9%), prepaid R$ 4.3 bn. — [Panorama Abecs, 15 May 2026](https://panoramaabecs.com.br/compras-nao-presenciais-crescimento-1t26/)
- Contactless/NFC: about three quarters of card payments by aproximação (ABECS); NFC payments R$ 1 trillion in 1H26. — [Finsiders](https://finsidersbrasil.com.br/pagamentos/abecs-pagamentos-aproximacao-cartoes-brasil/); [Mobile Time, 19 Aug 2026](https://www.mobiletime.com.br/noticias/19/08/2026/abecs-pgtos-nfc-1s26/)
- iFood: accepts card, Pix, vale-refeição/alimentação, cash, iFood Card; Pix must be paid within 5 minutes; from early Jun 2026 iFood rolling out split payment (two methods, or two payers, in one order). — [iFood help](https://institucional.ifood.com.br/ajuda/pagamentos-e-carteira-ifood/); [Canaltech](https://canaltech.com.br/apps/ifood-permite-dividir-o-pagamento-de-pedidos-com-outra-pessoa/)
- Food voucher (VA/VR) rules (Decreto 12.712/2025): fee cap to merchants of 3.6% with interchange up to 2% since Feb 2026; settlement in 15 business days (was 30); operators with 500k+ users opened to competitor terminals from May 2026; full interoperability by Nov 2026. — [NSC Total](https://www.nsctotal.com.br/economia/vale-alimentacao-e-refeicao-nova-regra-permite-cartoes-em-qualquer-maquininha-a-partir-de-novembro) (secondary). Applies mainly to in-person terminals; online VR acceptance not covered in my sources.

### Inferences

- For small food/delivery merchants (low tickets, frequent orders), Pix should be the default method; credit parcelado matters more in small retail with higher tickets (Nuvemshop: credit ticket ~45% above Pix).
- Merchants will expect a Pix discount option and sem-juros installments (parcelamento sem juros) as per-store configuration; boleto can be deprioritised.
- Nuvemshop's base (D2C retail) is not representative of food delivery; treat as upper bound for card/instalment relevance.

### Gaps

- No Ebit/NielsenIQ Webshoppers 2025/2026 payment-share table was retrieved (only secondary mentions).
- No source with food-delivery-specific method shares (iFood, Anota AI, etc.) or by-ticket-band splits beyond Pix vs credit ticket averages.
- Share of interest-free vs with-interest installments nationally not found.

## 3. Regulation affecting platforms that route payments (subcredenciadores, IP authorization, BaaS, receivables registry)

### Takeaway

Platforms that take no custody of funds and let each merchant's PSP settle directly are outside BCB's IP perimeter by design; but BCB tightened the net around anyone in the payment flow in Sept-Nov 2025 (IP authorization, capital, BaaS rules, centralized settlement for subcredenciadores). Venduá's "no custody, merchant-owned account" model aligns with the direction of travel (ban on bucket accounts); the exposure is if the platform ever receives funds, defines flows, or splits.

### Cited Findings

- Subcredenciador definition (Res. BCB 150/2021): a participant that enables exclusively end-user receivers to accept payment instruments of an arrangement but does not take part in settlement as creditor against the issuer. — [Okai summary](https://okai.com.br/blog/novas-regras-dos-arranjos-de-pagamento-o-que-muda-para-as-credenciadoras); [BCB Voto 159/2025 (primary)](https://normativos.bcb.gov.br/Votos/BCB/2025159/Voto_do_BC_159_2025.pdf)
- Res. BCB 522 (10 Nov 2025, in force on publication) amends Res. 150: all subcredenciadores must join centralized settlement as payers to end-user receivers; arrangement rules must forbid guarantees between participants; the instituidor may not shift responsibility for sub-acquirer risk monitoring onto the credenciador; credenciadores/subcredenciadores may not discriminate issuers (honor-all-cards); chargeback financial liability of participants limited to disputes started within 180 days of authorization (after that, instituidor), and no chargeback where dispute stems from insolvency of the receiver. — [TIInside, 10 Nov 2025](https://tiinside.com.br/10/11/2025/bcb-aprimora-regulamentacao-de-arranjos-de-pagamento/); [BCB Voto 159/2025 draft text, art. 35-E to 35-G and art. 3](https://normativos.bcb.gov.br/Votos/BCB/2025159/Voto_do_BC_159_2025.pdf)
- Transition: arrangement instituidores have up to 180 days from entry into force to file rule changes and to ensure all subcredenciadores are in centralized settlement (about May 2026); instituidores must temporarily suspend capture of new transactions from non-compliant subcredenciadores. — [BCB Voto 159/2025, art. 3, §2](https://normativos.bcb.gov.br/Votos/BCB/2025159/Voto_do_BC_159_2025.pdf) (draft text attached to the Voto; confirm final wording in Res. 522). Settlement also required to be shared with registry entities for receivables reconciliation (art. 30 §§14-17 of Annex I to Res. 150).
- Registry of card receivables: card receivables subject to mandatory registration with BCB-authorized registradoras; BCB cites fragile monitoring of cessions and requires settlement information to flow to registradoras. — [BCB Voto 159/2025](https://normativos.bcb.gov.br/Votos/BCB/2025159/Voto_do_BC_159_2025.pdf). Practical effect for merchants: sub-acquirers/PSPs must honour registered-receivable liens (not detailed in my sources).
- 5 Sep 2025 package (Res. BCB 494-498 etc., after the C&M Software hack of 1 Jul 2025, ~R$ 800 million): every IP needs prior authorization; deadline for already-operating institutions to seek authorization moved from Dec 2029 to May 2026 (window 1-31 May 2026); R$ 15k Pix/TED ceiling for unauthorized IPs / PSTI-connected firms; PSTI min capital R$ 15 million; new capital methodology (R$ 2m x number of activity categories, plus R$ 5-10m for technology-intensive infrastructure); adaptation by 1 Mar 2026; no coworking/virtual offices as HQ; denied institutions must cease in 30 days. — [Agência Brasil, Sep 2025](https://agenciabrasil.ebc.com.br/economia/noticia/2025-09/bc-endurece-regras-de-seguranca-para-instituicoes-de-pagamento); [Mattos Filho](https://www.mattosfilho.com.br/unico/regras-capital-prudencial/); [Convergência Digital on C&M](https://convergenciadigital.com.br/mercado/banco-central-foi-alvo-do-maior-ataque-hacker-da-historia-do-sistema-financeiro/)
- Enforcement: BCB denied authorization to 8 IPs in Jan-Apr 2026 (6 in all of 2025, 3 in 2024); Galípolo said more than 100 institutions will probably be excluded. — [TJS Auditores, 27 May 2026](http://www.tjsauditores.com.br/2026/05/27/bc-ja-negou-autorizacao-para-oito-instituicoes-de-pagamento-em-2026/)
- C&M Software attack (1 Jul 2025): BCB disconnected C&M; Pix preventively suspended for Transfeera, Soffy, Nuoro Pay, Voluti, Brasil Cash, S3 Bank. — [Finsiders](https://finsidersbrasil.com.br/regulamentacao/em-ataque-a-cm-software-hackers-invadem-conta-de-seis-instituicoes-entre-elas-o-bmp/) (snippet); [Convergência Digital](https://convergenciadigital.com.br/mercado/banco-central-foi-alvo-do-maior-ataque-hacker-da-historia-do-sistema-financeiro/)
- BaaS framework: Resolução Conjunta CMN/BCB 16 of 28 Nov 2025 — client accounts must be at the authorized provider; account pooling ("contas-bolsão") prohibited (also Res. BCB 518/2025); service-taking entity cannot transact or receive client funds in its own account; subcredenciamento is expressly excluded from BaaS (BCB considered Res. 522 enough); existing arrangements to comply by 31 Dec 2026. — [NDM Advogados](https://ndmadvogados.com.br/artigo/guia-completo-banking-as-a-service-bcb/); [Asaas](https://blog.asaas.com/regulamentacao-baas/); [Finsiders](https://finsidersbrasil.com.br/noticias-sobre-fintechs/banking-as-a-service/bc-e-cmn-definem-regras-para-baas-e-nomes-de-instituicoes/)
- Earlier BaaS consultation (CP 108/2024, closed 28 Feb 2025) had proposed excluding marketplaces from the payment flow and requiring single provider; five associations (ABBaaS, Abrevin, Câmara-e.net, Conecta, Zetta) asked to carve subcredenciamento out. — [TIInside, 6 Mar 2025](https://tiinside.com.br/06/03/2025/conecta-manifesta-preocupacao-na-nova-regulamentacao-do-banco-central-sobre-marketplaces-e-subcredenciadores/). Outcome: carve-out obtained (see above).
- "Intermediários no Pix": BCB is defining a regulated model for payment intermediaries/marketplaces in Pix: scope and preliminary model Jan-May 2026, Fórum Pix consultations Jun and Dec 2026, regulation and technical specs (Regulamento, QR standards, DICT/API/SPI catalog) in 2027 (NOT YET IN FORCE). — [BCB Fórum Pix 26 Mar 2026](https://www.bcb.gov.br/content/estabilidadefinanceira/pix/Forum_Pix_Plenaria/20260326-Forum_Pix.pdf). Matera lists "Marketplace Intermediaries — multiple recipient identification" for 2027. — [Matera](https://www.matera.com/br/blog/entenda-agenda-evolutiva-do-pix/). Earlier (undated) BCB ideas: DvP "Entrega contra Pagamento" and multi-seller shopping cart in a single Pix. — [Exame](https://exame.com/future-of-money/banco-central-planeja-pix-internacional-automatico-em-marketplaces/)
- Instituição de Pagamento authorization trigger and the "marketplace exemption": I did not retrieve the text of Res. BCB 80/2021 / Lei 12.865/2013 art. 6 dispositions; see Gaps.

### Inferences

- Model fit: funds going straight from shopper to the merchant's own PSP account (OAuth) means Venduá is neither custodian nor sub-acquirer; this is the cleanest position relative to Res. 522 (subcredenciador settlement duties), the BaaS ban on pooled accounts, and the 2027 Pix intermediary regime.
- If Venduá ever collects an application fee/split through the PSP marketplace feature (e.g., Mercado Pago `marketplace_fee`), legal review is needed on whether that makes it an arrangement participant; MP, as the authorized IP, carries the regulatory role.
- A PSP's regulatory health (IP authorization, May 2026 window, capital) becomes a gateway selection criterion: prefer PSPs that are authorized IPs/banks with clear BCB status; avoid tiny BaaS/PSTI-dependent processors (Pix risk shown by C&M episode).
- Chargeback liability window up to 180 days for participants is now a regulatory baseline; merchant contracts should be checked.

### Gaps

- Official text of Res. BCB 522 not read in final form (only the Voto draft and secondary summaries).
- No source defining when a platform "must" be an IP versus a mere technology provider (Lei 12.865/2013 / Res. BCB 80/2021 / Res. 150 definitions); no explicit "marketplace exemption" text found. Needs a lawyer or direct reading of the normativos.
- Whether BCB 2025-26 rules changed split-payment (repasse a múltiplos recebedores) obligations: not found.
- Card receivables registry (Res. CMN 4.734/BCB 4.? and Circular 3.952/2019 successor) obligations for merchants/platforms: only secondary mentions retrieved.

## 4. Tax reform: split payment of IBS/CBS (LC 214/2025)

### Takeaway

Split payment is delayed and narrow at first: infrastructure and optional B2B use start in 2027 (Pix and boleto/TED/TEF, not cards and not consumer sales), mandatory B2B no earlier than 2028; B2C card retail has no schedule. For a store platform the near-term obligations are fiscal data (document/tax fields) and, if it controls payment, marketplace solidary liability for IBS/CBS when suppliers do not issue invoices.

### Cited Findings

- Legal basis: LC 214/2025 (arts. 32-36); Decree 12.955/2026 (CBS regulation) arts. 28-33 regulate split payment: payment service providers and payment-system institutions segregate and remit CBS at financial settlement; two procedures (standard/public platform nets already-paid debits; others). — [Forvis Mazars on Decree 12.955/2026](https://saladenegocios-br.forvismazars.com/2026/05/06/decreto-n-12-955-regulamentacao-cbs-em-vigor/); [Assertif](https://assertif.com.br/regulamento-cbs-decreto-12955-2026/) (snippets).
- 2026 is a test year: CBS 0.9% and IBS 0.1% symbolic rates, with no mechanism activated in company operations. — [e-auditoria](https://www.e-auditoria.com.br/blog/split-payment-reforma-tributaria-o-que-e-como-funciona/) (secondary).
- On 12 Aug 2026 the IBS Management Committee (CGIBS) said split payment will not be available on 1 Jan 2027; it will start gradually and optional. On 30 Aug 2026 the Receita (Juliano Neves) described infrastructure ready early 2027, voluntary adoption throughout 2027 by payment method, B2B mandatory from 2028. The joint act required by LC 214 art. 35 §2 had not been published as of 31 Aug 2026. — [Algoritimado, 31 Aug 2026](https://algoritimado.com/blogs/noticias/split-payment-2027-implementacao-gradual-art-35-rad-2026-08-31) (secondary blog citing officials).
- First phase scope (reported 14 Sep 2026): 2H 2027; B2B only; TED/TEF, boleto and Pix (static QR, dynamic QR, Pix Automático); excludes consumer sales and credit/debit/voucher card payments; MEI excluded initially; ~229 payment institutions must integrate; 1.3-1.5 billion B2B transactions/year expected. — [Contábeis, 14 Sep 2026](https://www.contabeis.com.br/noticias/79382/split-payment-nao-atingira-vendas-a-pessoas-fisicas-e-cartoes-na-primeira-fase/); [Exame, 30 Sep 2026](https://exame.com/economia/split-payment-adiado-nao-e-split-payment-esquecido-o-que-muda-no-caixa-e-nos-sistemas-das-empresas/)
- BCB side: split tributário Pix catalog (SPI) published Mar 2026; Manual de Iniciação and API Pix release candidates Jun 2026; PSP development until early 2027; assisted production from Apr 2027 (QR static, key, manual) and Jun 2027 (dynamic QR and Pix Automático); B2B optional operations from Oct 2027. — [BCB Fórum Pix 26 Mar 2026](https://www.bcb.gov.br/content/estabilidadefinanceira/pix/Forum_Pix_Plenaria/20260326-Forum_Pix.pdf)
- Simples Nacional companies: DAS collection continues; they may use "Recolhimento pelo Adquirente" (RAD, LC 214 art. 36), where the acquirer (a regular-regime contributor) remits IBS/CBS when the payment instrument does not allow segregation; RAD is optional from Jan 2027, B2B. — [Contmatic](https://simplifique.contmatic.com.br/blogs/rad-recolhimento-pelo-adquirente-alternativa-split-payment-2027); [Algoritimado](https://algoritimado.com/blogs/noticias/split-payment-2027-implementacao-gradual-art-35-rad-2026-08-31)
- Installment sales: IBS/CBS are segregated proportionally at each installment's financial settlement (LC 214 art. 34 as summarised). — [Forvis Mazars / search summary](https://saladenegocios-br.forvismazars.com/2026/05/06/decreto-n-12-955-regulamentacao-cbs-em-vigor/)
- Marketplace/platform responsibility (LC 214 art. 22): a digital platform that intermediates non-in-person operations and controls at least one essential element (charging, payment, terms, delivery) is jointly liable for IBS/CBS when the supplier is foreign, or national but fails to supply required information or, being a taxpayer, does not issue the electronic fiscal document. Excluded if only providing isolated activity such as internet access, advertising, payment services authorized by BCB, or comparison tools not charging by sale (§2). Liability is waived if split payment is correctly executed or the supplier regularly issues the fiscal document. — [Pallotta Martins, 29 Oct 2025](https://pallottamartins.com.br/2025/10/29/lc-214-2025-plataformas-digitais-arrecadacao-tributaria/); [Systax](https://www.systax.com.br/artigos-e-novidades/como-a-reforma-tributaria-muda-a-responsabilidade-de-marketplaces-e-plataformas-digitais/); [Joompulse, 17 May 2026](https://blog.joompulse.com/2026/05/17/responsabilidade-solidaria-marketplace-reforma-tributaria/) (secondary; article numbers from Pallotta not confirmed in the page, art. 22 cited by the search summary).

### Inferences

- Because shoppers pay at a platform-owned checkout where Venduá defines conditions and probably the delivery/charging flow, Venduá may meet the "digital platform" definition (controls essential elements). Whether it is a "marketplace" (many suppliers) vs per-merchant storefront SaaS needs legal opinion; payment-only roles are excluded, but the checkout definition adds exposure.
- No split payment on consumer card/Pix sales is expected before 2028 at the earliest, so PSP split-payment readiness is not a 2026-27 selection criterion for B2C store checkout; fiscal-document data readiness is.
- Platform billing of merchants (Venduá monthly plans) is B2B: Pix/boleto/Pix Automático could be in the first-phase scope from 2H 2027 (optional); card recurring is out of phase 1.

### Gaps

- Joint Receita/CGIBS act with the official schedule not published as of 31 Aug 2026; no primary source (Receita/gov.br) retrieved, only secondary reporting of officials' statements.
- Conflict on dates: some sources say split payment is "mandatory 2028 B2B", another says "second half of 2027 first phase"; both are consistent with optional-2027, mandatory-2028 but the exact start month is unconfirmed.
- Exact LC 214 article numbers for platform liability not verified on the legal text.
- Treatment of delivery/food (restaurants, Simples, MEI) under CBS/IBS and NFC-e/NFS-e obligations not covered.

## 5. Interchange caps, chargeback, 3DS, Open Finance payments

### Takeaway

Debit (0.5%) and prepaid (0.7%) interchange caps are in force since 2023; there is no credit cap (BCB has studied one; no 2026 enactment found). Chargeback rules were reshaped by Res. 522/2025 (180-day limit for participant liability). 3DS is available but adoption remains limited. JSR (Pix via Open Finance without redirect) is live since 2026.

### Cited Findings

- Debit interchange cap 0.5% average (prior 0.8% per transaction), prepaid 0.7%, in force since 1 Apr 2023 (Res. BCB 246/2022). — [Tecnoblog](https://tecnoblog.net/noticias/2022/09/27/bc-limita-tarifa-de-intercambio-de-cartoes-e-o-que-isso-muda/); [Abrasel](https://abrasel.com.br/noticias/noticias/banco-central-limita-tarifa-de-intercambio-de-cartoes-pre-pagos-a-0-7/)
- Credit card interchange: BCB has studied a cap and a 12x installment limit (reported Oct 2023, consultation stage; the government opposed limits on interest-free installments). I found no 2025-26 enactment. — [Exame, 16 Oct 2023](https://exame.com/economia/exclusivo-bc-propoe-limitar-compras-parceladas-em-12-vezes-e-teto-para-tarifa-de-intercambio/) (dated source)
- VA/VR: 3.6% merchant fee cap (interchange up to 2%) from Feb 2026 — see section 2. — [NSC Total](https://www.nsctotal.com.br/economia/vale-alimentacao-e-refeicao-nova-regra-permite-cartoes-em-qualquer-maquininha-a-partir-de-novembro)
- Chargeback: see Res. 522 (180-day participant limit; uniform deadlines; clear dispute rules) in section 3. — [TIInside](https://tiinside.com.br/10/11/2025/bcb-aprimora-regulamentacao-de-arranjos-de-pagamento/)
- 3DS: limited adoption in Brazil but Visa and Mastercard push issuers, acquirers and merchants with incentives/penalties; with authenticated 3DS, liability for unrecognised-purchase disputes shifts to the issuer. — [Estado de Minas, May 2026](https://www.em.com.br/mundo-corporativo/2026/05/7419599-tecnologia-3ds-e-aliada-contra-fraudes-no-cartao-de-credito.html) (advertorial-style; no quantified adoption).
- Online debit growth: online debit +359.8% over six years to Q1 2026 (vs credit +247%), ABECS attributes to standardisation and chargeback protection, though still only R$ 4.9 bn/quarter. — [Panorama Abecs](https://panoramaabecs.com.br/compras-nao-presenciais-crescimento-1t26/)
- Open Finance payments/JSR: see section 1 (mandatory 6 Feb 2026, general market 22 Apr 2026, R$ 500 cap removed 1 Oct 2026). — [Pluggy](https://www.pluggy.ai/blog/open-finance-2026-novidades)

### Inferences

- A gateway should expose 3DS2 for card payments to give a liability shift, especially for higher-ticket retail.
- Credit interchange cap remains a speculative risk to card MDR economics; no date.

### Gaps

- No ABECS/BCB statistics on 3DS share or chargeback rates found.
- No evidence found of 2025-26 changes to debit/prepaid caps (only the 2023 regime).

## 6. Trends: wallets, BNPL, consolidation, outages and regulatory actions

### Takeaway

Wallet (Apple/Google Pay) and NFC are mainstream in-person; online wallet adoption is cited via vendor studies. BNPL/Pix-parcelado fintechs are growing. Acquiring is concentrated (top 5 = 76% of card volume by the Jan 2026 shares below) and Mercado Pago is growing, while Stone and PagBank face credit-quality and Pix pressure; BCB is pruning small IPs.

### Cited Findings

- Wallets: a Capgemini study cited by vendors says 50% of e-commerce transactions and 30% of in-store transactions use a digital wallet, projected 61%/46% in 2027 (global/regional scope unclear); 84% of Brazilian consumers used a wallet in the last year (vendor claim). — [PagBrasil](https://www.pagbrasil.com/pt-br/blog/carteiras-digitais/carteiras-digitais-como-apple-pay-e-google-pay-podem-impulsionar-suas-vendas/); [Shopify BR](https://www.shopify.com/br/blog/tendencias-de-pagamento) (low reliability; I did not verify Capgemini original).
- Apple/Google and Pix por aproximação: see section 1 (Android only; Apple in talks with CADE).
- BNPL: Pagaleve (Pix-based 4 interest-free biweekly installments) reports 5+ million consumers and 10,000 retailers; one source says 49% of virtual stores offer BNPL (15% in 2022) and BNPL adds ~30% conversion and ~45% AOV; BNPL market forecast R$ 30 bn in 2026 and US$ 11.75 bn by 2031 (market-research press release). — [Chargeflow/Nuvemshop/GlobeNewswire via search](https://www.globenewswire.com/news-release/2026/02/04/3231847/28124/en/brazil-buy-now-pay-later-business-and-investment-opportunity-report-2026-an-11-75-billion-market-by-2031-nubank-banco-inter-and-c6-bank-embed-credit-while-mercado-pago-retailers-ex.html); [Finsiders on Pagaleve](https://finsidersbrasil.com.br/noticias-sobre-fintechs/a-pagaleve-quer-ser-sinonimo-de-pix-parcelado-no-e-commerce-e-em-breve-no-varejo-fisico-finsiders/) (vendor-sourced stats; the "launch Sept 2025" claim for BCB Pix Parcelado in one result is superseded by BCB's Dec 2025 decision).
- Acquirer share by volume (Jan 2026): Rede 18%, Cielo 17%, PagBank 17%, Stone 15%, Mercado Pago 9%, Getnet 5%; the top five here sum to 76% (81% with Getnet). A separate snippet-level claim that five acquirers hold 96% uses a different set (Stone, PagBank, Cielo, Mercado Pago, Rede) and an unknown metric or denominator, so it is not reconciled with these shares. By users: Cielo 28%, PagBank 26%, Rede 25%, Stone 22%. InfinitePay not in the dataset. — [Let's Money](https://www.letsmoney.com.br/noticias/rede-itau-lidera-volume-adquirentes/); [Maquininha Review](https://maquininhareview.com.br/noticias/mercado/cinco-adquirentes-96-por-cento-volume/) (snippet-level)
- 2Q26: Stone TPV R$ 142.2 bn (+4.3% YoY) with 90+ day credit delinquency 6.98% to 8.60%; PagBank acquiring TPV R$ 133.4 bn (+3% YoY); Mercado Pago reported ahead of Stone and PagBank on acquiring profit per Itaú BBA; Pix and a weak economy pressure Stone/PagBank. — [Finsiders, Stone 2Q26](https://finsidersbrasil.com.br/noticias-sobre-fintechs/stone-perde-controle-da-inadimplencia-e-ve-atrasos-acima-de-90-dias-dispararem/); [Let's Money, PagBank](https://www.letsmoney.com.br/noticias/pagbank-2t26-lucro-inadimplencia-credito/); [NeoFeed](https://neofeed.com.br/negocios/mercado-pago-avanca-e-ja-supera-lucro-de-stone-e-pagbank-em-adquirencia-diz-itau-bba/); [Brasil 247](https://www.brasil247.com/negocios/pix-e-economia-fraca-pressionam-stone-e-pagbank-enquanto-btg-amplia-atuacao-em-pagamentos/) (snippets).
- Outages 2026: Mercado Pago app instability on 20 Feb 2026 (user reports); Pix instability 18 Mar 2026; 19 Jan 2026; 23 Aug 2026 (BCB acknowledged). No BCB fines tied to these were found. — [TechTudo, 20 Feb 2026](https://www.techtudo.com.br/noticias/2026/02/mercado-pago-fora-do-ar-usuarios-reclamam-de-instabilidade-nesta-sexta-20-edapps.ghtml); [CNN Brasil, 23 Aug 2026](https://www.cnnbrasil.com.br/economia/money/macroeconomia/pix-instabilidade-hoje-23-agosto-2026/) (snippets only).
- Regulatory actions: C&M Software hack and Pix suspension of six firms (Jul 2025); operations Carbono Oculto, Quasar and Tank (R$ 50 bn+ suspicious flows via fintechs) cited as the cause of the Sep 2025 tightening; 8 IP authorizations denied Jan-Apr 2026; Res. Conjunta 17/2025 limits use of the term "banco" by fintechs. — [Agência Brasil](https://agenciabrasil.ebc.com.br/economia/noticia/2025-09/bc-endurece-regras-de-seguranca-para-instituicoes-de-pagamento); [TJS Auditores](http://www.tjsauditores.com.br/2026/05/27/bc-ja-negou-autorizacao-para-oito-instituicoes-de-pagamento-em-2026/); [Log Law](https://log.law/2026/07/21/resolucao-conjunta-17-2025-fintech-termo-banco/) (snippet).

### Inferences

- Mercado Pago being #5 in volume but top in acquiring profit and growth, and already integrated, supports keeping it as primary; a second PSP for redundancy (given outages and concentration) is prudent, with Rede/Itaú and Pagar.me (Stone) class options for card-heavy merchants.
- Prefer PSPs that are banks/authorized IPs with strong balance sheets; Stone and PagBank credit stress is not a payment-risk indicator by itself but signals pricing pressure.

### Gaps

- No InfinitePay share figures; no PCMI report retrieved.
- No source quantifying Apple Pay/Google Pay share in Brazilian e-commerce specifically.
- No evidence found of BCB sanctions specifically against Mercado Pago, Stone or PagBank in 2025-26; absence not confirmed exhaustively.
- Capgemini wallet figures unverified at source.
