# Connecting a merchant's EXISTING acquirer / bank account: connect flows (Oct 2026)

Scope: Brazil only. Fees not researched. All pages accessed **2026-10-02** unless noted.

Method key: (1) one-click login / OAuth or partner "connect"; (2) type an account name / Pix key / id (platform creates charges without secret keys); (3) paste API keys or certificates; (4) platform-created sub-accounts; (5) no public API for online payments.

Confidence legend: High = primary developer doc read. Medium = primary doc partly read, or consistent third-party integration guides (Omie, Kobana, Shipay and similar). Low = search summary or secondary only.

Research limits: `developer.userede.com.br` is an Angular SPA that returns no content to a fetcher, so Rede details come from the official e.Rede PDF manual. `developers.inter.co`, `developers.getnet.com.br` and `developers.safrapay.com.br` are also SPAs and returned only summaries. `c6bank.com.br` and `developer.itau.com.br` returned 403/503. Where a claim rests on a third-party integration guide, it is marked.

## Summary table

| Provider                          | Method                                               | Partner flow changes it?                                                      | Pix dynamic QR via API                                       | Card via hosted/redirect                              | Webhook                | Merchant effort                              |
| --------------------------------- | ---------------------------------------------------- | ----------------------------------------------------------------------------- | ------------------------------------------------------------ | ----------------------------------------------------- | ---------------------- | -------------------------------------------- |
| Cielo (API 3.0 / Checkout / Link) | 3                                                    | No public self-serve program found                                            | Yes (API 3.0, needs Pix enabled on EC)                       | Yes (Checkout Cielo / Link, hosted)                   | Yes                    | Low to medium                                |
| Rede (e.Rede, Itaú)               | 3                                                    | "Conexão Itaú" exists, no flow change documented                              | Yes, but only for Itaú account holders                       | No hosted checkout/link API found; raw-card API (PCI) | Yes                    | Medium; PCI wall for card                    |
| Getnet (Santander)                | 3 (plus 4 via Onboarding API)                        | Sub-acquirer / partner track by contract                                      | Yes (Get Checkout lists Pix)                                 | Yes (Get Checkout, iframe/API)                        | Yes (notification URL) | Low                                          |
| Stone direct                      | 3 for card, raw-card only; no hosted checkout        | Gateways need merchant-generated SecretKey; sub-acquirers contract with Stone | No Pix in Stone Online API; Pix is in separate Open Bank API | No                                                    | Open Bank has webhooks | High; effectively no self-serve              |
| Ton                               | 5                                                    | None                                                                          | Only inside Ton app                                          | Only inside Ton app (payment link)                    | None                   | n/a                                          |
| SumUp                             | 1 (OAuth) or 3 (API key)                             | OAuth is the platform route; `payments` scope needs SumUp manual verification | Yes (`pix`, `qr_code_pix`)                                   | Yes (Hosted Checkout)                                 | Yes                    | Lowest                                       |
| Safra Pay                         | 3                                                    | Split / subseller exists (4)                                                  | Yes                                                          | Yes (Checkout + Payment Link)                         | Yes                    | Low to medium; PCI for raw API               |
| Sicredi                           | 3 (cert) or partner-connect through Internet Banking | Yes: "provedores homologados" path                                            | Yes (cob/cobv)                                               | No (bank)                                             | Yes                    | Medium (cert) or low (partner path)          |
| Sicoob                            | 3 or partner-connect                                 | Yes: "integração por empresa parceira"                                        | Yes                                                          | No                                                    | Yes                    | Medium                                       |
| Banco Inter PJ                    | 3 (mTLS cert + client id/secret)                     | No partner flow found                                                         | Yes (cob/cobv)                                               | No                                                    | Yes                    | Medium; PJ only, no MEI                      |
| C6 Bank PJ                        | 3 (cert + client id/secret)                          | "Partner program" mentioned, unconfirmed                                      | Yes, but Pix API reported pilot/limited                      | No                                                    | Yes (per third-party)  | Medium to high                               |
| Nubank PJ                         | 5                                                    | NuPay for Business is PSP-contract (4-like)                                   | No public receiving API                                      | NuPay wallet checkout (PSP only)                      | NuPay: yes             | n/a                                          |
| Cora                              | 1 (OAuth auth code, "Parceria Cora") or 3            | Yes: partner approval unlocks OAuth                                           | Boleto híbrido with Pix QR (not plain cob)                   | No                                                    | Yes                    | Low for merchant, high for platform approval |
| Itaú (Pix recebimentos)           | 3 (dynamic cert) or partner-connect                  | Yes: "Integradores Pix" in Bankline                                           | Yes                                                          | No                                                    | Yes (callback)         | High (cert) or low (integrator)              |
| Bradesco Pix                      | 3                                                    | No partner flow found                                                         | Yes                                                          | No                                                    | Yes                    | High                                         |
| Banco do Brasil Pix               | 3                                                    | No partner flow found                                                         | Yes                                                          | No                                                    | Yes                    | Medium to high                               |

