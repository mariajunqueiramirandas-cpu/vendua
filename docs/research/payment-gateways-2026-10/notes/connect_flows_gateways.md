# Connect flows: can a platform attach a merchant's EXISTING gateway account?

Researched 2026-10-02 (all "accessed" dates below are 2026-10-02). Brazil only. Fees not researched.
Page contents were read through a summarising fetch tool, not raw HTML, so quotes are paraphrases unless in quotation marks. Items marked UNCONFIRMED could not be verified.

Method codes: (1) one-click login/OAuth/partner connect; (2) type an account name; (3) paste API keys; (4) platform-created sub-accounts; (5) no public API for online payments.

## Summary table

| Provider             | Method                                                            | Pix dynamic QR via API                                          | Platform fee on merchant's own account                      | Confidence  |
| -------------------- | ----------------------------------------------------------------- | --------------------------------------------------------------- | ----------------------------------------------------------- | ----------- |
| Mercado Pago         | 1 (OAuth, public)                                                 | yes                                                             | yes (`application_fee`)                                     | high        |
| PagBank              | 1 (Connect OAuth, public)                                         | very likely (scope `payments.create`), not explicitly confirmed | split exists; per-charge fee on a Connect token UNCONFIRMED | medium      |
| Stripe BR            | 1 (OAuth legacy / Account Links)                                  | yes (`pix_payments`)                                            | yes, only if platform is based in Brazil                    | medium-high |
| Adyen                | 1 for partners, sales-gated                                       | Pix exists; BR platforms coverage UNCONFIRMED                   | n/a                                                         | low-medium  |
| PayPal BR            | 1 (Partner Referrals), approved partners only                     | Pix via PPCP since Apr 2026                                     | yes (partner fees)                                          | medium      |
| Pagar.me             | 1 via Hub, partner-gated (not public OAuth); public path is 3     | Pix yes (Hub config lists PIX)                                  | UNCONFIRMED                                                 | medium      |
| Appmax               | 1 via App Store (install/authorize), approval for public apps     | yes                                                             | UNCONFIRMED (billing model + split mentioned)               | medium      |
| Pagaleve             | 1 on partner platforms ("Vincular"), else 3; BNPL only            | Pix upfront + Pix parcelado                                     | UNCONFIRMED                                                 | low-medium  |
| Iugu                 | 3 (token) or 4 (subcontas)                                        | yes, via invoice                                                | split via invoice, probably                                 | medium      |
| Zoop                 | 4 (sellers under marketplace)                                     | yes                                                             | split/markup exist                                          | medium      |
| Efí (ex-Gerencianet) | 3 (client_id/secret + .p12 cert); partner account-opening API = 4 | yes                                                             | UNCONFIRMED                                                 | medium      |
| Juno                 | n/a, discontinued (folded into iugu)                              | n/a                                                             | n/a                                                         | high        |
| PicPay               | 3                                                                 | yes                                                             | UNCONFIRMED                                                 | medium      |
| Vindi/Yapay          | 3 (token)                                                         | yes                                                             | UNCONFIRMED                                                 | medium      |
| Ebanx                | 4/enterprise contract; effectively 5 for small merchants          | yes                                                             | n/a                                                         | medium      |
| dLocal               | 4/enterprise contract; effectively 5 for small merchants          | yes                                                             | n/a                                                         | medium      |
| Koin                 | 3 (credentials issued after contract); BNPL                       | yes                                                             | UNCONFIRMED                                                 | low-medium  |

---

## Mercado Pago

