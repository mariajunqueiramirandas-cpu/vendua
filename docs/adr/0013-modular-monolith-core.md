# ADR 0013: Core is a modular monolith on Postgres

- Status: Proposed
- Date: 2026-09-11

## Context

Core spans catalog, cart, checkout, delivery, payments, orders, notifications,
identity, analytics — ~10 domains. Microservices would buy independent scaling
we don't yet need and pay for it with distributed-transaction complexity,
deployment sprawl and N-integration surfaces — fatal for a small team building
the platform itself.

## Decision

One deployable Core (TypeScript; Bun or Node; Hono/Fastify) with **enforced
internal module boundaries**: modules communicate through explicit service
interfaces and a transactional outbox, never through each other's tables.
Postgres is the system of record; `tenant_id` on every row with RLS as a second
line of defense. If a module ever needs independent scaling, it is extracted
with its interface and events unchanged.

## Consequences

### Positive

- One deployment, one transaction boundary for checkout, one schema migration
  story — the correct simplicity for the first few years.
- Outbox + module interfaces preserve the _option_ of services later without
  paying for them now.
- RLS + explicit scoping gives defense in depth without a service mesh.

### Negative / costs

- Module boundaries require review discipline — the monolith's failure mode is
  gradual erosion into a ball of mud (lint import rules help).
- One bad Core deploy can stall all writes — mitigated by rings on the read
  path (static shells keep serving) and fast rollback.

## Alternatives considered

- **Microservices from day one**: distributed-systems cost before the
  complexity budget exists; rejected.
- **Supabase/Firebase-style BaaS**: faster CRUD scaffolding but the checkout /
  payments / notices / fleet logic doesn't fit a generic backend, and we'd
  rebuild it within a year.

## Links

- [architecture/01-core](../architecture/01-core.md)
