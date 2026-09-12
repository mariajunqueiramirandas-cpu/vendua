# ADR 0012: Agent-agnostic generation pipeline — CI is the judge

- Status: Proposed
- Date: 2026-09-11

## Context

Storefronts are produced by coding agents (Devin, Claude Code, others) and
occasionally humans. Locking the platform to one agent vendor — or baking
agent semantics into the Contract — makes the entire fleet hostage to one
model's quality curve and pricing.

## Decision

The agent interface is **a PR against the monorepo touching only
`storefronts/<slug>/`**. The judge is CI: the Conformance Suite + generation
QA (screenshots, visual triage). Agents always start from `vendua scaffold` —
a baseline that is already green — so generation is *transformation*, and any
API hallucination shows up as a diff against a known-good state. Failures
return as failure bundles (logs, test IDs, screenshots, traces) with a bounded
iteration cap; the cap escalates to humans.

Approval policy: human + merchant approval at launch; graduated automation only
when judge-vs-human agreement is measured.

## Consequences

### Positive

- Agents are hot-swappable on evidence: iterations-to-green, cost per launch,
  post-launch defect rate are tracked per agent.
- "Scaffold-first" is the single strongest anti-hallucination measure — the
  green baseline makes wrongness visible.
- Human storefront work uses the exact same path — no second-class citizens.

### Negative / costs

- Agent variance is real: the same spec yields uneven quality — mitigated by
  rich DesignSpecs, golden reference storefronts, and the human launch gate.
- The pipeline needs the Contract + conformance to be *good* before agents
  arrive; a weak suite makes agents a chaos multiplier. Sequencing in
  [roadmap](../roadmap.md) puts agents at Phase 5 for this reason.

## Alternatives considered

- **Deep integration with one agent vendor's API**: faster to start, strategic
  dead-end — the vendor becomes a platform dependency.
- **Agents own more of the stack** (e.g. generate backend config): contradicts
  the core rule — agents do visuals and UX, never business logic.

## Links

- [architecture/14-agent-pipeline](../architecture/14-agent-pipeline.md)
