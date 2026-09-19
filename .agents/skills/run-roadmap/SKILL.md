---
name: run-roadmap
description: Advance the vendua roadmap by delegating a phase to ONE executor session that parallelizes with same-VM subagents. Use when asked to "run the roadmap", "advance the roadmap", or execute a phase — this skill is the master procedure, not a script.
---

# run-roadmap — master procedure

You are the master: a normal Devin session that coordinates — it does not
implement. Orchestration uses exactly ONE child session at a time,
governed by `.devin/agents/roadmap-executor.md`: the executor owns every
open item in the active phase, parallelizes across its own same-VM
subagents — never child sessions — and lands each item as an annotated
PR.

## Procedure

1. Read `docs/roadmap.md` AND enumerate open PRs
   (`gh pr list --state open`) — executor PR bodies quote their item's
   first line verbatim, so map each open executor PR to its item: those
   items are in-flight (report them as awaiting merge). An unchecked item
   on main already tagged `(PR #N)` is a stale marker —
   `gh pr view N --json state`: CLOSED-unmerged = free to re-delegate,
   MERGED = check-off missing (fix the box in a housekeeping edit). The
   active phase is the first `## Phase` with open `- [ ]` items. Show the
   user the phase, the items, and your plan before spawning anything.
2. Merge policy — confirm with the user each run. `report` (default):
   the executor stops at ready-for-merge and a human clicks merge.
   `auto`: merges each item directly (`gh pr merge --squash`) once its
   gate passes — the executor's judgment is the approver (checks green +
   every review thread resolved or answered + ~15 min quiet window),
   never the Devin Review check status alone.
3. Spawn exactly ONE executor via `devin_session_create` with
   `repos=["mariajunqueiramirandas-cpu/vendua"]`,
   `notify_on_response=true`, the structured-output schema below, and a
   prompt telling it to read `AGENTS.md`,
   `.devin/agents/roadmap-executor.md`, and `docs/roadmap.md`; the
   assignment is the phase's open items verbatim plus the merge policy.
   Never spawn parallel executors — every separate-VM session counts
   against the org's concurrency cap, while the executor's same-VM
   subagents are cap-free. A multi-phase request is still one executor
   per run; run phases sequentially.
4. When it settles, pull structured output and messages via
   `devin_session_interact`. Relay its questions to the user — never
   answer design decisions for it.
5. Send the user ONE report: per-item status/PR/summary plus the
   consolidated `manual_steps` and `postponed` lists — together they are
   the user's work queue. `blocked` items stay unchecked — the next run
   picks them up. `open` items are skipped while their PR is live
   (detected via the open-PR list in step 1).

## Structured-output schema for the executor session

```json
{
  "type": "object",
  "properties": {
    "items": {
      "type": "array",
      "items": {
        "type": "object",
        "properties": {
          "item": { "type": "string" },
          "status": { "type": "string", "enum": ["merged", "auto-merge-armed", "open", "blocked"] },
          "pr_url": { "type": "string" },
          "summary": { "type": "string" }
        },
        "required": ["status", "pr_url", "summary"]
      }
    },
    "manual_steps": { "type": "array", "items": { "type": "string" } },
    "postponed": { "type": "array", "items": { "type": "string" } },
    "notes": { "type": "string" }
  },
  "required": ["items"]
}
```

## Notes

- Roadmap status is atomic per item: the PR that lands an item contains
  the `- [x]` flip, so merge and status update are one event — no watcher
  needed.
- The executor's subagents each work in a separate `git worktree` of the
  repo, and the executor serializes the PR/merge lane, so
  `docs/roadmap.md` and `bun.lock` conflicts stay clerical.
- `auto` needs no repo settings: with no ruleset on main the executor's
  own gate is the only gate. If a ruleset is ever added, require checks
  only — required approvals deadlock executor merges (it can't
  self-approve).
- Items marked human-steered come back as `manual_steps`, not silent
  skips.
- Cost: one executor session plus its subagents — the subagents bill to
  the executor's session, not to separate sessions.
