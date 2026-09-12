# ADR 0010: Automated domains and TLS

- Status: Proposed
- Date: 2026-09-11

## Context

Every tenant needs a working hostname at signup (`slug.vendua.com.br`) and a
custom domain path that requires zero human ops steps. "Domain included in the
plan" additionally implies registration, which for `.com.br` is mostly a
legal/ops problem (registro.br EPP requires an accredited registrar).

## Decision

- `*.vendua.com.br`: wildcard cert via DNS-01 — the default path, instant.
- Custom domains: customer CNAME/ALIAS to `edge.vendua.com.br`; Control Plane
  verifies via TXT/CNAME polling; **Caddy on-demand TLS** issues certs at the
  edge, gated by an `ask` endpoint that only approves Control-Plane-verified
  hostnames.
- Domain states are first-class (`pending → verified → active → repairing`)
  with continuous re-verification; `slug.vendua.com.br` always remains as the
  permanent fallback hostname.
- If Venduá registers domains, the **merchant's CNPJ is the titular**, Venduá
  is technical contact; churn transfers the domain to the merchant.
- Cloudflare for SaaS (Custom Hostnames) is the documented alternative issuer
  past ~100 custom domains; the domain model is issuer-agnostic.

## Consequences

### Positive

- Zero-touch provisioning for the default path; a merchant is live in seconds.
- Cert abuse is prevented by the `ask` gate; Let's Encrypt rate limits are
  managed by queueing + the subdomain fallback.
- Failure UX is designed in: broken customer DNS degrades to the subdomain,
  never to a dead store.

### Negative / costs

- On-demand TLS adds a small cold-latency first-hit per new domain.
- Apex domains depend on customer DNS-provider capability (ALIAS/CNAME
  flattening) — instructions and `www` redirect cover the gap.
- registro.br titularidade/transfer process is genuinely manual-ish — honest
  ops cost of "included domain".

## Alternatives considered

- **Cert per domain via HTTP-01 at a fixed cert service**: more moving parts
  than on-demand TLS at the same edge that serves traffic.
- **Cloudflare for SaaS now**: adds a vendor in the serving path before the
  volume justifies it; kept as the scaling escape hatch.

## Links

- [architecture/12-domains-and-tls](../architecture/12-domains-and-tls.md)