---

## Cielo (API e-commerce 3.0 / Checkout Cielo / Cielo Link)

- **Method:** 3 (paste keys). Three different credential sets:
  - API e-commerce 3.0: `MerchantId` + `MerchantKey` (header).
  - Checkout Cielo / Cielo Link (Super Link): `Client ID` + `Client Secret`, exchanged for an OAuth2 token. The OAuth here is client-credentials with the merchant's own pair, not a consent flow.
  - Cielo OAuth for the transactional control API: `client_id`/`client_secret`, same pattern.
- **Evidence:**
  - MerchantId/MerchantKey are viewed or regenerated at E-commerce > Gestão API E-commerce > Credenciais, per EC, Admin/Analyst profile only, with a second factor from the Cielo Gestão app. Doc says no dedicated partner flow. https://docs.cielo.com.br/ecommerce-cielo/reference/visualizar-as-credenciais-merchantid-e-merchantkey
  - Link/Checkout credentials: E-commerce > Link de Pagamento > Configurações > Credenciais de API, shown once. Doc has no partner/integrator flow. https://docs.cielo.com.br/link/reference/gerar-credenciais
  - Link/Checkout config: methods (cards, wallets, Pix, boleto), three URLs (return, notification, status-change). https://docs.cielo.com.br/link/docs/configuracoes-loja
  - Platform connectors (Nuvemshop, VTEX, Shopify, WooCommerce and others) use the same paste model. Nuvemshop asks for Merchant ID + Merchant Key and covers card, Pix, boleto. Tray maps "Código de afiliação" to MerchantId. Merchants without an e-commerce affiliation must request credentials by email/phone. https://docs.cielo.com.br/conectores/docs/conectores-e-plataformas-disponiveis, https://www.nuvemshop.com.br/blog/como-cobrar-online-com-a-cielo/ (search summary), https://basedeconhecimento.tray.com.br/hc/pt-br/articles/6734262693659-Como-habilitar-a-Cielo-como-forma-de-pagamento (search summary)
- **Partner program:** Cielo Conecta targets "Cliente/Subadquirente" and uses MerchantId/Key too. No OAuth consent or merchant-authorizes-platform mechanism found. https://desenvolvedores.cielo.com.br/api-portal/pt-br/content/cielo-conecta. The connectors page does not say how a platform becomes a connector. For the Cielo chargeback API, credentials are released by Cielo staff about 48h after the client emails EC data and an mTLS certificate. https://docs.cielo.com.br/pix-can-cbk/reference/autenticacao-e-credenciais-cb
- **Enables:** Card (API 3.0 raw card needs PCI; Checkout/Link are hosted and avoid it), Pix dynamic QR (needs "Pix liberado" in Meu Cadastro > Autorizações > PIX; new integrations use the "Cielo2" provider since 2025-09-01), boleto, wallets. Webhook: yes. https://docs.cielo.com.br/ecommerce-cielo/docs/pix
- **Merchant effort:** Low to medium. Needs an active e-commerce affiliation (separate from the POS EC), an admin user, and Pix enabled. No certificate.
- **Confidence:** High on credentials and no self-serve partner path. Medium on "no partner program": absence in the docs read, not a confirmed negative. `developercielo.github.io` pages 404'd on direct fetch, so the older manual was not read directly.

## Rede (e.Rede, Itaú)

- **Method:** 3 (paste PV + integration key).
- **Evidence:**
  - Credentials are the PV (affiliation number) and an "integration key" that a master user generates at Rede portal > para vender > e-commerce > chave de integração. Accreditation for e.Rede is by phone. https://developer.userede.com.br/files/traducoes/erede/e-rede_12062024.pdf (manual v1.16, read in full for these sections)
  - Newer OAuth2 maps PV = clientId, integration key = clientSecret, token endpoint `https://api.userede.com.br/redelabs/oauth2/token`. This is client-credentials with the merchant's own pair, not consent. https://developer.userede.com.br/e-rede (search summary)
