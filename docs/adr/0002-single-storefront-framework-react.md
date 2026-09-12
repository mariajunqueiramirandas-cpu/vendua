# ADR 0002: React as the single storefront framework

- Status: Proposed
- Date: 2026-09-11

## Context

"Arbitrary custom code" is the product promise — but it must be bounded
somewhere, and the framework is the cheapest axis to bound because it is not
where brand value lives. Supporting multiple frameworks means one Kernel,
primitive set, codemod suite, conformance suite and agent prompt library **per
framework** — an O(frameworks) tax on every platform feature forever.

Coding agents are also the production workforce here; their proficiency is not
framework-neutral. Agent output quality and ecosystem depth (GSAP React
bindings, react-three-fiber, Radix-style headless patterns, Lenis, Framer
Motion) currently favor React decisively.

The marketing site is SvelteKit — unrelated: it is not a storefront and does
not consume the Kernel.

## Decision

Storefronts are React-only. The Kernel pins the React version. No
meta-framework (Next/Remix) — storefronts compile through `@vendua/cli` into
the platform's artifact format, so framework-level server features are out of
scope by design (see [ADR 0003](0003-storefronts-as-artifacts.md)).

## Consequences

### Positive

- One Kernel, one primitive set, one codemod toolchain, one conformance suite.
- Best agent output quality and richest motion/3D ecosystem — the "premium
  software house" material.
- Headless-primitive patterns (`asChild` delegation) are most idiomatic in
  React, which matters for DX of both agents and humans.

### Negative / costs

- A storefront can never "bring its own framework" — acceptable; brand freedom
  is visual, not architectural.
- React churn (compiler, RSC direction) is absorbed once, by the Kernel team,
  not by N storefronts — which is the point.

## Alternatives considered

- **Svelte/SvelteKit**: consistent with the teaser site and pleasant DX, but
  weaker agent fluency (Svelte 5 runes) and thinner premium-motion ecosystem.
- **Framework-agnostic via Web Components**: attractive in theory, but the
  primitives/SDUI/type-safety story collapses into the lowest common
  denominator and codemods lose AST leverage.
- **Multi-framework support**: rejected outright — it multiplies every future
  platform feature's cost by the number of supported frameworks.

## Links

- [architecture/03-storefront-contract](../architecture/03-storefront-contract.md)