- **Method:** 1. Authorization-code OAuth.
- **Evidence:** OAuth page, https://www.mercadopago.com.br/developers/pt/docs/security/oauth/introduction (accessed 2026-10-02): authorization_code valid 10 min, refresh_token 6 months, PKCE supported. Marketplace page, https://www.mercadopago.com.br/developers/en/docs/checkout-api-payments/how-tos/integrate-marketplace (accessed 2026-10-02): "obtain individual access tokens for each seller through OAuth"; Checkout Transparente charges via `/v1/payments` with `application_fee`; Checkout Pro uses `marketplace_fee`.
- **Scopes (answer to "OAuth scope for Pix"):** the authorize request takes `read`, `write`, `offline_access`; marketplace mode needs all three (search snippet from Mercado Pago developer docs, accessed 2026-10-02; not re-verified on the original page). No separate Pix scope was found. Pix is just a payment method on the seller's `access_token`: `POST /v1/orders` with `payment_method.id = "pix"`, `type = "bank_transfer"`, `X-Idempotency-Key` required (https://www.mercadopago.com.br/developers/pt/docs/checkout-api-orders/payment-integration/pix, accessed 2026-10-02).
- **Enables:** Pix dynamic QR (`qr_code`, `qr_code_base64`, `ticket_url`), expiry 30 min to 30 days (default 24 h); cards; Checkout Pro redirect. Webhooks on the Order topic or poll `GET /v1/orders/{id}`.
- **Platform fee possible:** yes. The Pix Orders page itself does not spell out `application_fee` for Pix; the marketplace page names `/v1/payments`. Confirm that Orders API accepts the fee for Pix before relying on it.
- **Merchant effort:** one click plus MP login.
- **Confidence:** high on OAuth and fee; medium on fee-with-Pix-on-Orders-API.

## PagBank (PagSeguro)

- **Method:** 1. PagBank Connect, a public OAuth-style flow. Also "Connect SMS", where the merchant authorises through a code sent by SMS entirely inside the platform (limited to transactions and queries; no refunds or account data).
- **Evidence:**
  - https://developer.pagbank.com.br/docs/connect (accessed 2026-10-02): register an application (name, description, logo, redirect URL) and receive `client_id` and `account_id`; "e-commerce, marketplaces and reconciliation systems are examples of applications that can be connected". Flow: seller authorisation, then exchange the code for `access_token` + `refresh_token`.
  - https://developer.pagbank.com.br/docs/connect-authorization (accessed 2026-10-02): authorize URL `https://connect.pagbank.com.br/oauth2/authorize?response_type=code&client_id=...&redirect_uri=...&scope=...&state=...`; code is single-use, valid 10 min. Scopes listed: `payments.read` (view orders/charges), `payments.create` (create and view orders and charges), `payments.refund`, `accounts.read`, `checkout.create`, `checkout.view`, `checkout.update`.
  - https://developer.pagbank.com.br/reference/obter-access-token (accessed 2026-10-02): grant types `authorization_code`, `sms`, `challenge`; headers `X_CLIENT_ID`, `X_CLIENT_SECRET`.
