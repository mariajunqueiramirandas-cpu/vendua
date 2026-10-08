# ADR 0039: Pangolim's site is built by a cloud Claude Code routine, judged by CI

- Status: Accepted (built 2026-10-08: migration 0103, `modules/site-builder`, the
  `storefront-generate` skill). Live once the [setup](../deploy/site-builder.md) is done.
- Date: 2026-10-08
- Implements: [ADR 0012](0012-agent-agnostic-pipeline.md) for the Pangolim "site sob medida"
  ([ADR 0032](0032-three-plans-for-launch.md))
- Study: [running the builder on cloud Claude Code](../research/storefront-builder-claude-code-2026-10/README.md)

## Context

Pangolim promises "a site made by our agent". A paid Pangolim opens a `site_requests` row, and
until now staff moved it by hand. [14](../architecture/14-agent-pipeline.md) describes the
pipeline (DesignSpec → scaffold → PR → CI judge → fix loop → approval → provision), but none of
its pieces existed, and CI never ran conformance on the storefront a PR changed.

## Decision

The owner's decisions (2026-10-08):

1. **Duá writes the DesignSpec** from the owner's brief, in the admin copilot.
2. **The owner approves only the brief**, by applying Duá's card (`site.build`). They never
   approve the finished site. Staff are the one human gate, on the green PR.
3. **Delivery in 1 day**, 24 hours from the card to the site live, weekends included.
4. **One revision included** (`site.revise`, also a Duá card), enforced by Core.
5. **The agent is a cloud Claude Code routine on the owner's own claude.ai account**, fired by
   Core over HTTP. No per-run cost figure in the pilot.

How it's built:

- **One producer.** `requestSiteTaskTx` is the only insert into `site_tasks`. It runs inside the
  transaction where the owner's card is applied (the owner-only named routes
  `/account/site-request/build` and `/revision`, which only write rows, so the copilot's dry run
  stays pure).
- **Fire once.** A fleet-loop pass commits `firing` and then POSTs the task to the routine's
  `/fire` endpoint. `/fire` has no idempotency key, so an uncertain fire escalates to staff and is
  never retried automatically.
- **The PR is the interface.** The routine follows the committed skill
  `.claude/skills/storefront-generate/SKILL.md`: scaffold, tokens in `tokens.json`, `store:*`
  sections and templates, `vendua check` and `vendua qa` locally, then a PR labelled
  `storefront:<slug>` on a branch carrying the task id, and at most four fix pushes. A human who
  takes a task over pushes to the same branch, and Core can't tell the difference.
- **Core learns from GitHub, not from the runner.** An HMAC-verified webhook (deduped per
  delivery, same-repo only) moves tasks on PR and CI events. A head is green only if nothing
  failed on it before, and the merge asks GitHub's check runs first. Five red runs escalate.
- **CI is the judge.** The conformance job runs `vendua check` and `vendua qa` on every storefront
  a diff touches, K05 on a store's own PR, and uploads the QA screenshots that staff review.
- **Delivery reuses the fleet.** Staff approval makes Core merge. The deploy publishes the
  store's bundle, which the store adopts. Core then writes the merged templates and tokens into the
  store's saved design (so earlier Aparência edits don't shadow them) and delivers when the
  deployment is live. `site.due_soon` and `site.overdue` keep the 24 hours visible to staff.

## Consequences

- The owner's experience is one conversation and one tap. The site and its single revision follow
  without them.
- The routine runs as one person's claude.ai account and GitHub user, bills to a subscription
  and is a research preview. The `SiteRunner` seam (`claude_routine`, `human`) is the hedge: an
  Agent SDK runner in our own container can replace it with the same skill, webhook and states,
  and fills cost per store (Phase 6's exit).
- Routines clone the whole repo, so the read scope (only `_template` as reference) is advice in the
  skill. The write scope is enforced by CI and branch protection.
- The 24-hour promise needs staff every day, and auto-deploy on `main`.
- CI now runs conformance on every touched store. That found and fixed a real 200%-zoom overflow
  in Quero Pudim. A Kernel change still qa-s every store in sequence, which needs a matrix as the
  fleet grows.

## Alternatives considered

- **claude-code-action in GitHub Actions:** no built-in fix loop and no cost output, and the
  session would lack the local stack the repo's SessionStart hook gives a cloud session.
- **Agent SDK in our own container now:** cost per run and sparse checkouts, but containers to
  run. Deferred behind the runner seam.
- **Managed Agents:** beta, and a broad GitHub token handed to the API.
- **The owner approves the finished site:** one more wait inside a 24-hour promise, decided
  against by the owner.
