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

**Decided 2026-10-08:**

- Duá writes the DesignSpec from the brief.
- The owner approves only the brief, as Duá's copilot card. Staff are the one gate on the site.
- The site is delivered in 1 day.
- One revision is included.
- The 1 day counts weekends.
- The routine runs on the owner's own claude.ai account.
- The pilot runs without a cost figure per run.

§1 and §8 cover what these decisions change.

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
  → Duá drafts a DesignSpec from it, shown as a copilot card                  [new]
  → owner applies the card (decideTx): spec saved, request in_progress,
    agent_tasks row {kind: generate, runner: claude_routine}, 24 h clock starts [new]
  → Core job: fire the routine once, store session id + URL                   [new]
  → cloud session (skill storefront-generate):
       read task → vendua scaffold <slug> → sections/templates/tokens
       → vendua check → vendua qa → screenshots → push claude/site-<slug>
       → PR labelled storefront:<slug>, body carries task id → follow PR CI
  → GitHub webhook → Core: pr_opened, each check_suite result, iterations     [new]
  → CI judge: K01–K15 + K05 + conformance e2e on THIS store + screenshots     [gap]
  → red: session fixes (≤ 4 pushes); 5th red → escalated, staff take over
  → green: CRM shows PR + screenshots → staff approve (the one human gate)
  → merge → deploy publishes the release → bundle switch → promote → probe
  → site_requests: delivered; recordStaffEventTx "site no ar"
```

### 1. DesignSpec from the brief: Duá writes it, the owner approves it

The brief is 2000 chars of free text. The spec in [14](../../architecture/14-agent-pipeline.md)
needs brand, references, assets and must-haves. **Duá writes it** (decided 2026-10-08). Every
Pangolim store already has Duá Copilot ([ADR 0034](../../adr/0034-dua-copilot.md)), and its rule
fits as is: Duá proposes, a person applies. Duá reads the brief, the store's segment, logo and
catalog photos, and asks the owner what's missing (references, things to avoid). It then
proposes the spec as a copilot card that says, in pt-BR, what the site will be. **This card is
the owner's only approval** (decided 2026-10-08). The owner approves the brief, not the finished
site.

Applying the card goes through the copilot's `decideTx`, and that one transaction:

- validates the spec against the schema in Core;
- saves it versioned on the request;
- moves `site_requests` to `in_progress`;
- calls `requestAgentTaskTx`, which starts the 24-hour clock (§8).

A refusal is recorded on the card like any other.

This pulls "intake agent → DesignSpec" forward from Phase 7. That is only safe because the
owner's tap is the gate and the spec is validated, so a bad spec costs one run, not a live
site. The roadmap line should move.

### 2. `agent_tasks` and the runner seam

One table, the Control Plane queue that [08](../../architecture/08-control-plane.md) sketches:
`id, tenant_id, kind (generate | revision | codemod_fix), storefront, spec, runner, status
(queued | firing | running | pr_open | green | escalated | approved | merged | failed), external_ref,
session_url, branch, pr_number, iterations, cost_cents (nullable), started_at, finished_at`, with
`tenant_id` + RLS like every table. It has one producer, `requestAgentTaskTx`, called inside the
transaction where the owner applies Duá's card (§1). That mirrors the
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

### 8. Approval, the 24-hour promise and the revision

**The owner doesn't approve the site** (decided 2026-10-08). They approved the brief (§1), and
the site goes live when it's ready. The one human gate is staff, in the CRM, on the green PR's
screenshots at 375 and 1280. That is the human gate ADR 0012 requires at launch, and the "at
most one human approval gate" in Phase 6's exit. Preview releases aren't needed for launch.

**Delivery is 1 day** (decided 2026-10-08): 24 hours from the owner applying the card to the
store serving its new bundle. Core keeps the deadline on the task (`due_at`). The timings below
are targets to measure in build step 3:

| Step                                     | Budget        |
| ---------------------------------------- | ------------- |
| Fire → green PR (≤ 4 fix rounds)         | ~3 h          |
| Staff review                             | ≤ 8 h         |
| Merge → deploy → release → promote       | ~1 h          |
| Slack for an escalation a human finishes | the remainder |

- The reconciler raises `site_due_soon` 8 hours before `due_at` on any task not yet approved, as
  a `recordStaffEventTx`. Escalations raise one at once.
- The 1 day counts weekends (decided 2026-10-08), so escalations and approvals need someone on
  staff every day. The due-soon and escalation events are what page them.

**One revision is included** (decided 2026-10-08). After delivery the owner can ask Duá for
changes once:

1. Duá turns the request into a spec diff, shown as a card.
2. Applying the card opens a `revision` task on the store's own bundle. It takes the same path
   and has the same 24-hour clock (an assumption to confirm).
3. `site_requests.revisions_used` counts it.

A second request is refused by Core, not by Duá's wording. After the included revision, the
store's own settings still work: Aparência for copy, images and section order, and tokens for
colours and fonts.

After staff approval:

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
4. **Duá's DesignSpec card + the 24-hour clock + the revision** (§1, §8). Then the first
   Pangolim store.
5. **Agent SDK runner** when cost has to be a measured number (Phase 6 exit) or fires approach
   the routine's limits. Same skill, same webhook, `cost_cents` filled.

## Decisions

Taken by the owner on 2026-10-08:

- **Spec:** Duá writes the DesignSpec from the brief (§1).
- **Approval:** the owner approves only the brief, as Duá's card, never the site. Staff are the
  one human gate (§8).
- **Delivery:** 1 day, weekends included (§8).
- **Revisions:** one is included (§8).
- **Account:** the routine runs on the owner's own claude.ai account. Commits, PRs and usage
  carry that account's name and GitHub user. Branch protection on `main` (a PR and green CI
  required, enforced for admins too) keeps the routine's pushes on `claude/` branches, since
  GitHub applies the rules to the connected account.
- **Cost:** the pilot runs without a cost figure per run, so routine usage shows only on the
  subscription. "Cost per launched storefront", Phase 6's exit, becomes measurable with the
  Agent SDK runner (build step 5).

## Risks

- **Routines are a research preview.** The `/fire` shape, limits and beta header may change.
  The runner seam is the hedge.
- **No idempotency on `/fire`.** Fire once under a lease; a doubtful fire goes to staff, never to
  an automatic retry.
- **Full clone, not sparse.** The read scope is advice in the skill, and only the write scope is
  enforced (CI). One store's pattern can leak into another through the agent reading it. This
  gets more likely as the fleet grows and is fixed by sharding or the SDK runner's sparse
  checkout.
- **The 24-hour promise vs non-convergence.** A spec that never goes green turns into human work
  against a clock. Iterations-to-green from build step 3 says whether 24 hours holds before any
  store is sold on it.
- **Variance and non-convergence.** These are [14](../../architecture/14-agent-pipeline.md#honest-risks-with-agents)'s risks, unchanged: rich specs,
  `_template` as the reference, the iteration cap, the human gate.
