# 16 — Operations and Incidents

> Status: Proposed · Last reviewed: 2026-09-11

Centralization trades _many small failures_ for _fewer, bigger, shared
failures_. A Saturday-dinner-rush Core outage is 1000 stores down at once — the
existential scenario this doc exists to make survivable. Independence is gone;
what replaces it is blast-radius engineering.

## SLOs (initial)

| Surface                               | SLO                                              |
| ------------------------------------- | ------------------------------------------------ |
| Storefront serving (edge + artifacts) | 99.9% monthly — static, cheapest to keep alive   |
| `/storefront/v1` reads                | 99.9%                                            |
| `/checkout/v1`                        | 99.95% — this is the revenue path                |
| Order notification delivery           | 99% within 5 min                                 |
| Control Plane                         | best-effort; never in the request path by design |

## Blast-radius analysis

| Component             | Failure blast radius                   | Mitigation                                                                  |
| --------------------- | -------------------------------------- | --------------------------------------------------------------------------- |
| Edge                  | All storefronts                        | ≥2 nodes; static artifacts cached; `v.js` kill switch still works from CDN  |
| Core                  | All live data (status, cart, checkout) | Multi-instance; static shells keep serving; loader overlays inform shoppers |
| Postgres              | Everything above                       | Managed HA or rehearsed failover; PITR backups; restore drill quarterly     |
| Artifact store        | New deploys only                       | Edge keeps serving last-known-good from cache                               |
| MP API                | Payments only                          | Degrade to WhatsApp ordering ([13](13-payments.md))                         |
| Control Plane         | Operations pause                       | Nothing customer-facing depends on it                                       |
| A Kernel train        | Bounded by rings by design             | Gates halt promotion; per-ring rollback                                     |
| A storefront artifact | One tenant                             | Re-promote previous release                                                 |

## The kill switch

Two levels, both deliberate:

1. **Per-tenant**: Control Plane `loader_state = maintenance` (+ message). Edge
   serves it to `v.js` from cache; the store shows a controlled overlay —
   "instabilidade, peça pelo WhatsApp +55…" — even with Core down. Use for:
   merchant request, abuse, bad deploy that keeps passing probes.
2. **Global emergency notice**: `kind: emergency` notice fanned out to all
   tenants — platform incident comms without touching any storefront.

## Health model

Synthetic probes per live hostname every 60 s (Control Plane):

- catalog page returns 200 and contains `vendua-state`
- `__VENDUA_LOADER__` ping answers
- checkout smoke test against the tenant's sandbox flag (creates a session,
  no order)

Alerts: probe failures → incident → auto-rollback evaluation → WhatsApp/email
to on-call. Platform-level: Core/edge/DB golden signals; MP webhook lag;
cert-issuance failure rate; train gate rejections.

## Runbook index

| Incident                | Detect                                      | First actions                                                                                                       |
| ----------------------- | ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| Core outage             | API SLO burn, probe failures                | Verify edge serves static shells + loader overlays; failover/rollback Core deploy; global `service_incident` notice |
| Edge outage             | External probe failure                      | Failover node; CDN-cached artifacts keep serving for warm hostnames                                                 |
| Bad Kernel train        | Gate rejection, checkout-rate drop          | Halt train; roll back affected rings; bisect release                                                                |
| MP webhooks lagging     | Webhook age metric, payment-state staleness | Replay endpoint; MP status check; comms template to affected merchants                                              |
| Cert issuance failures  | `cert_state=failed` rate                    | Rate-limit check; `ask` endpoint health; subdomain path unaffected                                                  |
| Storefront artifact bad | Per-tenant probe fail                       | Re-promote previous release (automatic when policy allows)                                                          |
| Agent runaway           | `agent_tasks` cost/time alerts              | Kill task; quarantine storefront PR; review task contract                                                           |
| DB failover             | DB health                                   | Promote replica / restore; verify RLS + outbox integrity before traffic                                             |

## Capacity notes

- Peak traffic is _meals_: lunch 11–14, dinner 18–23, weekends worst. Load
  tests model that shape, not flat RPS.
- Edge + artifacts scale horizontally and are cheap to over-provision — do so.
- Core is sized for checkout writes, not page views (reads are CDN/edge-cached).
- The loader endpoint must survive everything: it reads a Control Plane
  snapshot cached at the edge, so it works even during a CP or Core outage.

## Status and comms

- Public status page (`status.vendua.com.br`) on infrastructure that doesn't
  share fate with the platform.
- Merchant-facing incident notices go through the same `notices` pipeline —
  the fleet's own mechanism is the comms channel.
- Post-incident: `incidents` row completed with timeline; anything that paged a
  human gets a runbook entry or an automation fix — the fleet is too big for
  repeated manual response.
