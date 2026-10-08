# ADR 0038: Pangolim's domain is bought, hosted and renewed by Venduá

- Status: Accepted (decided 2026-10-08; not built yet)
- Date: 2026-10-08
- Amends: [ADR 0010](0010-automated-domains-tls.md) (TLS issuer, registration),
  [ADR 0032](0032-three-plans-for-launch.md) (what opens Pangolim)

## Context

A domain included in the plan is one of Pangolim's main offers
([ADR 0032](0032-three-plans-for-launch.md)), and Pangolim stays closed until own domains are
built. Today a PRO+/Pangolim owner brings a domain they already bought, Core verifies a CNAME and
a TXT record (`modules/billing/domains.ts`), and then staff attach the host to `edge` in
Dokploy, wait for its certificate and press "Ativar domínio" in the CRM. Nothing buys a domain,
renews one, or notices one expiring.

What the `.com.br` registry imposes (researched 2026-10-07; sources below):

- The holder is a Brazilian CPF or CNPJ. For a CPF, registro.br's public lookup shows the name
  and part of the number.
- registro.br has no reseller API. Machine registration goes through an accredited provider:
  EPP after a technical homologation and a contract with NIC.br, or a reseller that already is
  one (Openprovider, CentralNic Reseller, OpenSRS).
- **All domains of one CPF/CNPJ share one provider**, registro.br itself included. Registering
  under a document that already has a provider fails ("belongs to another provider") until the
  holder changes it in registro.br's panel (Titularidade → Alterar provedor). The change is
  self-service, takes hours, leaves nameservers untouched, and moves all that holder's domains.
- The registry checks DNS before it registers: two nameservers must already answer for the
  domain, or the order expires after 14 days. Orders are asynchronous: usually under a day,
  documented up to 45 days.
- registro.br's RDAP is public: `https://rdap.registro.br/domain/<name>` answers 404 for a free
  name and returns nameservers and events for a registered one.

Dokploy's Traefik owns :80 and :443, watches `/etc/dokploy/traefik/dynamic` (file provider,
`watch: true`) and has a `letsencrypt` resolver using the HTTP challenge on `web`. Dokploy adds a
compose service's domains as labels at deploy time, so its Domains UI or API means a redeploy per
domain.

## Decision

**What is included.** One `.com.br` per store whose plan has `customDomain`, registered and
renewed by Venduá at Venduá's cost. Other endings aren't sold. A domain the owner already has is
connected, not bought, and its renewal stays the owner's.

**The holder is the store's CNPJ; the owner's CPF is the fallback.** The holder is its own record,
not the billing data: `subscriptions.payer_document` is whoever pays the plan and only pre-fills the
form. At purchase a user with the `owner` role enters or confirms the holder's document, legal name
and address, and states that the holder authorizes the registration; the order keeps that
confirmation (who, when) beside the holder data. A `.br` holder can't be edited later, only
transferred by registro.br's procedure, so this step can't be skipped. The registry checks the
holder's name and address against the Receita Federal's record, so a CNPJ's legal name and address
are pre-filled from its public record. Choosing a CPF shows that the name and part of the number
become public. Venduá's own CNPJ is the billing and technical contact. The merchant always holds the
domain; Venduá is never the holder (as ADR 0010 said).

**The owner picks the name any time; the order is placed at the first payment.** The admin searches
names live through RDAP and suggests some from the store's name and slug. The choice is kept as an
order `awaiting_payment`. The paid first invoice of a plan with `customDomain` places it, and a
choice made after that payment is placed at once. Availability is checked again at placement; a name
taken in between asks the owner to pick again. A trial never buys a domain, as ADR 0025's paid-only
rule already holds for `customDomain`. A first payment by card can still be refunded or charged back
after the domain is bought. Venduá accepts that risk rather than delay the purchase: one
registration is a small cost next to a month of the plan, the reversal leaves the store unpaid, so
the domain lapses and is never renewed, and the order records the loss with a staff event.