- **Partner program:** The portal lists "Programa de Parcerias Conexão Itaú" and "Plataformas E-commerce" (software house / integrator / ERP track). The manual says that if contact is via a platform, gateway or module, the certificate update goes through them. The `distributorAffiliation` field exists on requests (a "distributor PV"), but no public connect or consent flow was found. https://www.itau.com.br/empresas/conexaoitau/parceiros (search summary); manual above.
- **Enables:**
  - Card: the transactional API takes raw card data (PCI scope). No hosted checkout or payment-link API found in the manual.
  - Pix QR (`kind: "pix"`, expiry up to 15 days): "Payment method available only for Itaú account holders." The merchant enables the Itaú key in the Rede portal (Para vender > PIX). Status via webhook and query.
  - Callbacks and notification URL: yes.
- **Merchant effort:** Medium. Platform must handle PCI for card. Pix only for Itaú-account merchants.
- **Confidence:** Medium. The manual is June 2024 (v1.17 exists, not read), and the portal was not readable, so a 2025-26 hosted/link API or partner flow could exist unseen.

## Getnet (Santander)

- **Method:** 3 for the merchant's own account. Merchant copies Seller ID, Client ID and Client Secret from the Getnet panel ("Chaves de Autenticação Plataforma Digital", or Configurações > Identificação da API). Token via `POST /auth/token`, client_credentials. A separate **Onboarding** API (`/v1/merchants`, qualification, orders) lets a platform register merchants under Getnet = method 4, not for existing accounts.
- **Evidence:**
  - Credentials: https://ajuda.iset.com.br/inicio/minha-loja/integracoes/pagamento/getnet and https://help.yampi.com.br/pt-BR/articles/6076446-como-configurar-a-getnet (search summaries)
  - Auth guide: https://api-homologacao.getnet.com.br/api-doc/guides/integration-examples.html
  - Onboarding endpoints: https://api-homologacao.getnet.com.br/api-doc
  - Platform plugins and partner tracks (software houses, sub-acquirers, agencies; form, contract, assisted integration): https://site.getnet.com.br/parcerias/ecommerce/
- **Partner program:** Yes, by contract (software house, sub-acquirer "facilitador" tracks). No OAuth consent flow found.
- **Enables:** Get Checkout (hosted, via API or iframe): debit, credit, Pix, wallets, boleto. Notification URL generated by the platform that the merchant pastes into Getnet. https://site.getnet.com.br/getcheckout/
- **Merchant effort:** Low to medium (three values, plus pasting a notification URL).
- **Confidence:** Medium. `developers.getnet.com.br` is an SPA that gave only an index, so the endpoint-level Pix and checkout API shapes were not read.

## Stone (direct, not Pagar.me)

- **Method:** 3 in the narrow sense (merchant generates a `SecretKey`), but the API is raw-card only. Productized online acceptance is Pagar.me (out of scope). Best classification for a platform: **effectively 5 for self-serve** (no hosted checkout or Pix on the acquirer API) and 4 for sub-acquirers by contract.
- **Evidence:**
  - Stone Online is "the transactional API" (authorize, capture, cancel, query) for companies that already have antifraud, multi-method, recurrence. Others are pointed to Pagar.me. https://online.stone.com.br/docs/o-que-e-o-stone-online.md
  - Authentication: "Gateways" need the merchant that owns the Stone affiliation to generate a transactional key (`sk_...`, Basic auth) "to guarantee the lojista's explicit authorization". Sub-acquirers use an IdP token and Stone's partnerships team. https://online.stone.com.br/reference/overview-da-autenticação.md. The key is generated in Portal Stone > Perfil > Chaves de Autenticação by the affiliation owner. https://online.stone.com.br/docs/gerando-a-secret-key-stone.md
  - PCI DSS certification is required of gateways; partner contact is integracoes.parcerias@stone.com.br. https://online.stone.com.br/docs/pré-requisitos-2.md. Integration needs sandbox, homologation, then a "Partner Manual". https://online.stone.com.br/docs/processo-de-integracao-1. No Pix in the Stone Online index (0 matches in `llms.txt`). https://online.stone.com.br/llms.txt
  - **Stone Banking / Open Bank API** (account-level): JWT RS256 signed with the partner's key, `ClientID` issued by Stone, and a **consent link** flow (Stone-hosted page, user picks accounts and scopes, redirect back with `consent_result`) for third-party accounts. It exposes BACEN-standard Pix `cob`/`cobv`, dynamic QR, refunds, webhooks. But "we are not doing self-service partner onboarding" (sales form, sandbox, homologation, production). The consent guide was last modified 2021-06-28 and the Pix reference 2022-08-17, so currency is uncertain. https://docs.openbank.stone.com.br/docs/guias/stone-open-banking/, https://docs.openbank.stone.com.br/docs/guias/consentimento/, https://docs.openbank.stone.com.br/docs/referencia-da-api/pix/apis-padrao/cob/criar-cobranca-imediata
