# 14 — Agent Pipeline

> Status: Proposed · Last reviewed: 2026-09-11
> Decision: [ADR 0012](../adr/0012-agent-agnostic-pipeline.md)

The pipeline that turns a customer conversation into a deployed storefront.
Design rule: **agents are interchangeable labor behind a PR interface** — the
platform owns the contract, the scaffold, and the judge (CI); any agent —
Devin, Claude Code, a human — that can open a conforming PR satisfies it.

## Flow

```
conversation (WhatsApp agent or human briefing)
  → DesignSpec (validated JSON)
  → generation task enqueued (Control Plane agent_tasks)
  → agent: `vendua scaffold <slug>` → implement routes/tokens/overrides → PR
  → CI: conformance + generation QA (screenshots, visual triage)
  → fix loop (≤ N iterations, failure bundles back to the agent)
  → approval gate (human at launch; auto later when judge data justifies)
  → Provisioner: hostname, release promotion, analytics, merchant invite
```

## DesignSpec — schema sketch (normative enough to validate)

```ts
interface DesignSpec {
  version: 1;
  tenant: {
    name: string;
    segment: 'bakery' | 'dessert' | 'restaurant' | 'delivery' | string;
    city?: string;
  };
  brand: {
    personality: string[]; // "afetiva", "premium", "divertida"
    palette: { primary?: string; refs: string[] }; // hex or "from instagram"
    typography: { vibe: string; refs?: string[] };
    references: { url: string; note: string }[]; // sites they admire
    assets: { logo?: string; photos: string[] }; // bucket keys
  };
  experience: {
    mustHavePages: string[]; // default: menu, product, cart
    differentials: string[]; // "3D cake preview", "story-driven"
    motion: 'none' | 'subtle' | 'expressive';
    avoid: string[]; // "no dark mode", "no gradients"
  };
  commerce: { ordering: 'delivery' | 'pickup' | 'both'; paymentMethods: string[] };
  copy: { tone: string; language: 'pt-BR' };
  constraints: { budgets?: 'default'; deadline?: string };
}
```

The spec is validated and **versioned**; the intake agent's job is producing a
valid spec — the generation agent's job is satisfying it. Separating them means
the intake agent (conversational, fuzzy) can ship on a different cadence and
model than the generation agent (code-precise).

## Scaffold-first generation — the anti-hallucination rule

Agents never start from a blank repo. `vendua scaffold` produces a storefront
that **already passes conformance**: required mounts, a working catalog page,
system routes wired, tokens populated. The agent's job is _transformation_, not
construction — hallucinated API usage is caught instantly because the baseline
was green and only its diff is judged.

Agent task contract:

```
checkout: sparse clone — `packages/kernel`, `packages/conformance`, `docs`,
          `storefronts/_template`, `storefronts/_examples`,
          `storefronts/<slug>` (see [06](06-monorepo.md#agents-in-the-monorepo))
inputs:   storefronts/<slug>/ (scaffolded), DesignSpec, docs/contract summary,
          Kernel docs index
reads:    Kernel source, _template, _examples — never the rest of the fleet
allowed:  edits under storefronts/<slug>/** only (CI changed-path check)
forbidden: packages/**, other storefronts, contract-required files' semantics
done-when: conformance green + generation QA produced
```

## The fix loop

Each CI failure packages a **failure bundle** ([08](08-control-plane.md#the-agent-queue-interface)):
logs, failing test IDs, screenshots, trace. The agent resumes with the bundle
as its prompt. Defaults: max 4 iterations, then escalate to a human with full
history. Iterations-to-green is a first-class metric — it prices the product.

## Approval gates

| Stage                                            | Gate                                                                               |
| ------------------------------------------------ | ---------------------------------------------------------------------------------- |
| Initial launch                                   | Human approval + merchant approval (they're buying "their" site — show it to them) |
| Post-launch agent change (redesign, new surface) | Human approval while judge agreement unproven                                      |
| Codemod-failure fixes                            | Auto-merge allowed once conformance green (mechanical scope)                       |
| Kernel train promotion                           | Gates are health metrics, not approvals ([09](09-migrations-and-fleet-trains.md))  |

## Cost accounting

Per `agent_tasks` row: `cost_usd`, wall time, iterations, outcome. Track:

- **agent-minutes per launched storefront** — the marginal-cost number that
  decides whether the business model works.
- **failure-tail rate per codemod/major** — the number that decides whether the
  Contract is well-designed.
- **post-launch defect rate per agent** — judge quality honestly; swap agents
  on evidence.

## Honest risks with agents

- **Variance**: two runs of the same spec produce different quality. Mitigate:
  DesignSpec richness, golden example storefronts as reference, human gate at
  launch.
- **Contract drift over time**: agents trained on old scaffolds produce old
  patterns — keep the scaffold and agent docs generated from the same source.
- **Non-convergence**: some specs never reach green in 4 iterations — that's a
  routing decision (human takes it), not a retry decision.
- **Prompt security**: agent tasks carry no secrets; tenant data they see is
  the seeded catalog, not production customer data.

## The provisioner handoff

On approval, `agent_tasks` → `provision`: create tenant row (if new), DNS
`slug.vendua.com.br`, promote release, enable analytics, generate merchant
invite + admin onboarding checklist (connect MP, load catalog, set hours). A
storefront is "live" when a synthetic probe confirms the catalog page serves
200 with correct `vendua-state` on its hostname.
