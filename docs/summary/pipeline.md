# Pipeline — DesignSpec → Agent → Live Storefront; Roadmap

Condenses `architecture/14` + `roadmap.md`. Full docs are normative.

## Agent pipeline (`14`)

Agents are interchangeable labor behind a PR interface — the platform owns the
contract, the scaffold, and the judge (CI). Any agent (Devin, Claude Code,
human) that opens a conforming PR satisfies it.

```
conversation → DesignSpec (validated JSON) → agent_tasks queue
  → agent: vendua scaffold <slug> → implement → PR
  → CI: conformance + generation QA → fix loop (≤4) → approval gate
  → Provisioner: hostname, promote, analytics, merchant invite
```

- **DesignSpec**: versioned JSON — tenant, brand (personality, palette,
  typography, references, assets), experience (pages, differentials, motion,
  avoid), commerce (ordering, payment methods), copy, constraints. Intake
  agent produces it; generation agent satisfies it — separate cadences.
- **Scaffold-first (anti-hallucination rule)**: agents never start blank —
  `vendua scaffold` yields a storefront that already passes conformance;
  generation is _transformation_, and only the diff is judged.
- **Task contract**: sparse checkout (Kernel + docs + `_template` +
  `_examples` + the slug); reads never include the rest of the fleet; writes
  only `storefronts/<slug>/**`; done-when = conformance green + generation QA.
- **Fix loop**: each CI failure → failure bundle (logs, test IDs, screenshots,
  trace) → agent resumes with it. Cap 4 iterations → human with full history.
  Iterations-to-green is a first-class metric — it prices the product.
- **Gates**: human + merchant approval at launch; human for post-launch
  changes while judge agreement unproven; codemod-failure fixes auto-merge
  once green; train promotions are health-gated, not approved.
- **Cost accounting** per task: `cost_usd`, wall time, iterations, outcome.
  Track agent-minutes per launched storefront (the business-model number),
  failure-tail per codemod (the Contract-quality number), post-launch defect
  rate per agent (the judge-honesty number).
- **Honest risks**: run-to-run variance; contract drift (agents trained on old
  scaffolds — keep scaffold + agent docs generated from one source);
  non-converging specs route to humans, not retries; agent tasks carry no
  secrets and only seeded data.
- **Provisioner handoff**: on approval — tenant row, DNS `slug.vendua.com.br`,
  promote release, analytics, merchant invite + onboarding checklist. "Live" =
  synthetic probe sees catalog 200 + correct `vendua-state` on the hostname.

## Roadmap

See [`../roadmap.md`](../roadmap.md) — rewritten fleet-first (2026-09-18):
phases follow the fleet lifecycle (produce → sell → deploy → operate →
migrate → generate → scale), Control Plane lands in Phase 4 (before the first
real tenant), and growth is gated by fleet stages (1 / 5 / 25 / 100 / 1000
stores), not just phase exits.
