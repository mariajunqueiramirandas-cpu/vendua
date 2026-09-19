# 12 — Domains and TLS

> Status: Proposed · Last reviewed: 2026-09-11
> Decision: [ADR 0010](../adr/0010-automated-domains-tls.md)

Every tenant gets a working hostname at provisioning and a custom domain when
they want one. Both paths are fully automated — DNS, cert issuance, attachment,
and verification happen without human steps.

## Default hostname

At provisioning, the Provisioner creates `slug.vendua.com.br` (slugified,
collision-checked tenant slug). Covered by a **wildcard cert** for
`*.vendua.com.br` issued via DNS-01 — no per-tenant cert work, live in seconds.
If the merchant never configures a custom domain, this is their permanent,
fully-supported address.

## Custom domain flow

States: `pending → instructions_sent → verified → active → failed` (and
`repairing`).

1. Merchant enters the domain in the admin (or requests via WhatsApp/onboarding).
   Control Plane creates a `domains` row: `pending`.
2. Instructions generated: CNAME `www`/subdomain → `edge.vendua.com.br`, or
   ALIAS/ANAME/flattened-CNAME at apex where the DNS provider supports it; apex
   redirects `→ www` when it doesn't.
3. **Verification**: Control Plane polls (backing-off schedule) for either a
   TXT at `_vendua.<domain>` (proves control; preferred) or a CNAME already
   pointing at us. On success → `verified`.
4. **Attachment**: domain marked `active`; edge resolves it to the tenant;
   cert issued on first request via on-demand TLS.
5. Continuous re-verification: a verified domain that stops resolving flips to
   `repairing`, notifies the merchant with exact fix steps, and the storefront
   keeps serving on `slug.vendua.com.br` (which never stops working — it's the
   permanent fallback).

## TLS issuance

**Default: Caddy on-demand TLS** at the edge.

- On-demand issuance asks an internal `ask` endpoint before requesting a cert:
  `GET /control/v1/domains/ask?domain=x` → 200 only if the domain is
  `verified`/`active`. This prevents cert-minting abuse by arbitrary
  Host headers.
- Rate limits: Let's Encrypt allows ~50 certs/week/registered domain on the
  base limit — fine for steady-state onboarding; batch bursts (migration,
  launch week) need a queue, and the `vendua.com.br` subdomain path always
  works regardless.
- Wildcard `*.vendua.com.br` via DNS-01 is separate and renewed on the normal
  schedule.

**Alternative (likely better past ~100 custom domains): Cloudflare for SaaS.**
Custom Hostnames API handles per-domain cert issuance + renewal + edge serving;
the DNS-check UX is better (Cloudflare pre-validates). Trade-off: adds a vendor
dependency and puts Cloudflare in the serving path. The domain model here is
deliberately issuer-agnostic — switching issuers changes the provisioner, not
the Contract.

## If Venduá registers the domain ("included in the plan")

Mostly a legal/ops problem, flagged honestly:

- `registro.br` EPP automation requires an accredited registrar — realistically
  you'll use a reseller API for `.com.br`.
- **Titularidade**: register with the merchant's CNPJ/CPF as holder, Venduá as
  technical contact. If Venduá holds customer domains, churned customers become
  a liability and disputes get ugly. The merchant must be able to take the
  domain with them.
- Renewal: Venduá pays while subscribed; the Control Plane tracks expiry and
  renews ahead; on churn the domain transfers to the merchant's own
  registro.br account.

## DNS records Venduá controls

| Record                          | Purpose                               |
| ------------------------------- | ------------------------------------- |
| `*.vendua.com.br` → edge        | default hostnames                     |
| `edge.vendua.com.br` → edge IPs | CNAME target for custom domains       |
| `cdn.vendua.com.br` → CDN       | loader, shared assets                 |
| `api.vendua.com.br` → Core      | APIs                                  |
| `status.vendua.com.br`          | status page (different infra ideally) |

## Failure UX (the part everyone forgets)

- Wrong customer DNS → the domain sits in `failed`/`repairing` with the exact
  record to fix; merchant sees it in admin; `slug.vendua.com.br` keeps selling.
- Cert issuance failure → alert + retry with backoff; never block the
  subdomain path.
- Domain expired → same `repairing` path; grace period serves a
  renewal-required notice via the `notices` surface on the subdomain only.
