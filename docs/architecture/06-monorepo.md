# 06 — Monorepo

> Status: Proposed · Last reviewed: 2026-09-11
> Decision: [ADR 0001](../adr/0001-monorepo-for-storefronts.md)

All platform code and all storefronts live in **one monorepo**. This is the
single highest-leverage structural decision in the fleet story: a codemod across
1000 storefronts is one PR, not 1000.

## Layout

```
vendua/
  packages/
    core/                 # backend modular monolith
    kernel/               # @vendua/kernel runtime
    ui-defaults/          # @vendua/ui-defaults
    cli/                  # @vendua/cli (scaffold, dev, check, build, qa)
    conformance/          # @vendua/conformance suite + lint rules
    codemods/             # @vendua/codemods
    loader/               # v.js source
    control-plane/        # fleet state, reconciler, fleet ops API
    admin/                # merchant admin app (also a Kernel consumer? no —
                          # admin is its own app, shares only the API client)
    edge/                 # host→tenant resolution, artifact serving, injection
  storefronts/
    _template/            # `vendua scaffold` source — always green
    quero-pudim/
    <slug>…
  tools/                  # repo-level CI utilities, affected-graph scripts
  docs/
```

## Isolation rules (enforced, not conventional)

- **Changed-path CI check**: a PR labelled `storefront:<slug>` (which is what
  the agent pipeline and the scaffold produce) MUST only touch
  `storefronts/<slug>/**`. This is the hard sandbox boundary for agents and
  contributors — a storefront PR that modifies Kernel or another store cannot
  merge.
- **CODEOWNERS**: `packages/**` → platform team; `storefronts/**` → fleet
  automation + on-call owner; `storefronts/_template` → platform team.
- Package `exports` maps hide Kernel internals; `vendua check` lints
  cross-boundary imports (no `storefronts/A` importing `storefronts/B`, no
  storefront importing `packages/*` internals).
- Storefronts consume Kernel via workspace deps — **no publishing, no registry**;
  the lockfile pins one Kernel version per build.

## Builds: affected-graph only

Turborepo/Nx-style task graph keyed on inputs:

- Kernel change → all storefronts affected → rebuild all artifacts (a fleet
  train; see [09](09-migrations-and-fleet-trains.md)).
- Storefront change → that storefront only.
- Core change → conformance suite against each supported Kernel line (see
  [11](11-backward-compatibility.md)); no storefront rebuilds.
- Remote build cache so identical storefront builds are cache hits, not work.

Expected cost: a fleet train at N=1000 is ~1000 incremental builds ≈ 5000 CI
minutes. On self-hosted runners this is a scheduling problem, not a budget
problem; on hosted CI it's tens of dollars per train. Fine at biweekly cadence.

## Assets

Binary assets do **not** live in git at scale (1000 stores × images/videos =
repo death). `storefronts/<slug>/assets/manifest.json` references content-hash
keys in the assets bucket; `vendua build` uploads new assets and rewrites
references to CDN URLs. Git keeps the manifest, not the media.

## Agents in the monorepo

The monorepo is *better* for coding agents, not worse: the agent working on
`storefronts/<slug>` can read Kernel source, the template, and sibling
storefronts as reference examples — while the changed-path check guarantees it
can't stray. The task contract for agents is in
[14](14-agent-pipeline.md#the-pr-interface).

## Scaling limits and the sharding trigger

One monorepo holds comfortably to ~1000 storefronts if assets stay out of git.
Watch: `git status`/`clone` time, CI job enumeration, GitHub UI limits.

Sharding trigger (any of): clone time > 10 min shallow; `git status` > 30 s on
CI images; GitHub PR/commit-page degradation. Shard by **alphabetical ranges
into 2–4 `fleet-*` repos** that consume published Kernel versions (at that
point Kernel packages get published to a private registry — the only change;
Contract and CI stay identical). The Control Plane is shard-agnostic: it tracks
`storefront → repo/path` already.

## What this replaces

The rejected alternative — repo-per-storefront — is analyzed in
[ADR 0001](../adr/0001-monorepo-for-storefronts.md). Short version: 1000 repos
means 1000 CI configs, 1000 dependency bots, and codemods executed via a
batch-changes tool against a GitHub API — strictly worse on every operational
axis, with no compensating benefit, since customers never see their repo.