- **Can a Connect token create Pix orders? (the question asked):** very likely yes, but no page states it in one sentence.
  - Supporting: scope `payments.create` is defined as "create and view orders and charges". The page "Pedido com divisão de pagamento com PIX" (https://developer.pagbank.com.br/reference/pedido-com-divisao-de-pagamento-com-pix, accessed 2026-10-02) shows a Pix order created with a Bearer token that the fetch summary called the "Connect access token", with receivers identified by account id. The Orders API supports Pix with QR code generation.
  - Not confirmed: no page I could open ties `payments.create` to Pix explicitly. `docs/token-de-autenticacao` only says "some APIs require, in addition to the authentication token, ... `client_id` and `client_secret`, obtained through the API Connect" and does not say which.
  - Risk to test first: community post https://developer.pagbank.com.br/discuss/680d1d2246d4e80010ff2bfe (accessed 2026-10-02) shows `403 ACCESS_DENIED: whitelist access required. Contact PagSeguro` when generating a Pix QR in production. So a production Pix order may need PagBank to enable the token or account. No staff reply was visible.
- **Enables:** Orders API with Pix QR (`qr_codes`; one QR per order per a search snippet), card, boleto; PagBank Checkout (hosted) through `checkout.*` scopes. Webhooks via `notification_urls` on the order.
- **Platform fee possible:** UNCONFIRMED for the plain Connect case. Pix split with several receivers is documented, which suggests the platform can be a receiver, but that may make the platform a party to the sale.
- **Merchant effort:** one click (PagBank login and approve), or SMS code.
- **Confidence:** medium. Connect is real and public; Pix-on-Connect-token needs one sandbox test plus a question to PagBank support about the whitelist.

## Stripe Brasil (Connect)

- **Method:** 1 (legacy OAuth), or Account Links onboarding for Standard accounts.
- **Evidence (Connect docs, not the cross-border page):**
  - https://docs.stripe.com/connect/oauth-standard-accounts (accessed 2026-10-02): the page says OAuth "isn't recommended for new Connect platforms"; use Connect Onboarding for Standard accounts instead. The flow is `connect.stripe.com/oauth/authorize?response_type=code&client_id=ca_...&scope=read_write`; the user can pick an existing account or create one; the platform gets `stripe_user_id` and sends `Stripe-Account` on requests. The `account.application.deauthorized` event signals a disconnect.
  - https://docs.stripe.com/connect/standard-accounts (accessed 2026-10-02): the page is marked "Deprecated feature" for new platforms (Accounts v2 / controller properties are the current path), but it states that "extensions or applications that need access to an existing account ... can still use OAuth".
  - Brazil availability: https://stripe.com/en-br/connect/features (Stripe Brasil Soluções de Pagamento Ltda.) shows Connect for Brazil; BR appears in the country lists on https://docs.stripe.com/connect/account-capabilities. UNCONFIRMED: no page I fetched lists "BR platform + BR Standard connected accounts" in one sentence.
- **Enables:** Pix is a one-time payment for BR accounts only; Pix Automático is not available in Brazil. https://docs.stripe.com/payments/pix (accessed 2026-10-02): Connect supports Pix with direct charges, destination charges and separate charges and transfers. With direct charges the connected account must itself have the `pix_payments` capability active (for Standard accounts, the owner turns Pix on in Dashboard > Payment methods). Checkout (hosted redirect), Payment Links and Elements all support Pix. Minimum 0.50 BRL. Webhooks: `checkout.session.completed` and `checkout.session.async_payment_succeeded`.
- **Platform fee possible:** yes on direct charges via `application_fee_amount`, with this limit: "platforms based outside of Brazil with Brazilian connected accounts can't collect application fees through Stripe" (https://docs.stripe.com/connect/direct-charges, accessed 2026-10-02). Venduá would need a Stripe account in Brazil as the platform.
- **Merchant effort:** a Stripe account (new or existing) with BR KYC, plus enabling Pix in the dashboard. Heavier than MP. Stripe's 2026 BR verification updates (support.stripe.com/questions/brazil-updates-to-verification-requirements-for-connected-accounts-of-platforms) tighten KYC for connected accounts.
- **Caveat:** Pix on Stripe settles through Ebanx, which shows as the payee on the shopper's bank statement, and statement descriptors are ignored (Pix page above). Prohibited for crypto, insurance and telehealth/medicine vendors.
- **Confidence:** medium-high for the mechanism; OAuth for NEW platforms is discouraged, so prefer Account Links.

## Adyen (for Platforms), Brazil

- **Method:** two things.
  - (a) For ecommerce-plugin partners, OAuth lets a merchant delegate API access to a partner (https://docs.adyen.com/partners/integration-checklist, accessed 2026-10-02; the dedicated OAuth page URL I guessed returned 404). The partner must support multiple merchant accounts, the Management API and OAuth scopes.
  - (b) Adyen for Platforms is the sub-merchant model (method 4): legal entities, balance accounts, hosted onboarding.
- **Gating:** "You need to contact us" (sales) for Adyen for Platforms (https://docs.adyen.com/platforms/get-started, accessed 2026-10-02). https://docs.adyen.com/platforms/ lists Europe, North America and Asia Pacific only; Brazil was NOT listed there. So Adyen for Platforms in BR is UNCONFIRMED and probably not self-serve.
- **Pix:** documented (https://docs.adyen.com/payment-methods/pix, includes an API-only guide); the fetched pages did not show details, so BR merchant-account requirements are UNCONFIRMED.
- **Platform fee:** not checked.
- **Merchant effort:** an existing Adyen merchant account implies enterprise-sized merchants, not Venduá's small food/delivery merchants.
- **Confidence:** low-medium. Practical verdict: not a fit.

## PayPal Brasil

- **Method:** 1 in spirit. The Partner Referrals API creates a signup link; the seller logs in or creates an account and grants permissions; the platform receives `merchantIdInPayPal` and `permissionsGranted` (https://developer.paypal.com/docs/multiparty/seller-onboarding/before-payment/, accessed 2026-10-02). Webhooks `MERCHANT.ONBOARDING.COMPLETED` and `MERCHANT.PARTNER-CONSENT.REVOKED`. It is restricted to approved partners (same page; https://developer.paypal.com/docs/api/partner-referrals/v2/). Products: `EXPRESS_CHECKOUT` or `PPCP`.
- **Brazil:** search results for the multiparty docs list Brazil as a supported seller country (CNPJ and CPF supported) (accessed 2026-10-02; the country table itself was not fetched). PayPal Complete Payments (PPCP) launched in Brazil in 2025.
- **Pix:** yes, PayPal added Pix to PPCP for SMEs in Brazil, announced 2026-04-13 (https://newsroom.br.paypal-corp.com/2026-04-13-PayPal-passa-a-oferecer-Pix-no-checkout-para-PMEs-no-Brasil, accessed 2026-10-02). The release gives no API details, QR type, or rollout stage. Whether platforms (not just direct PPCP merchants) can use Pix through Orders API is UNCONFIRMED.
- **Platform fee:** yes in principle: "Partner fees enable partners to charge commissions" (https://developer.paypal.com/docs/multiparty/, accessed 2026-10-02). That page does not name Brazil; the fee needs a bank account and is settled daily.
- **Merchant effort:** PayPal business account login plus consent and email confirmation.
- **Confidence:** medium for the flow, low for Pix in the multiparty (platform) context. Needs a PayPal partner approval form.

## Pagar.me (Stone)

- **Method:** the "verify" answer is that the Hub flow EXISTS and is official, but it is partner-gated and not a public OAuth API.
  - https://docs.pagar.me/docs/parceiros (accessed 2026-10-02): partners "must follow the Integration via Hub, our app store"; "you will not have access to any of the merchants' private keys" and use "only the keys provided by Hub"; store activation is done directly by merchants; to join, contact Digital Partners via a form, and the commercial team must understand where the solution fits.
  - https://docs.pagar.me/docs/hub-1 (accessed 2026-10-02): the Hub is an integration platform where merchants install "apps"; the merchant creates an account in the app, completes a checklist of permissions for actions and events, and configures it. Credentials are "Account ID, Access Token". Technical spec is only given to approved partners.
  - Merchant-side proof: Nuvemshop (https://docs.pagar.me/docs/instalando-o-aplicativo-ns and https://pagarme.helpjuice.com/pt_BR/tutoriais-de-ativacao/m%C3%B3dulos-nuvemshop, accessed 2026-10-02): Hub > install > accept permissions > log in with an existing Pagar.me account > configure (Pix included, transparent or redirect checkout) > "Autorizar". Loja Integrada (https://pagarme.helpjuice.com/pt_BR/p2-m%C3%B3dulos-e-plataformas/loja-integrada-%7C-tutorial-de-ativacao, accessed 2026-10-02): "Instalar App" in the Hub redirects back to the platform.
  - Public API: only keys. API v5 uses HTTP Basic with a secret key (`sk_`); no OAuth (https://docs.pagar.me/reference/autentica%C3%A7%C3%A3o-2 and https://docs.pagar.me/docs/chaves-de-acesso, accessed 2026-10-02). Merchant copies the keys from Dashboard > Configurações > Chaves (secret key is shown once). No OAuth hit on docs.pagar.me searches.
  - The earlier claim of an unverified "OAuth/Conectar" flow is therefore: no OAuth endpoints are public, but a Hub-based authorise-and-install flow is real and works like OAuth for the merchant.
- **Enables:** Pix, cards, boleto; transparent or redirect checkout per the Nuvemshop config; payment links exist in the API (https://docs.pagar.me/reference/criar-link). Webhooks: not confirmed for Hub apps.
- **Platform fee possible:** UNCONFIRMED for Hub apps. The Marketplace/split model (recebedores, KYC, split rules) is method 4 and makes the platform a party, so it is not a fit for the no-custody design.
- **Merchant effort:** low via Hub (click and log in); medium via keys.
- **Confidence:** medium. Gate: application to Pagar.me Digital Partners.

## Appmax

- **Method:** 1 through the Appmax App Store; docs https://docs.appmax.com.br/guides/criar-aplicativo (accessed 2026-10-02): the developer creates an app (needs an active CNPJ), supplies a validation URL and a webhook URL; public apps are listed in the App Store and "require Appmax team approval", private apps are invitation-only. Merchant installation redirects to `/app/authorize`; Appmax then POSTs server-to-server to the app's validation URL (the doc names `/app/client/generate`) and expects `{ "external_id": "<UUID>" }` back. Then the app calls `https://auth.appmax.com.br/oauth2/token` (client_credentials, 3600 s) with `client_id` + `client_secret` (https://docs.appmax.com.br/quickstart, accessed 2026-10-02). The exact way per-merchant credentials are tied to the token is not spelled out in the pages fetched: UNCONFIRMED.
- **Enables:** customers, orders, payments (credit card, Pix, boleto, Apple Pay, Google Pay), subscriptions, refunds; webhooks (29 event types). https://docs.appmax.com.br/api-reference/introduction says the API covers payment splits.
- **Platform fee possible:** the app billing model is either external-platform billing or a monthly fee charged to merchants through Appmax; a per-transaction fee is UNCONFIRMED (the splits feature exists).
- **Merchant effort:** low (install app from App Store) but the merchant needs an Appmax account.
- **Confidence:** medium. Public docs are open, but approval is needed to publish.

## Pagaleve

- **Method:** 3 in public docs (Bearer token from a 60-minute session created with API credentials: https://docs.pagaleve.com.br/ and https://docs.pagaleve.com.br/reference/checkoutcontroller_docheckout, accessed 2026-10-02). On Olist the merchant types a username and password (API user and key) after signing the contract (https://ajuda.olist.com/pt_BR/ecommerce-pix/ecommerce-integracao-pagaleve-pix-parcelado). On Yampi the merchant clicks "Vincular com a Pagaleve", fills a Pagaleve form, goes through credit analysis, and returns (https://help.yampi.com.br/pt-BR/articles/8022559-como-configurar-o-pix-parcelado-na-pagaleve): a partner onboarding (1-like), but whether it is open to new platforms is UNCONFIRMED. Docs also list marketplace endpoints ("Listar lojistas pelo id do marketplace").
- **Enables:** hosted checkout redirect (`redirect_checkout_url`, `approve_url`, `cancel_url`); Pix à vista (QR in base64, `is_pix_upfront`) and Pix parcelado; webhook URL for order status.
- **Platform fee:** UNCONFIRMED (marketplace commissions are mentioned in the checkout reference).
- **Merchant effort:** contract plus credit analysis before approval; not instant.
- **Note:** a BNPL add-on, not a primary gateway. Only checked via third-party platform pages.
- **Confidence:** low-medium.

## Iugu

- **Method:** 3 (merchant creates an API token in Alia: Configurações > Integração via API; account admin approves it) or 4 (subcontas created by a marketplace/partner-permissioned account).
- **Evidence:** auth docs https://dev.iugu.com/docs/tokens-de-autentica%C3%A7%C3%A3o and https://dev.iugu.com/reference/autentica%C3%A7%C3%A3o (accessed 2026-10-02): tokens `live`, `test`, `master`, `user`; HTTP Basic, Bearer or `api_token` parameter; sensitive operations (transfers, account creation) need an RSA signature. No OAuth for third-party delegation. iugu Identity (https://developer.iugu.com/identity/) is OAuth 2.0/OIDC for SSO only. Subconta: `POST /marketplace/create_account` needs a marketplace/partner account and RSA signature, returns `user_token`, `live_api_token`, `test_api_token`, only works in production and cannot be deleted (https://dev.iugu.com/reference/criar-subconta, accessed 2026-10-02).
- **Enables:** Pix only through invoices (`payable_with: pix` or `all`; invoice has QR + copy-paste). Pix does not exist in direct charge (https://dev.iugu.com/docs/realizar-cobran%C3%A7a-com-pix-por-api, per search snippet). Webhooks exist (not fetched in detail).
- **Platform fee possible:** split per invoice uses `recipient_account_id` + cents/percent and covers Pix (`pix_percent`) (https://dev.iugu.com/docs/split-por-fatura-no-cart%C3%A3o-de-cr%C3%A9dito-por-api). The page does not say whether a plain merchant account may split to another account without marketplace permission: UNCONFIRMED.
- **Merchant effort:** medium (generate token, get it approved). Also hosts Juno's migrated customers.
- **Confidence:** medium.

## Zoop

- **Method:** 4. Sellers must be registered under the platform's `marketplace_id` (legal name, address, CPF/CNPJ, birth date, MCC) and credentialed via KYC (https://docs.zoop.co/docs/duvidas-frequentes-faq-2, accessed 2026-10-02). Auth is HTTP Basic with `marketplace_id`, `seller_id`, and the `publishable_key` (ZPK) (https://docs.zoop.co/docs/introducao and https://docs.zoop.co/reference/autenticacao_ref). No OAuth. Nothing found about linking a merchant's existing Zoop account.
- **Enables:** Pix through the same transaction endpoint (`payment_type: "pix"`, response `qr_code.emv`, expiry 5 min to 24 h by default) (https://docs.zoop.co/docs/criando-transacao-pix, accessed 2026-10-02); card; boleto. Webhooks configured per marketplace and event type.
- **Platform fee possible:** yes through the marketplace model (fees plus partner markup), but the platform is then the marketplace operator (KYC and liability).
- **Merchant effort:** high; goes through the platform's KYC.
- **Confidence:** medium.

## Efí (ex-Gerencianet) and Juno

- **Juno is NOT now Efí.** Gerencianet rebranded to Efí on 2023-01-30/31 (https://sejaefi.com.br/blog/gerencianet-sera-efi). Juno was bought by EBANX (2021) and its client book sold to iugu in 2022; Juno API modules ran until 2023-04-30 (https://finsidersbrasil.com.br/negocios-em-fintechs/ebanx-vende-carteira-de-clientes-da-juno-para-a-fintech-iugu/ and https://www.edvan.com.br/MigrarIugu, both via search results, accessed 2026-10-02). Juno: method 5, no longer an option; those merchants are on iugu (see above).
- **Efí method:** 3, and the heaviest one. OAuth2 client credentials (Basic) with scopes (e.g. `cob.read`) AND a mandatory P12/PEM certificate on every request, two credential sets (prod and staging), up to 5 certificates per environment (https://dev.efipay.com.br/docs/api-pix/credenciais, accessed 2026-10-02). This is OAuth between the merchant's own app and Efí, NOT a delegation flow. Partner program (https://sejaefi.com.br/programa-de-parceria): commissions on clients' settlement volume, partner coupons and landing page, and an "API Abertura de Conta" for opening accounts through the API (method 4).
- **Enables:** Pix charges with QR and "Pix Copia e Cola" (cob), boleto, card, payment links, subscriptions, "Marketplace (payment split)" in the Billing API (sejaefi.com.br/efi-pay snippet). Webhooks for Pix: standard BCB webhook per key (not fetched).
- **Platform fee possible:** split exists for the Billing API; for the Pix API UNCONFIRMED.
- **Merchant effort:** high for small merchants (create app, download certificate, paste secrets).
- **Confidence:** medium.

## PicPay (Empresas / E-commerce)

- **Method:** 3. Merchant opens the Merchant Panel > Integrações and generates credentials (https://developers-business.picpay.com/wallet/checkout/authentication, accessed 2026-10-02). Two sets: direct API `client_id` + `client_secret` (shown once) + `x-seller-token`; or plugin set `x-picpay-token` + `x-seller-token` for platform plugins. OAuth2 `client_credentials` at `https://api.picpay.com/oauth2/token`, token lasts 5 minutes. The page states that no merchant-authorises-platform flow or scopes are described. The old token pair is being phased out.
- **Enables:** transparent checkout API, redirect/lightbox checkout, card, PicPay wallet QR, Pix (QR and copy-paste; default expiry 10 min), payment link API (https://developers-business.picpay.com/checkout/docs/transparent-checkout/api and /pix/docs/introduction, accessed 2026-10-02). Webhooks for Pix status changes. No sandbox: tests run in production with refunds. Transparent card checkout requires PCI DSS; redirect avoids that.
- **Official integration options listed:** VTEX, Magento 2, public API.
- **Platform fee possible:** UNCONFIRMED; no partner fee mechanism seen.
- **Merchant effort:** medium (generate and paste 2 to 3 values; Nuvemshop flow also pastes tokens).
- **Confidence:** medium.

## Vindi / Yapay (Vindi Pagamentos)

- **Method:** 3. Vindi Pagamentos is the renamed Yapay; the merchant copies the integration token (`token_account`) from Minha Conta (search results: https://atendimento.yapay.com.br/hc/pt-br/articles/360033187713-Como-ter-acesso-ao-token-de-integra%C3%A7%C3%A3o-, which returned 503 when fetched; https://ajuda.wbuy.com.br/aplicativos/configurar-vindi-yapay). Separate product: Vindi recurring API, HTTP Basic with a private key from Configurações > Dados da empresa > Chaves de acesso (https://atendimento.vindi.com.br/a/203020644, search snippet). No OAuth found; docs.vindi.com.br returned 503.
- **Enables:** card, bank transfer, Pix. On Yampi the Pix is turned on by selecting the Vindi affiliation, and the QR expiry (default 24 h) is set in the Vindi portal (https://help.yampi.com.br/pt-BR/articles/7979578-como-configurar-o-pix-da-vindi-yapay-na-yampi, accessed 2026-10-02).
- **Platform fee:** UNCONFIRMED.
- **Merchant effort:** medium (copy a token; needs account verification).
- **Confidence:** medium-low (docs pages not fully readable).

## EBANX

- **Method:** no self-serve connect. Auth is a JWS signature (legacy integration key being phased out) and each merchant site gets keys after contract and onboarding (https://docs.ebanx.com/docs/pay-in/processing/payment-methods/country-specific/brazil/pix, accessed 2026-10-02). Sub-accounts exist but need EBANX sales enablement and are described as organisational units under a primary merchant, with no stated way to attach existing accounts (https://docs.ebanx.com/docs/pay-in/features/financial/sub-accounts). Classification: 4 (enterprise contract) for a platform; 5 for a small merchant on its own.
- **Enables:** Pix (direct API, `payment.pix.qr_code_value`, default expiry 5 h), notifications PE to CO.
- **Platform fee:** n/a. **Merchant effort:** contract and onboarding. **Confidence:** medium.

## dLocal

- **Method:** 4/enterprise. HMAC-signed headers (X-Login, X-Trans-Key); "dLocal for Platforms" is sales-led ("Contact Sales"), self-serve SMB signup not described (https://www.dlocal.com/our-industries-v2/marketplace-industry/, accessed 2026-10-02). Brazil: Pix, Pix Automático, SmartPix, boleto, cards, wallets, Pagaleve (https://docs.dlocal.com/docs/brazil). Classification: 4 / effectively 5 for Venduá's merchants.
- **Platform fee:** n/a. **Confidence:** medium.

## Koin

- **Method:** 3, after a commercial contract. Credentials are OrgId, Private Key, Koin account number and Store Code (Cielo docs page https://docs.cielo.com.br/gateway/docs/koin and search snippet, accessed 2026-10-02); on Nuvemshop the merchant contacts Koin B2B, signs, then receives credentials from the commercial team (https://www.nuvemshop.com.br/loja-aplicativos-nuvem/koin). Public API docs at https://api-docs.koin.com.br/ list Pix (QR or copy-paste), cards, BNPL, wallets, webhooks, plugin guides (VTEX, Magento 2, Shopify, WooCommerce, Wake, Uappi). Products on Nuvemshop: boleto parcelado and Pix parcelado, Koin carries default and fraud risk.
- **Platform fee:** UNCONFIRMED. **Merchant effort:** high (contract plus credit approval). **Confidence:** low-medium.

---

## Things I could not confirm

1. PagBank: a single page that says a Connect `access_token` can create Pix orders, and whether Pix on a Connect token needs the whitelist (the 403 community post suggests access may need enabling).
2. Pagar.me Hub: technical spec (partner-only), webhooks for apps, whether a per-transaction platform fee is possible, and whether new SaaS partners are being accepted.
3. Appmax: how per-merchant credentials are returned after install, and per-transaction fees for third-party apps.
4. Stripe: an explicit "BR platform + BR Standard connected account" line on a Connect docs page (only inferred from the BR Connect page and the capability tables); Stripe says OAuth is not recommended for new platforms.
5. Adyen for Platforms coverage in Brazil, and Adyen's Pix requirements.
6. PayPal: Pix availability to multiparty platforms via the Orders API (the press release says only "merchants using PPCP").
7. Platform-fee mechanics for iugu (merchant-token splits), PicPay, Vindi/Yapay, Efí Pix, Pagaleve, Koin.
8. Several vendor sites failed to load (docs.vindi.com.br 503, atendimento.yapay.com.br 503, PayPal help 403, appmax.com.br 403); those items rest on search snippets and third-party platform help pages.
