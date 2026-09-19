---
name: run-roadmap
description: Advance the vendua roadmap by delegating items to executor sessions. Use when asked to "run the roadmap", "advance the roadmap", or execute a phase — this skill is the master procedure, not a script.
---

# run-roadmap — master procedure

You are the master: a normal Devin session coordinating executor sessions.
You decide what to delegate and when — there is no script and no required
shape. An executor is a child session governed by
`.devin/agents/roadmap-executor.md`: it owns ONE roadmap item end-to-end
(implement → PR annotating its roadmap line → CI + Devin Review
loop → merge per policy → structured report).

## Procedure

1. Read `docs/roadmap.md`. The active phase is the first `## Phase` still
   containing `- [ ]` items. An unchecked item already tagged `(PR #N)` is
   in flight, not new work — `gh pr view N --json state`: OPEN means
   awaiting merge (skip it, list it in the plan), CLOSED-unmerged means
   free to re-delegate, MERGED means its check-off is missing (fix the box
   in a housekeeping edit). Show the user the phase, the delegatable
   items, and your plan before spawning anything.
2. Plan with judgment. Heavily favor one executor per item whenever items
   are independent — parallel executors are the default _when they help_.
   Do an item yourself or run sequentially when items depend on each other,
   are tiny, or are explicitly human-steered.
3. For each delegated item, `devin_session_create` one session with
   `repos=["mariajunqueiramirandas-cpu/vendua"]`,
   `notify_on_response=true`, the structured-output schema below, and a
   prompt telling it to read `AGENTS.md`, `.devin/agents/roadmap-executor.md`,
   and `docs/roadmap.md`; the assignment is the item verbatim plus the
   merge policy.
4. As children settle, pull structured output and messages via
   `devin_session_interact`. Relay their questions to the user — never
   answer design decisions for them.
5. When the batch settles, send the user ONE report: per-item
   status/PR/summary plus the consolidated `manual_steps` and `postponed`
   lists — together they are the user's work queue. `blocked` items stay
   unchecked and untagged — the next run picks them up. `open` items keep
   their `(PR #N)` in-flight tag — the next run skips them while the PR
   awaits merge.

## Merge policy

Confirm with the user each run. `report` (default): executors stop at
ready-for-merge and a human clicks merge. `auto`: executors merge
directly (`gh pr merge --squash`) once their own merge gate passes — the
executor's judgment is the approver (checks green + every review thread
resolved or answered + ~15 min quiet window), never the Devin Review
check status alone.

## Structured-output schema for executor sessions

```json
{
  "type": "object",
  "properties": {
    "item": { "type": "string" },
    "status": { "type": "string", "enum": ["merged", "auto-merge-armed", "open", "blocked"] },
    "pr_url": { "type": "string" },
    "summary": { "type": "string" },
    "manual_steps": { "type": "array", "items": { "type": "string" } },
    "postponed": { "type": "array", "items": { "type": "string" } },
    "notes": { "type": "string" }
  },
  "required": ["status", "pr_url", "summary"]
}
```

## Notes

- Roadmap status is atomic: the executor's own PR contains the `- [x]`
  flip, so merge and status update are one event — no watcher needed.
- When several executors do run in parallel, each touches only its own
  roadmap line(s); a merge conflict there means rebase and keep both edits.
- `auto` needs no repo settings: with no ruleset on main the executor's
  own gate is the only gate and its merge lands immediately — that is why
  the gate (self-verified checks + resolved review + quiet window) must
  not be weakened. If a ruleset is ever added, require checks only —
  required approvals deadlock executor merges (it can't self-approve).
- Items marked human-steered (e.g. "semi-manually") come back as
  `manual_steps`, not silent skips.
- Cost: each executor is a full session plus its subagents — parallel
  batches spend ACUs in parallel too.