**The reseller is Openprovider** (decided 2026-10-08), behind one adapter interface
(`available`, `register`, `orderStatus`, `renew`, `setNameservers`). It has free signup, no
volume commitment, a prepaid balance and a REST API; membership starts at about US$ 49 a year.
CentralNic Reseller wants 100 domains in the first year and signed contracts; OpenSRS no longer
takes `.br` transfers in. Before Core relies on it, one real test registration through the API
confirms: the alphanumeric CNPJ is accepted, the `.com.br` price, what the move does to the
holder's other domains' renewals, and the provider name owners select in registro.br. The order
is polled by a job until it is registered or fails, with a staff event either way.

**A provider conflict is guided, then retried.** On "belongs to another provider" the admin shows
the registro.br steps with the reseller's provider name and says it moves all that document's
domains. Core retries the order daily for 7 days.

**Venduá hosts the DNS on Cloudflare** (decided 2026-10-08): one Cloudflare account, zones created
through its API, records DNS-only so traffic reaches the edge and Traefik issues the certificate.
Cloudflare refuses a zone for a name that isn't registered yet (error 1049), and the registry needs
answering nameservers before it registers, so an included domain is registered with a zone on
Openprovider's DNS (the root's A record), then gets its Cloudflare zone, and Core moves its
nameservers to the pair Cloudflare assigned through the reseller's API. Core reads that pair from
each zone rather than assuming one. A connected domain is delegated by its nameservers
(registro.br's "Servidores DNS"); CNAME + TXT stays for a subdomain the owner can't delegate. The
zone holds A records for the root and `www`. DNS can't redirect, so both names are custom hosts in
Core, each with its own route and certificate, and the edge answers the one that isn't primary with
a redirect to the one that is. A lookup can't list a zone (DKIM selectors, SRV and verification
records aren't discoverable), so before showing our nameservers the admin builds an inventory: the
records Core finds (MX, SPF, DMARC, the known DKIM selectors of the mail presets, common names),
plus a paste of the old provider's zone export or records the owner adds. The owner reviews and
confirms it. A domain signed with DNSSEC (RDAP shows `delegationSigned`) can't be delegated until
its DS record is removed at registro.br, or the whole zone fails to resolve; the admin says so and
Core re-checks. An owner who would rather keep their DNS points the root's A record and `www` at us
instead. Nameservers pointing at us are the proof of control for a delegated domain.

**TLS needs no staff step.** A `domains-sync` sidecar, on the internal network only with no route
from Traefik, polls Core for hosts to serve with certificates (`GET /sync/v1/custom-hosts`,
read-only under a secret of its own, like the edge's: verified, active, repairing or lapsed) and is
the only process that writes `/etc/dokploy/traefik/dynamic/vendua-custom-domains.yml` (bind-mounted,
rewritten by rename only when it changes). The internet-facing edge never gets that mount: a
compromised edge must not be able to route the admin's or the CRM's host. The sidecar renders every
host through one fixed template and drops any host that fails Core's host pattern, falls under the
store domain or is one of the platform's own hosts. Each host gets a `websecure` router with the
`letsencrypt` resolver, a `web` router redirecting to HTTPS, `service: vendua-edge@docker` (the file
provider doesn't see Docker services unless named) and a low explicit priority, so it can never
outrank a Dokploy host. Only hosts Core verified reach the file, which is what ADR 0010's `ask`
endpoint was for. A Core job probes `https://<host>` and, on a valid certificate, calls
`activate_custom_domain()`; the CRM button stays as an override. Before a host is verified Core also
checks AAAA (none, or ours) and CAA (none, or one allowing Let's Encrypt).

**Renewal and lapse.** While the store's plan has `customDomain` and is in good standing, Core
renews 30 days before expiry. A daily RDAP pass records expiry and nameservers for every domain.
When the store loses the feature (downgrade, unpaid plan, CRM toggle) or leaves, the domain stays
the merchant's: renewal stops at the end of the paid period; notices go out 30, 7 and 1 days before
expiry with the steps to set the provider to "Nenhum (0)" and renew at registro.br; the store's
primary address goes back to `<slug>.vendua.com.br`; the domain turns `lapsed` and keeps its route
and certificate (the sidecar emits lapsed hosts too), and the edge answers every request on it with
a redirect to that address instead of the store, until the owner moves the nameservers away, or the
domain is gone for good: past expiry, the registry still lets the holder restore it (18 days at
Openprovider), so the route and zone stay until RDAP shows the name free. Then Core drops the host
and its zone. An active domain whose DNS stops pointing at us turns `repairing`; the store keeps
selling on its platform host.

**Data.** `custom_domains` gains `source` (`included` | `connected`), `method` (`ns` | `cname`),
`expires_at` and `registrar_ref`, and its states grow to cover ordering, issuing, repairing and
lapsed. A `domain_orders` table (RLS) records each register and renew: host, holder document, kind,
legal name, address and who confirmed them when, status, reseller reference and error, and cost in
integer cents. The buy endpoint takes an `Idempotency-Key`, and one store has at most one open
order. What staff should hear (ordered, registered, failed, renewal failed, lapsing) is
`recordStaffEventTx` in the transaction that changed it.

**Build order.** (1) automated TLS and DNS hosting with delegation, which connected domains use
too; (2) the registrar adapter, orders and the purchase screen; (3) renewals, RDAP and lapse.
Staff open Pangolim after (2).

## Consequences

### Positive

- "Domínio incluso" is one click for a store with no domain, and connecting one is a single DNS
  change with no staff step.
- Hosting the zone makes the root domain work on registro.br's DNS, which has no ALIAS, and makes
  renewal and repair visible to Core.
- No new component in the serving path: Traefik issues certificates the way it does for
  Dokploy's own domains.

### Negative / costs

- A reseller account with prepaid funds and dollar prices; registration and renewal are Venduá's
  cost on every Pangolim store.
- A store's CNPJ that already has a `.br` provider needs a manual step, and moving it moves its
  other domains to our reseller.
- Venduá runs DNS for merchants, email records included: a mistake there is the merchant's email.
- Traefik's certificates live on one node. A second edge node moves the issuer to Caddy with
  shared storage or to Cloudflare for SaaS; the domain model doesn't change.
- Leaving needs the owner to change the provider at registro.br and to move the nameservers.

## Alternatives considered

- **The owner buys at registro.br and Venduá credits the cost**: no reseller, but not one click.
- **Venduá as an accredited registro.br provider**: cheapest per domain, but a contract,
  homologation and EPP client; revisit at hundreds of domains.
- **Caddy on-demand TLS (ADR 0010)**: Traefik owns the ports, and a catch-all TCP passthrough to
  Caddy would also take the admin, CRM and site.
- **Dokploy's Domains API**: a compose redeploy per domain.
- **Cloudflare for SaaS**: a root domain on registro.br's DNS can't point at it; the escape hatch
  for a second edge node.

## Open

- The owner opens the Openprovider account (membership, prepaid balance, an API user) and a
  Cloudflare API token scoped to this account's zones and DNS. Both go into Core's environment,
  never into the repo.
- The test registration above, before the purchase screen ships.

## Links

- [architecture/12-domains-and-tls](../architecture/12-domains-and-tls.md),
  [deploy/dokploy.md](../deploy/dokploy.md#pro-custom-domains)
- [OpenSRS: .BR domain policies](https://support.opensrs.com/support/solutions/articles/201000063494--br-domain-policies),
  [Openprovider: .com.br](https://www.openprovider.com/domains/tlds/com-br),
  [CentralNic Reseller: .com.br](https://kb.centralnicreseller.com/domains/tlds/com.br),
  [Registro.br: EPP](https://registro.br/tecnologia/provedores-de-hospedagem/epp/),
  [Hostinger: "outro provedor"](https://www.hostinger.com/br/support/?p=1858),
  [Dokploy `traefik-setup.ts`](https://github.com/Dokploy/dokploy/blob/canary/packages/server/src/setup/traefik-setup.ts),
  [Openprovider vs. CentralNic Reseller](https://www.openprovider.com/blog/openprovider-vs-centralnic),
  [Cloudflare: cannot add a domain](https://developers.cloudflare.com/dns/zone-setups/troubleshooting/cannot-add-domain/)
