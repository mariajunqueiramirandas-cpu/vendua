# ADR 0006: A tiny runtime loader (`v.js`) as the last-resort channel

- Status: Proposed
- Date: 2026-09-11

## Context

Even with SDUI, a Kernel can be too old or too broken to render — or the
storefront's own JS can be broken by a bad deploy. We still need a way to say
"this store is paused" or "platform incident, order via WhatsApp" on _any_
store, in _any_ state, without a rebuild. Without this, the failure mode for a
broken storefront is silently taking orders it can't fulfill — or silently
losing sales with a white screen.

## Decision

Every storefront includes `v.js`: a ~5 KB, dependency-free script served from
`cdn.vendua.com.br`, built and versioned **separately from the Kernel** on a
slow cadence. It polls a minimal state endpoint (edge-cached Control Plane
snapshot) and can render blocking/emergency notices in Shadow DOM. It also
exposes a health ping for synthetic monitoring.

Capabilities are exhaustive and frozen: render blocking/emergency notices;
answer a health ping. Nothing else, ever.

## Consequences

### Positive

- A version-independent channel that survives broken Kernels, broken
  storefront JS, and (via edge-cached state) Core outages.
- The kill switch: any store can be put into a controlled "maintenance"
  overlay without deploying it.
- Shadow DOM isolation means no storefront CSS can break it — the one UI we
  can always trust.

### Negative / costs

- A third rendering system (after Kernel defaults and overrides) — mitigated
  by keeping it deliberately ugly and minimal.
- Feature-creep risk: "just add X to the loader" will be proposed repeatedly.
  The frozen capability list is the defense; growing it forfeits the escape
  hatch.

## Alternatives considered

- **Kernel handles its own degradation**: fails exactly when needed most —
  when the Kernel is the broken thing.
- **Edge-level HTML rewriting per notice**: couples emergency comms to serving
  internals and can't react to client runtime failures.

## Links

- [architecture/05-system-surfaces — the loader](../architecture/05-system-surfaces.md#the-loader-vjs)
- [architecture/16-operations-and-incidents](../architecture/16-operations-and-incidents.md#the-kill-switch)