- **Partner program:** Stone Partner Program (partner.stone.com.br form, referenced from https://conteudo.stone.com.br/como-conectar-seu-software-na-stone/, updated 2025-09-18). Connect 2.0 API there is for POS/ERP sales data, not online payments.
- **Enables:** Card only (Stone Online); Pix only through Open Bank, which is bank-account scope. No hosted checkout/link API in either. Stone's marketing lists Checkout and Link de Pagamento, but the API for them is Pagar.me. https://www.stone.com.br/tipos-de-negocio/ecommerce
- **Merchant effort:** High and not self-serve. Platform needs PCI and Stone approval, or a Stone Open Bank partnership, which is a sales process.
- **Confidence:** High on Stone Online auth model. Medium on Open Bank consent being current and usable for Pix receipts. Not confirmed: whether a consent grant includes the Pix `cob` scopes, and whether Stone currently approves e-commerce platforms.

## Ton

- **Method:** 5. No public online-payments API for Ton accounts found.
- **Evidence:** Ton is Stone's micro-merchant brand. Its app offers TapTon, payment link, Pix and boleto. https://play.google.com/store/apps/details?id=br.com.stone.ton (search summary). Ton machines have no ERP/app integration, unlike Stone machines. https://blog.ton.com.br/ton-e-da-stone-tire-suas-dividas/ (search summary). Stone's DevCenter lists Pagar.me, Connect (POS), SDK Android, AutoTEF, conciliation APIs, with no Ton mention. https://www.stone.com.br/devcenter
- **Partner program:** None found for Ton specifically.
- **Enables:** Only in-app payment link / Pix. Nothing for a third-party checkout to call.
- **Merchant effort:** n/a. A Ton merchant would use the Ton payment link manually, or sign up for a different gateway.
- **Confidence:** Medium-low. Absence of evidence in docs and search summaries. A Stone/Ton migration to a Stone account could change this.

## SumUp

- **Method:** 1 (OAuth 2.0 authorization code) for platforms; 3 (API key) for a single merchant's own use.
- **Evidence:**
  - Three authorization models: API keys (single merchant), OAuth 2.0 ("multi-merchant solutions … merchants … must explicitly grant access"), affiliate keys (card-present). https://developer.sumup.com/docs/online-payments/introduction/authorization/, https://developer.sumup.com/tools/authorization/authorization
  - OAuth: redirect to `https://api.sumup.com/authorize`, code exchange from backend, short-lived access token plus refresh token. Scopes include `payments` and `payment_instruments`, both marked as "requires manual verification". https://developer.sumup.com/tools/authorization/oauth
- **Partner program:** OAuth app registration is the platform route (register-app page). Verification of the `payments` scope by SumUp is a gate for the platform, not the merchant. Registration page not read directly. https://developer.sumup.com/docs/online-payments/introduction/register-app/ (search summary)
- **Enables:** Hosted Checkout (`hosted_checkout_url`, `redirect_url`, needs `merchant_code`, `amount`, `currency`; session valid 30 min). APMs in the integration guide include `pix`, `qr_code_pix`, `boleto`. `pix` "deposits directly to merchant's SumUp bank account (if eligible)"; `qr_code_pix` uses the standard payout process. Webhooks: docs call "checkout status and webhook events" the source of truth. https://developer.sumup.com/online-payments/checkouts/hosted-checkout, https://developer.sumup.com/online-payments/apm/integration-guide
- **Merchant effort:** Lowest of all (log in and approve). Not confirmed: whether APMs like Pix are enabled for every Brazilian merchant, and what SumUp's settlement terms are for `qr_code_pix` versus `pix`. The guide says to treat the returned methods as an allowlist.
- **Confidence:** High for the OAuth mechanism. Medium for Pix availability in Brazil per merchant. Open questions: how long the `payments` scope verification takes, and whether it excludes small platforms.

## Safra Pay

- **Method:** 3. Auth is built on the store's `MerchantId` (EC), `MerchantToken` and CNPJ. Gateway auth sends BCrypt of CNPJ + MerchantToken. Raw API requires PCI DSS. Split/subseller exists (4-like, platform-contracted).
- **Evidence:** https://developers.safrapay.com.br/ (summary only; SPA). Search summaries: payment sources include `SafrapayCheckout`, `SafrapayPaymentLink`, `SafrapayCatalogPaymentLink`; links can be created in the Safra Empresas app; the portal creates a payment link instead of checkout. https://www.safrapay.com.br/blog/link-de-pagamento.html. Third-party doc: https://dev.softwareexpress.com.br/docs/e-sitef/roteamento-safrapay/ and the e-commerce manual PDF v01.11 (old). Third-party comparison says Safra Pix/bank API is "manager-dependent, limited access". https://kmee.com.br/blog/comparativo-apis-bancarias-erp-brasil-2026/ (secondary)
- **Partner program:** `developers.safrapay.com.br/integration?section=plataformas` exists (platform integrations) but returned no content.
- **Enables:** Hosted checkout and payment link, Pix, webhooks, split. All per the portal's own summary, not read at endpoint level.
- **Merchant effort:** Low to medium (paste credentials from SafraPay). The Safra bank API is separate and hard.
- **Confidence:** Low-medium. SPA, secondary sources only.

## Sicredi

- **Method:** 3 for individual integration (mTLS certificate via the Developer Portal CSR flow + Client ID/Secret), **plus a partner-connect path**: with a "provedor homologado", the cooperado generates credentials in Internet Banking (Outros Serviços > Acesso API Pix > Gerar credenciais, picks the provider from the list, accepts terms). The provider already holds the certificate, so the merchant needs no certificate.
- **Evidence:** https://developers.sicredi.com.br/public/docs/getting-started-pix (two paths documented, list at https://www.sicredi.com.br/site/pixpj/api-pix/, which returned 403). Steps with Shipay: https://shipay.freshdesk.com/support/solutions/articles/154000127004-shipay-pix-sicredi (search summary). Provider list PDF dated 2025-05-21: https://www.sicredi.com.br/media/produtos/filer_public/2025/05/21/provedores_parceiro_1.pdf (listed, not read). Only cooperados can use the API and must first adhere to API Pix through their cooperative. https://developers.sicredi.com.br/public/docs/general-information
- **Partner program:** Yes, "provedores homologados". The platform must be homologated by Sicredi (list includes Shipay, Linx, GreenApp, ERPs and software houses). How to become one was not found.
- **Enables:** Pix `PUT /cob/{txid}` (dynamic QR), `/cobv`, `GET /pix`, refunds, webhook (optional; otherwise polling). No card.
- **Merchant effort:** Individual path: high (certificate). Provider path: medium (ask cooperative to enable, generate credentials in Internet Banking, send client id and Pix key to platform).
- **Confidence:** High for the two paths (primary doc). Medium for "homologation requirements".

## Sicoob

- **Method:** 3 (ICP-Brasil certificate + Client ID, application created in the developer portal), **plus a partner path**: when creating the application the merchant answers "A integração será por uma empresa parceira?" = Sim and picks the partner (e.g. Shipay). A legal representative then authorizes in Sicoob App / Sicoobnet Empresarial ("Autorização para Uso de APIs"). The merchant gives the platform the Client ID, Pix key and (per Shipay) the Contract/Client number. No certificate is mentioned for the partner path.
- **Evidence:** https://shipay.freshdesk.com/support/solutions/articles/154000195696-boleto-h%C3%ADbrido-sicoob, https://faq.memocashsolucoes.com.br/knowledgebase/integracao-pix-shipay-x-sicoob (third-party guides). Direct path: Kobana's guide says upload an ICP-Brasil certificate for the CNPJ and select "No" for partner. https://ajuda.kobana.com.br/pt-BR/articles/8861634-como-ativar-os-recebimentos-por-pix-pela-api-do-sicoob. Sicoob does not accept self-signed certificates in production. https://developers.sicoob.com.br (portal text not fully readable; search summary).
- **Partner program:** Yes: partner companies are registered in the Sicoob portal. How to be listed was not found. The portal summary mentions "OAuth authorization code flow" and a partner program, unverified.
- **Enables:** Pix cobrança (cob/cobv, hybrid boleto with Pix), webhook. No card.
- **Merchant effort:** Medium, multi-step: developer-portal sign-up, app creation, Sicoobnet approval, a contract number from the account manager.
- **Confidence:** Medium (third-party guides, consistent). Official partner onboarding unverified.

## Banco Inter (API PJ)

- **Method:** 3. In Internet Banking the merchant creates an "Aplicação", ticks the permissions, and downloads a ZIP with certificate (CRT + KEY) and Client ID/Secret. OAuth2 client_credentials with mTLS. Certificates last 1 year. **PJ only; PF and MEI have no access.**
- **Evidence:** https://developers.inter.co/ (3-step: log in via QR code, create integration and accept permissions, activate keys and certificate), https://ajuda.inter.co/conta-digital-pessoa-juridica/o-inter-disponibiliza-alguma-api-para-minha-conta-digital-pj, Omie guide (one Inter application per Omie application): https://ajuda.omie.com.br/pt-BR/articles/7057153-configurando-a-integracao-com-o-inter-boletos-pix-via-api. Scopes seen in search summary: `cob.write`, `rec.write`. A Pix Automático API exists: https://developers.inter.co/references/pix-automatico
- **Partner program:** None found. Every third-party tool (Omie and others) has the merchant paste a certificate plus Client ID/Secret.
- **Enables:** Pix cob (immediate QR) and cobv (due date); boleto with Pix; webhook. No card.
- **Merchant effort:** Medium. Internet Banking login, key creation, ZIP upload, yearly renewal. MEI excluded, which hurts small food merchants.
- **Confidence:** High on flow. Medium on MEI exclusion (Inter help page; unclear if recently changed).

## C6 Bank PJ

- **Method:** 3. Master user creates a key in Web Banking (Meu perfil > Integrações via API), picks products and permissions, and gets ClientId, ClientSecret and a certificate.
- **Evidence:** Third-party: https://docs.softensistemas.com.br/books/configuracao-plugboleto-gerencieaqui/page/api-c6-bank (search summary), https://ajuda.omie.com.br/pt-BR/articles/17059704-configurando-a-integracao-com-o-c6-bank-boleto-pix-via-api (credentials listed: Client ID, Client Secret, certificate). Portal summary lists Pix cobrança, boleto, mTLS and OAuth, plus a partner program. https://developers.c6bank.com.br/ (summary only). Secondary: Pix API was reported as pilot with few active clients, activation by request. Reclame Aqui complaint about denied Pix cobrança API access (not readable).
- **Partner program:** "Partner program" mentioned on the portal, content not read.
- **Enables:** Pix cobrança, boleto; webhook (secondary: kmee).
- **Merchant effort:** Medium to high; Pix availability uncertain per account.
- **Confidence:** Low-medium. Primary C6 pages blocked (403).

## Nubank PJ

- **Method:** 5 for receiving online payments through the merchant's own account. No public cobrança/Pix API for Nu Empresas. Open Finance consent exists but only for **payer-side payment initiation** and data sharing, not for receiving. **NuPay for Business** is a separate wallet-checkout product sold to PSPs/e-commerces, with its own contract (4-like), not a connect flow for an existing Nu account.
- **Evidence:** https://kmee.com.br/blog/comparativo-apis-bancarias-erp-brasil-2026/ ("Nubank PJ: no public API"; secondary). https://ajuda.woovi.com/hc/duvidas-frequentes/articles/consigo-receber-pix-com-api-no-nubank (search summary: PSPs deposit into Nu Empresas as a destination account). NuPay for Business API: merchant key/token headers, OAuth2 auth code with PKCE for pre-authorized payments, CIBA/OTP; payment methods debit, credit, Pix; webhooks with optional JWS signature. Seller credential acquisition and onboarding not documented; contact oi-nupay@nubank.com.br. https://docs.nupaybusiness.com.br/checkout/docs/openapi/
- **Enables:** NuPay checkout (shopper pays with Nubank account/credit) if the platform or its PSP is a NuPay merchant. Nothing that settles via a Nu Empresas Pix API.
- **Merchant effort:** n/a for a connect flow. Merchants can still use Nu Empresas as the settlement account of another gateway.
- **Confidence:** Medium (negative claim).

## Cora

- **Method:** 1 (OAuth authorization code, "Modalidade Parceria Cora"), also 3 ("Integração Direta": mTLS certificate + key + client_id). Merchant gets credentials at Conta > Integrações via APIs.
- **Evidence:**
  - Two modes. Direct = certificate + private key, `matls-clients.api.cora.com.br`. Partnership = Client ID/Secret, `api.cora.com.br`. https://developers.cora.com.br/docs/instrucoes-iniciais
  - Authorization code flow: end user logs in and grants consent; code valid 60s; scopes `account`, `payment`, `transfer`, `invoice`; access token 24h; refresh token; session expires after 60 days idle. https://developers.cora.com.br/docs/fluxos-de-autorizacao-e-autenticacao
  - Webhooks: resources `invoice` (`paid`, `overdue` and others), transfer, payment, register; Idempotency-Key header; partner tokens receive all partner-related notifications, end-user tokens only that client's data. https://developers.cora.com.br/reference/criação-de-endpoints
  - Terms: access needs an active partnership or service contract, formal registration, approval at Cora's sole discretion, and submitted cybersecurity policies. Partners cannot resell or white-label the APIs. "Powered by CORA" branding required. https://www.cora.com.br/termos-e-condicoes-de-apis/
- **Partner program:** Yes, and it is what makes OAuth possible. Target partners: ERPs, CRMs, BPOs, accounting firms. Whether a store builder qualifies is not stated.
- **Enables:** The "QR Code Pix v2" endpoint is a boleto-with-Pix charge (requires customer, services, `due_date`; scope `invoice`). It is not a plain dynamic `cob`, and the merchant must have a Pix key. https://developers.cora.com.br/reference/qr-code-pix-v2. Webhook: yes. No card.
- **Merchant effort:** Low in partner mode (login and consent). High in direct mode (certificate). Platform effort: partner approval at Cora's discretion plus a security review.
- **Confidence:** High on the mechanism. Not confirmed: partner approval criteria, and whether MEI accounts can authorize.

## Itaú (Pix recebimentos / cobrança)

- **Method:** 3 (client_id + dynamic mTLS certificate), **plus a partner-connect path ("Integradores Pix")**: the merchant links a Pix key to a registered integrator in Bankline, then types CNPJ and Pix key in the platform. This is the closest thing to "type an account name" among the banks, but requires the platform to be a registered Itaú Pix integrator.
- **Evidence:**
  - Direct path: client_id from an Itaú "ponto focal" plus a temporary token valid 7 days, create and sign a certificate (CSR), then OAuth client_credentials at `https://sts.itau.com.br/api/oauth/token` with access tokens valid 300s. https://devportal.itau.com.br/certificado-dinamico-credenciais, https://devportal.itau.com.br/certificado-dinamico (search summaries)
  - Integrator path: Bankline > Cobrança > Integradores Pix > pick key > "Conectar com integrador Pix" > choose integrator and "Acesso Completo" (or "Somente consulta") > confirm with security device. Only legal representatives. Key must be under the same CNPJ. Then enter the data on the platform. https://ajuda.omie.com.br/pt-BR/articles/6817569-configurando-a-integracao-com-o-itau-pix-via-api, https://shipay.freshdesk.com/support/solutions/articles/154000127006-shipay-pix-ita%C3%BA. Registered integrators seen: Omie, Shipay, Sankhya, MemoCash, Destaxa, Fiserv, Software Express. https://www.scribd.com/document/704071376/ITAU-Habilitacao-de-Parceiros-Pix-Telas (search summary)
  - Via Celcoin the merchant still supplies client id/secret, CSR/KEY files and Pix key. https://suporte.celcoin.com.br/hc/pt-br/articles/50243301153947-Configura%C3%A7%C3%A3o-do-PIX-Ita%C3%BA
- **Partner program:** Yes. Integrators are enabled by Itaú. "Conexão Itaú" is the partnership program (software house, integrator, ERP). How to be added to the Bankline integrator list was not found.
- **Enables:** Issue a Pix charge, fetch the QR, query status, callback on update. No card.
- **Merchant effort:** Direct path: high (OpenSSL, manager contact, expiring token). Integrator path: low to medium, with a security-device confirmation.
- **Confidence:** High for flows (two independent guides agree). Medium for becoming a listed integrator (not found). Itaú developer portal itself returned 503.

## Bradesco (Pix cobrança API)

- **Method:** 3. Merchant registers at Bradesco Developers, subscribes to the Pix product (production plan, approval up to 2 days), uploads the public key of an A1 ICP-Brasil certificate, then receives Client ID + Client Secret. The bank manager is involved. Max 2 credential pairs per merchant; Pix needs its own pair.
- **Evidence:** https://ajuda.omie.com.br/pt-BR/articles/10127532-configurando-a-integracao-api-com-o-bradesco. Bradesco Pix manual: https://assets.bradesco/content/dam/portal-bradesco/pix/assets/docs/api_pix_200.pdf (listed, not read). mTLS plus A1 certificate per the kmee comparison (secondary).
- **Partner program:** None found.
- **Enables:** Pix cobrança (dynamic QR, with due date), webhook.
- **Merchant effort:** High (A1 certificate costs money and renews yearly, portal and manager steps).
- **Confidence:** Medium.

## Banco do Brasil (Pix cobrança API)

- **Method:** 3. Merchant needs an active PJ checking account and a registered Pix key. Registers at BB Developers, creates an application, then copies Client ID, Client Secret and the Developer Application Key (`gw-dev-app-key`). A1 ICP-Brasil certificate is uploaded to the application.
- **Evidence:** https://forum.casadodesenvolvedor.com.br/topic/48669-obtendo-credenciais-para-emiss%C3%A3o-de-pix-banco-do-brasil-v2/ and https://sisop.com.br/pix-api-gerando-credencias-e-certificado-no-banco-do-brasil/ (search summaries). Webhook: merchant registers Pix key + URL in the BB portal and activates "Pix Recebido" (Kobana guide). https://ajuda.kobana.com.br/pt-BR/articles/8861604-como-receber-por-pix-pela-api-do-banco-do-brasil. Official: https://apoio.developers.bb.com.br/apis/28 (listed). `bb.com.br` page returned 403.
- **Partner program:** None found for Pix receipts. Not confirmed either way.
- **Enables:** Pix cob/cobv, webhook. No card.
- **Merchant effort:** Medium to high.
- **Confidence:** Medium-low (third-party only).

---

## Cross-cutting observations

1. **Nobody except SumUp and Cora offers a true merchant-login OAuth for receiving payments.** SumUp's `payments` scope needs SumUp review. Cora's needs Cora partner approval. Stone Open Bank has a consent-link flow, but onboarding is sales-gated and the docs are 2021-22.
2. **Bank "partner connect" paths are a hybrid between 1 and 2.** Itaú (Integradores Pix), Sicredi (provedores homologados) and Sicoob (empresa parceira) let the merchant authorize the platform inside their own bank channel. The merchant then sends the platform a Pix key, CNPJ, client_id or contract number. Each requires the platform to be pre-registered with the bank, which is a bank-by-bank business process. A single platform would not get all three without separate applications.
3. **mTLS certificates.** Direct paths at Itaú, Inter, Sicredi, Sicoob, Bradesco, BB, C6 and Cora (direct) require a certificate or key pair the merchant generates or downloads. Inter's expires yearly, ICP-Brasil A1 certificates (Sicoob, BB, Bradesco) cost money and renew yearly. This is the main drop-off risk for small food merchants.
4. **Card acceptance via redirect** exists only at Cielo (Checkout/Link), Getnet (Get Checkout), Safra Pay (Checkout/Link) and SumUp (Hosted Checkout). Rede and Stone Online are raw-card gateway APIs requiring PCI. Banks give Pix only.
5. **Webhooks** are documented for all except Ton (none) and Stone Online (transactional API, not confirmed).
6. **Not confirmed anywhere:** per-provider rate limits, which accounts are MEI-eligible (except Inter: no), partner-program entry criteria for Cielo, Rede, Getnet, Stone, Safra, Sicredi, Sicoob, Itaú.
7. **Only Itaú, Sicredi and Sicoob have any partner path in which the merchant never handles a certificate**, and all depend on the bank's list of registered integrators.
