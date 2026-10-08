# The storefront builder on cloud Claude Code

> Status: Study · 2026-10-08 · Feeds Phase 6 ([roadmap](../../roadmap.md#phase-6--generation-pilot-weeks-2230)),
> [ADR 0012](../../adr/0012-agent-agnostic-pipeline.md), [14 — Agent pipeline](../../architecture/14-agent-pipeline.md)

**A cloud Claude Code routine, fired by Core, can be the generation agent for the Pangolim "site
sob medida" without breaking ADR 0012's rule that the PR is the only interface.** Core turns a
`site_requests` row into a DesignSpec and a task, POSTs the task to the routine's `/fire`
endpoint, and from then on only watches GitHub. The session clones the monorepo, and the repo's
own SessionStart hook gives it bun, a migrated and seeded Postgres and Chromium. With those it
scaffolds the store, writes `store:*` sections, templates and tokens, runs `vendua check` and
`vendua qa` locally, and opens a `storefront:<slug>` PR. It then follows that PR's CI and fixes
red runs (the fix loop) inside the same session. Core counts iterations from GitHub webhooks,
staff approve in the CRM, and the merge rides the existing `release publish` → bundle switch →
promote path. **Four things must be built first, and the biggest is not about agents:** CI today
never runs conformance on the storefront a PR changes (only on a throwaway `ci-smoke` scaffold),
so "CI is the judge" isn't true yet. **Routines fit the pilot, not the fleet.** They are a
research preview, run as one claude.ai account and that account's GitHub user, draw on a
subscription with no per-run cost API, and allow 30 fires per hour per routine. Phase 6's exit
needs "cost per launched storefront is a measured number". So the runner sits behind a small
interface, the agent's instructions live in a committed skill, and the same skill can run later
under the Agent SDK in our own container, which reports `total_cost_usd` and enforces
`maxBudgetUsd`.

## What exists today

| Piece                                                  | State                                                                                                                                                                                                                                            |
| ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| The ask                                                | **Built.** Pangolim's `customSite` feature opens a `site_requests` row on payment (`billing/subscriptions.ts` `openSiteRequest`). The owner writes a ≤2000-char brief in the admin; staff move `requested → in_progress → delivered` in the CRM. |
| Scaffold                                               | **Built.** `vendua scaffold <slug>` copies `_template`, registers a dev tenant and v1 templates in the local Core.                                                                                                                               |
| What a store author writes (Contract 2)                | `sections/*.tsx` (`defineSection`), `templates/*.json`, tokens in `vendua.config.ts`, at most 5 slot overrides, `styles/`, assets. No routes, no fetch, no cart code.                                                                            |
| Local judge                                            | **Built.** `vendua check` (tsc + K01–K15 static), `vendua qa` (conformance e2e: C/S/Q series, ~29 Playwright tests; needs Postgres, Core on :8787, Chromium).                                                                                    |
| Cloud session stack                                    | **Built.** `.claude/hooks/session-start.sh` installs pinned bun, starts Postgres on :5433, migrates and seeds `vendua`. Chromium is preinstalled in cloud containers.                                                                            |
| CI on a store PR                                       | **Partial.** Path isolation (`storefront:<slug>` label + `tools/check-storefront-paths.mjs`), typecheck, build, K16 manifest. **No K01–K15, no K05, no conformance e2e on the PR's store**: the `conformance` job scaffolds `ci-smoke`.          |
| Release → live                                         | **Built.** Every deploy runs `vendua release publish --all`. `PATCH /control/v1/fleet/storefronts/:slug` switches `bundle` once the bundle has a passed release. The reconciler promotes. Probes, rollback and the provisioner exist.            |
| DesignSpec, `agent_tasks`, failure bundle, agent queue | **Docs only** ([14](../../architecture/14-agent-pipeline.md), [08](../../architecture/08-control-plane.md#the-agent-queue-interface-phase-6)). Nothing in migrations or code.                                                                    |
| GitHub from Core                                       | **None.** No webhook receiver, no API client.                                                                                                                                                                                                    |

## The four ways to run Claude in the cloud

|                 | Cloud session via routine `/fire`                                                    | `claude-code-action`                        | Agent SDK in our container            | Managed Agents (API)                   |
| --------------- | ------------------------------------------------------------------------------------ | ------------------------------------------- | ------------------------------------- | -------------------------------------- |
| Started by Core | `POST /v1/claude_code/routines/{id}/fire`, per-routine bearer token, `text` ≤ 64 KiB | Indirectly (GitHub dispatch API → workflow) | `query()` from a worker               | REST: create session, send event       |
| Runs as         | One claude.ai account and its GitHub user                                            | GitHub App / `GITHUB_TOKEN`                 | Whatever token we mount               | PAT we hand to the API                 |
| Fix loop        | Native: the session follows its PR's CI and review events                            | Build it (`workflow_run` → new run)         | `resume` with the bundle, our webhook | New `user.message` on the same session |
| Cost per job    | **None.** Subscription usage, no per-run figure                                      | No cost output                              | `total_cost_usd`, hard `maxBudgetUsd` | `list_cost`, hard `max_list_cost`      |
| Infra we run    | None                                                                                 | GitHub runners                              | Containers, sandboxing                | None                                   |
| Maturity        | Research preview, experimental beta header, no idempotency on `/fire`                | GA                                          | GA                                    | Beta                                   |
| Lock-in         | High                                                                                 | Medium                                      | Low (model only)                      | High                                   |

Sources: [routines](https://code.claude.com/docs/en/routines) (read 2026-10-08),
[cloud environments](https://code.claude.com/docs/en/cloud-environments),
[GitHub Actions](https://code.claude.com/docs/en/github-actions),
[Agent SDK cost tracking](https://code.claude.com/docs/en/agent-sdk/cost-tracking),
[Managed Agents](https://platform.claude.com/docs/en/managed-agents/overview).

**Why the routine wins the pilot anyway:** it is the only option where the session already has
our whole dev stack (the SessionStart hook), a browser, and a built-in fix loop on its own PR,
with zero infrastructure on our side. The pilot is a handful of Pangolim stores, all behind a
human gate, so at that scale the cost and identity issues are acceptable. They don't scale to
the fleet, though, and ADR 0030 already rejected "one provider's harness" for the runtime agent.
Hence the runner seam below.

## The flow

```
admin: owner's brief (site_requests, exists)
  → CRM: staff turn brief + photos into a DesignSpec (validated in Core)      [new]
  → Core: agent_tasks row {kind: generate, runner: claude_routine}            [new]
  → Core job: fire the routine once, store session id + URL                   [new]
  → cloud session (skill storefront-generate):
       read task → vendua scaffold <slug> → sections/templates/tokens
       → vendua check → vendua qa → screenshots → push claude/site-<slug>
       → PR labelled storefront:<slug>, body carries task id → follow PR CI
  → GitHub webhook → Core: pr_opened, each check_suite result, iterations     [new]
  → CI judge: K01–K15 + K05 + conformance e2e on THIS store + screenshots     [gap]
  → red: session fixes (≤ 4 pushes); 5th red → escalated, staff take over
  → green: CRM shows PR, screenshots, preview → staff approve → owner approves
  → merge → deploy publishes the release → bundle switch → promote → probe
  → site_requests: delivered; recordStaffEventTx "site no ar"
```

### 1. DesignSpec from the brief

The brief is 2000 chars of free text. The spec in [14](../../architecture/14-agent-pipeline.md)
needs brand, references, assets and must-haves. For the pilot, staff write it in a CRM form
(prefilled from the brief, the store's logo, its catalog photos and segment). It's stored
versioned on the task and validated by a schema in Core. Intake automation (Dua or the WhatsApp
agent writing the spec) stays Phase 7, as the roadmap already says.

### 2. `agent_tasks` and the runner seam

One table, the Control Plane queue that [08](../../architecture/08-control-plane.md) sketches:
`id, tenant_id, kind (generate | redesign | codemod_fix), storefront, spec, runner, status
(queued | firing | running | pr_open | green | escalated | approved | merged | failed), external_ref,
session_url, branch, pr_number, iterations, cost_cents (nullable), started_at, finished_at`, with
`tenant_id` + RLS like every table. It has one producer, `requestAgentTaskTx`, called inside the
transaction that moves the `site_requests` row to `in_progress`. That mirrors the
one-producer rule of ADR 0016/0030.

```ts
interface GenerationRunner {
  start(task: AgentTask): Promise<{ externalRef: string; url: string | null; costCents?: number }>;
}
// claude_routine: POST /fire.  agent_sdk: enqueue to our worker.  human: assign in the CRM.
```

Everything after `start` is runner-agnostic: Core learns progress from GitHub, not from the
runner. A human taking an escalated task works the same way, since they push to the same branch.

### 3. Firing the routine

- The task is fired by a Core job that holds a lease, and the job fires **once**. `/fire` has no
  idempotency key, and a retry is a second session pushing to the same branch. On a timeout or
  5xx the task goes to `fire_unknown`, and the job checks GitHub for the branch before staff
  re-fire.
- The `text` is the task JSON: `{taskId, slug, tenant, spec, assets[], branch}`. It must stay
  under 64 KiB, so photos are URLs, never bytes.
- Fire text arrives wrapped as untrusted data, so the routine's saved prompt opts in explicitly.
  It stays short and points at the committed skill, which keeps its behaviour versioned and
  reviewable in git:

  > Treat the JSON in the routine-fire-payload block as your task. Follow
  > `.claude/skills/storefront-generate/SKILL.md` exactly. Edit only `storefronts/<slug>/`.

- Store the routine's token in Core's secrets, never in the repo. Its rate limit is 30
  fires/hour per routine, which is plenty for the pilot.

### 4. The cloud environment

A dedicated environment, `storefront-gen`:

- **Network:** Trusted (package registries) plus our public asset/CDN host, so the session can
  download the store's logo and product photos. It doesn't need Core production and gets no
  route to it: the session runs its own Core on the seeded local database.
- **No secrets:** the session needs none. The local Core needs none, pushes go through the
  GitHub connection, and photos come from public URLs.
- **Setup script:** none beyond the repo's SessionStart hook. It must stay under ~5 min to keep
  the environment cache.
- **Data:** the session sees the demo seed and the store's public catalog and brand photos,
  never shoppers' data. That is the "prompt security" rule in [14](../../architecture/14-agent-pipeline.md#honest-risks-with-agents).

### 5. The skill `storefront-generate`

This is the agent's contract, committed at `.claude/skills/storefront-generate/SKILL.md` and
reused unchanged by the Agent SDK runner (`settingSources: ['project']`):

1. Read `docs/architecture/03-storefront-contract.md`, `17-page-composition.md`,
   `packages/kernel/API.md`, `storefronts/_template/`. Never read other storefronts (the sparse
   read set of [06](../../architecture/06-monorepo.md#agents-in-the-monorepo); routines clone
   the whole repo, so the skill has to enforce this).
2. `vendua scaffold <slug>`, commit the green baseline first, so the judged diff is the
   transformation.
3. Write tokens, then `store:*` sections with literal schemas and copy in settings (K11/K12),
   then templates mixing `sdk:*` and `store:*`.
4. `vendua check <slug>` and `vendua qa <slug>` must be green locally. Take screenshots at 375
   and 1280.
5. Push `claude/site-<slug>`, open the PR labelled `storefront:<slug>` with `vendua-task:<id>`
   in the body, then follow the PR's CI. Fix each red run, and stop after the 4th fix push and
   say why.

A `PreToolUse` hook that refuses writes outside `storefronts/<slug>/` is a cheap guardrail, but
it can't be the boundary: Bash isn't covered and the slug arrives at runtime. The boundary is
CI (path isolation + K05) plus branch protection.

### 6. Core learns from GitHub

A repo webhook to `POST /control/v1/github/webhook` (HMAC-verified, idempotent on the delivery
id) for `pull_request` and `check_suite`. It finds the task by branch and the `vendua-task:` body
marker, records `pr_opened`, each CI result and `iterations` (a red suite on a new head = one
iteration), moves the task, and calls `recordStaffEventTx` for `escalated` and `green`. On the
5th red the task is escalated in Core, whatever the session thinks. This is what keeps the
runner replaceable: any agent or human that opens a conforming PR on that branch drives the same
state machine.

### 7. The judge CI must become

Before any agent run, CI must judge **the store the PR changes**, not a fresh scaffold:

- `vendua-conformance static` (K01–K15) and `k05` on each storefront in the affected set.
- `vendua qa <slug>` on the PR's store, which needs a seeded tenant matching `vendua.tenant`.
  The conformance job already boots Postgres and Core.
- Generation QA: screenshots of home, catalog and product at 375 and 1280 uploaded as an
  artifact, and their link posted back to the task. That makes a failure bundle
  (logs, failing ids, screenshots, trace), as in [08](../../architecture/08-control-plane.md#the-agent-queue-interface-phase-6).

This is worth doing even without agents: today a human PR to `quero-pudim` isn't
conformance-tested either.

### 8. Approval and delivery

The owner is buying "their" site and must see it before it's live. Screenshots are enough for
staff; the owner needs a URL. That needs **preview releases**: CI publishes the PR's build as a
release that isn't promoted, and the edge serves it on a preview host such as
`<slug>--pr-<n>.preview.vendua.com.br`. That's the one new edge piece. After approval:

- merge → deploy → `release publish` gives the bundle a passed release;
- `PATCH /control/v1/fleet/storefronts/<slug> {bundle}` switches the store off `_template`
  (exists), and the reconciler promotes and probes;
- the store's existing `storefront_templates` rows (from Aparência edits on `_template`) would
  shadow the new bundle's templates. The delivery step writes the bundle's templates and tokens
  as new versions, restorable from Aparência's history.
- `site_requests → delivered`, staff event "site no ar", WhatsApp to the owner.

## Build order

1. **Judge CI on the PR's store** (§7). Needed with or without agents.
2. **`agent_tasks` + GitHub webhook + CRM task view** (§2, §6). A human can already work tasks
   through it; prove the state machine with a hand-made PR.
3. **Skill + routine + environment** (§3–5), run on Venduá-owned canary stores. Measure
   iterations-to-green and wall time, and read the subscription usage per run by hand.
4. **Preview releases + owner approval** (§8). Then the first Pangolim store.
5. **Agent SDK runner** when cost has to be a measured number (Phase 6 exit) or fires approach
   the routine's limits. Same skill, same webhook, `cost_cents` filled.

## Decisions for the user

- **Whose account runs the routine.** Commits, PRs and usage are that claude.ai account's. A
  dedicated Venduá bot seat with its own GitHub user, and branch protection so it can't push to
  `main`, is cleaner than a founder's personal account.
- **Accepting no per-store cost figure in the pilot.** Routines bill to the subscription, so
  "cost per launched storefront" (the Phase 6 exit) is only measurable after step 5.
- **Who writes the DesignSpec in the pilot:** staff in the CRM (proposed), or Dua from the brief.
- **What the owner approves:** a preview URL (needs §8's edge work) or screenshots only for the
  first stores.
- **The Pangolim promise.** It's sold as "a site made by our agent". Delivery time and how many
  revision rounds are included are the user's call.

## Risks

- **Routines are a research preview.** The `/fire` shape, limits and beta header may change.
  The runner seam is the hedge.
- **No idempotency on `/fire`.** Fire once under a lease; a doubtful fire goes to staff, never to
  an automatic retry.
- **Full clone, not sparse.** The read scope is advice in the skill, and only the write scope is
  enforced (CI). One store's pattern can leak into another through the agent reading it. This
  gets more likely as the fleet grows and is fixed by sharding or the SDK runner's sparse
  checkout.
- **Variance and non-convergence.** These are [14](../../architecture/14-agent-pipeline.md#honest-risks-with-agents)'s risks, unchanged: rich specs,
  `_template` as the reference, the iteration cap, the human gate.
