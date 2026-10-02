# Brazilian payment providers for Venduá's "connect your own account" model (research as of 2026-10-02)

Scope note: about 25 tool calls. Search-engine summaries were used for some claims and are marked "(search summary)". Official docs were fetched where noted. Many pages carry no publication date, so the date shown is the access date (2026-10-02) unless the source gives its own. Fees are mentioned only where they turned up incidentally.

## 1. Which providers support an OAuth/connect flow (merchant authorizes the platform on an existing account), and which only offer platform-created sub-accounts? Can the platform take a fee or split?

### Takeaway

(Superseded in part by the follow-up in `connect_flows_gateways.md` and `connect_flows_acquirers_banks.md`, which also found merchant-consent OAuth at SumUp and Stripe (existing Standard accounts via OAuth or Account Links, direct charges), plus partner-gated flows at Pagar.me's Hub, Cora, Appmax and PayPal.) In this first pass, only Mercado Pago (already integrated) and PagBank (Connect OAuth plus Split) clearly offered a merchant-authorizes-the-platform flow. Pagar.me, Asaas and Efí are built around recipients or sub-accounts that the platform creates or manages, which pushes KYC and liability onto the platform. InfinitePay has no documented platform model: the merchant puts their own "handle" into the platform and the platform calls the checkout API. PagBank is the best second adapter for this model, with a major caveat: its split makes the platform (the "Primary") liable for fees and chargebacks.

### Cited Findings

- **PagBank Connect is a real OAuth 2.0 authorization-code flow.** The merchant is redirected to `https://connect.pagseguro.uol.com.br/oauth2/authorize` with `client_id`, `response_type=code`, `redirect_uri`, `scope` and `state`. A sandbox host exists. — [PagBank Connect Authorization](https://developer.pagbank.com.br/reference/solicitar-autorizacao-via-connect-authorization) (accessed 2026-10-02)
- PagBank scopes: `payments.read`, `payments.create`, `payments.refund`, `accounts.read`, `payments.split.read`, `checkout.create`, `checkout.view`, `checkout.update`. No Pix-specific scope appears in the doc, and the page does not say whether authorizing accounts may be PF or PJ. — [same](https://developer.pagbank.com.br/reference/solicitar-autorizacao-via-connect-authorization)
- A search summary describes PagBank Connect as covering SMS and challenge verification, access-token issuance, refresh and revoke. — [search summary, PagBank Connect results](https://developer.pagbank.com.br/v1/docs/api-aplicacoes-dispositivos-suportados) (search summary)
- PagBank's "applications model" requires creating an application in the platform's own PagSeguro account. It can be used with Split, Recurrence, Transparent Checkout, Redirect Checkout and Lightbox APIs, and "Connect Parcerias". Split and Connect Parcerias are the only APIs that require the applications model. — [PagBank apps model](https://developer.pagbank.com.br/v1/docs/api-aplicacoes-dispositivos-suportados) (accessed 2026-10-02)
- **PagBank Split.** The platform ("Primary") creates the application, and each seller ("Secondary") authorizes it. The Primary pays all PagSeguro fees and assumes chargebacks and disputes: "Taxes and tariffs of PagSeguro will be paid entirely by the Primary", "The Primary will assume any chargebacks". Only entities with a direct legal relationship with PagSeguro can be Primary. Up to 25 Secondaries per cart. One cancellation is allowed (partial or full). The doc lists methods as card, boleto and online debit (the doc may predate Pix on split, so check). — [PagBank Split intro](https://developer.pagbank.com.br/v1/docs/split-introducao) (accessed 2026-10-02; the page appears older, v1 docs)
- PagBank is documented as supporting a "Pagar com PagBank" option, Pix, card, boleto, Apple Pay and Google Pay on its hosted Checkout / Payment Link, with webhooks, a sandbox and a homologation step before production. The doc excerpt does not say whether authentication is token or OAuth. — [PagBank Checkout](https://developer.pagbank.com.br/docs/checkout) (accessed 2026-10-02)
- **Mercado Pago** has a Partnership Program for platforms. Benefits listed are priority support, referrals to the sales team and event invitations. No revenue share is mentioned in the snippet. — [Mercado Pago Programa de Parcerias](https://www.mercadopago.com.br/partners/platforms/pt) (search summary; direct fetch returned 403)
- **Asaas** subaccounts: the parent account must be a CNPJ. Creation returns an `apiKey` and a `walletId`. Subaccounts must complete activation and document verification. No OAuth or "link an existing account" mechanism is described in the docs. Limits: max 10 subaccounts per parent during the regulatory evaluation period, 20 per day in sandbox, and R$2,000 in charges per subaccount in the first (up to 60-day) evaluation period. — [Asaas subaccounts](https://docs.asaas.com/docs/criacao-de-subcontas) (accessed 2026-10-02)
- Asaas split sends part of a charge's net value to other Asaas wallets (`splits` field); the issuing account keeps the rest. — [Asaas docs search result](https://docs.asaas.com/docs/criacao-de-subcontas) (search summary)
- **Pagar.me (Stone)** split: you must register recipients (a marketplace with two stores needs three recipients, including the marketplace). Split rules include `recipient_id`, percentage or amount, `charge_processing_fee` and `liable`. At least one recipient must carry the fee and at least one must be `liable` for chargebacks. Gateway and anti-fraud costs stay with the marketplace and cannot be split. Boleto works with split. — [Pagar.me split rules](https://docs.pagar.me/v1/docs/split-rules) (accessed 2026-10-02) and [Recebedores](https://docs.pagar.me/reference/recebedores-1) (search result)
- Pagar.me recipients go through KYC and "prova de vida", and you create them by passing bank data. — [dinheirodaminhaempresa / Chargefy comparison](https://chargefy.io/alternativas/pagarme) (third-party, 2026; lower reliability)
- A search summary claimed Pagar.me has "OAuth-based flows" for Nuvemshop and Yampi. The cited Pagar.me pages only describe the merchant installing the Nuvemshop app and choosing "I'm already a customer". The mention of OAuth appears to come from Nuvemshop's own API docs, so treat Pagar.me OAuth as **unverified, probably false**. — [Pagar.me Nuvemshop doc](https://docs.pagar.me/v2/docs/nuvemshop)
- **Efí Pix split** works only between Efí accounts (max 20). The platform configures the split on its own account, sellers do not authorize it, and you cannot split to your own account. Charges that were split cannot be refunded, and a split cannot be removed from a paid charge. — [Efí Pix split docs](https://dev.efipay.com.br/en/docs/api-pix/split-de-pagamento-pix/) (accessed 2026-10-02)
- Efí has a Partnership Program exclusive to the "Efí Empresas" account, covering API integration and client referrals. — [Efí Programa de Parcerias](https://sejaefi.com.br/programa-de-parceria) (search summary)
- **InfinitePay Checkout API**: `POST https://api.checkout.infinitepay.io/links` with `handle` (the merchant's InfiniteTag) and `items` (price in cents). It returns a payment link and supports `webhook_url`, `redirect_url` and `order_nsu`. `POST /payment_check` verifies a payment. Card (up to 12x) and Pix are supported. The merchant must hold an active InfinitePay account. The doc describes no OAuth, partner-platform, platform-fee or split features. — [InfinitePay Checkout docs](https://www.infinitepay.io/checkout-documentacao) (accessed 2026-10-02)
- **Stripe**: Brazilian Stripe accounts support Pix one-time payments with BRL settlement, on an invite-only basis. A business needs good standing and at least 60 days of processing, and Pix Automático is not available. — [Stripe support: how to enable Pix in Brazil](https://support.stripe.com/questions/how-to-enable-pix-as-a-payment-method-in-brazil) (search summary; undated)
- Stripe's cross-border payout docs list platforms in the US, UK, EEA, CA and CH only. Brazil is not listed as a platform country on that page, but the page covers cross-border platform/account combinations, so it says nothing about a Brazilian platform with Brazilian connected accounts. — [Stripe cross-border payouts](https://docs.stripe.com/connect/cross-border-payouts) (accessed 2026-10-02)
- A search summary says Brazil appears on a list of countries supporting Express connected accounts, and that Express is deprecated for new integrations. — [Stripe Express accounts](https://docs.stripe.com/connect/express-accounts) (search summary; weak)

### Inferences

- The clean "merchant authorizes platform, funds settle directly" pattern exists only at Mercado Pago and PagBank among the documented candidates.
- PagBank Split is not equivalent to the MP model in liability terms: the platform becomes the Primary and absorbs fees and chargebacks. Using PagBank Connect with each merchant's own credentials (create checkout or orders as the merchant, not via Split) might avoid this, but I did not find documentation confirming that a platform fee can be taken outside Split. This needs a direct test or a question to PagBank.
- Asaas, Pagar.me and Efí put the platform in the position of onboarding sub-accounts (KYC, ledger balances) and carrying liability, which sits close to the "subadquirente" role Venduá wants to avoid. This is a legal question for counsel, not settled by these sources.
- InfinitePay can fit as a "bring your own account" adapter with no fee: the merchant types a handle and the platform creates links. It gives no application fee and no proof the handle belongs to the person entering it, so verification would be weak.
- Stripe is a poor fit for Brazilian merchants today. Pix is invite-only; whether domestic Connect works for a Brazilian platform was not verified (the cross-border page doesn't settle it).

### Gaps

- Whether PagBank Connect tokens can create Pix charges (QR / copia e cola) on behalf of the merchant, and whether PagBank supports an application/platform fee outside Split.
- Whether Pagar.me or Asaas has any "connect existing account" flow (none found).
- Mercado Pago's partner program economics: the page returned 403.
- Stripe Connect availability for Brazil-based platforms: could not be confirmed.
- Cielo, Getnet, Rede, Iugu, Zoop, Vindi, Appmax, Pagaleve, Koin, PicPay, Inter, C6 and Nubank: not researched in this pass because of the tool-call budget.

## 2. Payment methods, webhooks, refunds, sandbox, docs quality, SDKs

### Takeaway

PagBank (Pix, card, boleto, Apple Pay and Google Pay on hosted checkout, with sandbox and webhooks) and InfinitePay (Pix plus card on a hosted link, webhook) both fit "card via redirect": card data stays off Venduá's systems, which shrinks PCI DSS scope (typically to SAQ A) but does not remove it. Efí and Pagar.me cover Pix well but through sub-account models. Pix por Aproximação and Pix Automático are regulatory features that are now live but provider API support was not verified.

### Cited Findings

- PagBank hosted checkout / payment link: card, debit, Pix, boleto, "Pagar com PagBank", Apple Pay, Google Pay. Webhooks for checkout and transaction status. Sandbox, plus formal homologation before production. — [PagBank Checkout](https://developer.pagbank.com.br/docs/checkout)
- PagBank Connect scopes include `payments.refund`. The split doc allows one cancellation (partial or full). — [Connect auth](https://developer.pagbank.com.br/reference/solicitar-autorizacao-via-connect-authorization), [Split intro](https://developer.pagbank.com.br/v1/docs/split-introducao)
- InfinitePay: no SDK required (plain REST). Webhook on payment approval, expects HTTP 200 and retries. No refund or sandbox documentation was found in the fetched page. — [InfinitePay Checkout docs](https://www.infinitepay.io/checkout-documentacao)
- Efí has SDKs in several languages (a PHP SDK is listed on GitHub), covering Pix QR / copia e cola, Pix Automático, scheduled and recurring Pix, Pix por Biometria via Open Finance, boleto, card, links and split. — [efipay/sdk-php-apis-efi](https://github.com/efipay/sdk-php-apis-efi) (search summary)
- Pix Automático launched on 2025-06-16. From 2026-01-01 it is mandatory for all institutions already doing interbank automatic debit. From 2026-10-01, customers can set per-recipient Pix Automático limits. — [Tecnospeed](https://blog.tecnospeed.com.br/pix-por-aproximacao-pix-automatico/) and [Metrópoles](https://www.metropoles.com/brasil/economia-br/por-aproximacao-e-automatico-veja-as-novidades-no-pix) (search summary)
- Since April 2026, all Pix participants must offer Pix por Aproximação (NFC, settled via BCB infrastructure). — [Tecnospeed](https://blog.tecnospeed.com.br/pix-por-aproximacao-pix-automatico/) (search summary)
- Pagar.me: split works on card, boleto and Pix, and installments multiply the payables (installments x recipients). — [Pagar.me split rules](https://docs.pagar.me/v1/docs/split-rules), [Chargefy comparison](https://chargefy.io/alternativas/pagarme)
- Asaas: REST API with webhooks, Pix, boleto and card, and plugins for Shopify, Magento, Nuvemshop and WooCommerce. — [Asaas blog](https://blog.asaas.com/api-de-pagamento-asaas/) (search summary)

### Inferences

- A good adapter interface should treat "create hosted checkout" and "create Pix charge" as separate capabilities per provider, since PagBank and InfinitePay lean on hosted links while Efí and Asaas are API-first.
- Pix por Aproximação is a point-of-sale feature and probably irrelevant to online checkout. Pix Automático is relevant only for subscriptions.

### Gaps

- TypeScript/Node SDK availability per provider (only the Efí PHP SDK was seen).
- Sandbox details for InfinitePay, Efí and Asaas.
- Partial-refund support per provider (except PagBank).
- Whether Pix Automático is exposed by PagBank, Mercado Pago, Asaas or Pagar.me via API.

## 3. Popularity with small Brazilian merchants and food businesses

### Takeaway

Five acquirers handle most card volume: Stone, PagBank, Cielo, Mercado Pago and Rede. For small merchants, the machine brands InfinitePay, Ton (Stone group), PagBank, Mercado Pago and Stone are the most relevant. Reliable merchant-count and food-segment data was mostly not found.

### Cited Findings

- A 2026 roundup says Stone, PagBank, Cielo, Mercado Pago and Rede account for 96% of card transactions, with R$4.3 trillion in card transactions in 2025. — [Dinheiro da Minha Empresa](https://dinheirodaminhaempresa.com/comparativos/maquininha-stone-pagbank-cielo-mercadopago-rede-2026/) (search summary; third-party blog, so treat as indicative)
- The same results say Stone reported 3.7 million active PJ clients in 2026 and that Ton has more than 2 million clients. — [same](https://dinheirodaminhaempresa.com/comparativos/maquininha-stone-pagbank-cielo-mercadopago-rede-2026/) (search summary)
- The 2026 small-business machine market is described as led by InfinitePay, Ton, SumUp, Mercado Pago, PagBank, Stone, Cielo, Getnet, SafraPay and Rede. InfinitePay is CNPJ-only. — [InfinitePay blog](https://www.infinitepay.io/blog/melhor-maquininha-de-cartao) (the vendor's own blog; biased)
- Pix accounted for more than 40% of online domestic transactions, with about R$3.4 trillion in Q1 2026. — [Stripe Pix guide](https://stripe.com/resources/more/pix-replacing-cards-cash-brazil) (search summary)

### Inferences

- A merchant who already has a Pix-capable machine account is likely to be with InfinitePay, Ton/Stone, PagBank or Mercado Pago. This makes InfinitePay and PagBank the two most likely "I already have an account" matches after Mercado Pago, and Stone/Ton an unserved gap: Pagar.me is a separate account, and no source shows an existing Stone or Ton account works with it.

### Gaps

- No ABECS or central bank market-share table by segment was found. No food-segment-specific data.
- No independent source for InfinitePay's merchant count.

## 4. What competitor platforms integrate (de-facto shortlist), and the platform partner programs

### Takeaway

Store builders integrate a small, repeating set: Mercado Pago, PagBank, Pagar.me and their own wallet (Nuvem Pago / Yampi Pay). Delivery and menu apps (Goomer, Anota AI, Cardápio Web) mostly run their own integrated payments with the merchant's bank account and fixed fees, rather than OAuth to third-party accounts.

### Cited Findings

- Nuvemshop: its own Nuvem Pago (card, Pix, boleto) is used by "7 in 10" merchants (Nuvemshop's own claim). 20+ other solutions are available in its app store, including Mercado Pago, PagSeguro, PayPal, Pagar.me and Cielo. — [Nuvemshop blog](https://www.nuvemshop.com.br/blog/formas-de-pagamento-nuvemshop/) and [Nuvemshop on Nuvem Pago](https://www.nuvemshop.com.br/blog/nuvem-pago/) (search summaries, vendor marketing)
- Yampi: gateways by plan tier include Mercado Pago, PagBank, Pagar.me, Appmax, Pagaleve, Dom Pagamentos and Yampi Pay. Pix and Pix Parcelado are available on Mercado Pago, Stone, Appmax, PagBank, Vindi and Dom Pagamentos. — [Yampi help](https://help.yampi.com.br/pt-BR/articles/6067050-quais-os-gateways-e-adquirentes-de-pagamento-integrados) (search summary)
- Pagar.me lists integrations with Nuvemshop (about 20 minutes to set up) and Yampi (about 15 minutes), which the merchant sets up from their own account. — [Pagar.me Nuvemshop](https://docs.pagar.me/v2/docs/nuvemshop), [Yampi](https://docs.pagar.me/v2/docs/yampi) (search summary)
- Loja Integrada has a Mercado Pago integration with its own configure-checkout doc. — [Mercado Pago dev docs for Loja Integrada](https://www.mercadopago.com.br/developers/pt/docs/loja-integrada/payment-methods/configure-checkout) (search result)
- Anota AI: online payment via Pix, card and wallets (NuPay, Google Pay, Apple Pay). Conditions come from "payment partners". The fee table names Tuna and iFood Pago as options. Pix is 0.00%-0.99% plus R$0.50, with D+1 to D+30 settlement. — [Anota AI blog](https://anota.ai/blog/pagamento-online-para-restaurante/) (accessed 2026-10-02)
- Goomer: online payments by card, Pix, NuPay and Google Pay. Pix is 0.99% D+1, credit 3.49% D+30. Money goes to the account the merchant registered at Goomer. The doc does not name the acquirer or say whether it is a sub-account. — [Goomer help](https://ajuda.goomer.com.br/goomergo/painel/pagamento-online), [Goomer blog](https://goomer.com.br/blog/funcionalidades-pagamento-goomer)
- Cardápio Web: Pix and credit/debit online, with a Pix fee of R$0.50 per charge. — [Cardápio Web blog](https://cardapioweb.com/blog/formas-de-pagamento-no-cardapio-digital/) (search summary)
- Partner programs found: Mercado Pago (priority support, sales referral, events; no revenue share seen), Asaas (rewards by performance for indicating or integrating Asaas, requires an active CNPJ, a customer base and a commercial structure), Efí (partnership program exclusive to Efí Empresas). — [MP partners](https://www.mercadopago.com.br/partners/platforms/pt), [Asaas partners](https://materiais.asaas.com/parceiros), [Efí partnerships](https://sejaefi.com.br/programa-de-parceria) (search summaries)

### Inferences

- The de-facto shortlist across Brazilian store builders is Mercado Pago, PagBank and Pagar.me (plus Stone, Appmax and Pagaleve in Yampi's e-commerce niche). Adding PagBank as second provider matches market practice. Pagar.me is the third, with a different model (merchant pastes API keys in the platform).
- Food-delivery SaaS (Anota AI, Goomer, Cardápio Web) compete by bundling payments with their own contracts and fees. A "connect your own account" offer with zero platform fee is a differentiator, but also means merchants may expect Pix at the same rate or lower.
- Pagar.me integrations in other builders work through merchant-entered API keys, which would be a simple, no-liability adapter option for Venduá (the merchant keeps their own Pagar.me account, no split). Not directly verified in docs.

### Gaps

- Tray, Shopify BR, Consumer, Saipos, iFood's Pago acquirer arrangements and Loja Integrada's full gateway list were not researched.
- Whether Anota AI or Goomer use Pagar.me, Asaas, Tuna or others underneath was not found (Tuna and iFood Pago appear in the Anota AI table only).
- Revenue-share or rebate amounts for any partner program (none found). PagBank's and Stone/Pagar.me's partner programs were not found.
- BNPL / Pix Parcelado (Pagaleve, Koin) and wallets: only the Yampi mention above and PagBank Apple/Google Pay were found.
