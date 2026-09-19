---
name: run-roadmap
description: Advance the vendua roadmap — the session executes the phase itself, fanning items out to whatever subagents the session supports (in-session first, up to 4 child sessions otherwise), landing ONE PR per phase. Use when asked to "run the roadmap", "advance the roadmap", or execute a phase.
---

# run-roadmap — master procedure

You are the master: a normal Devin session that runs the phase itself.
How work is delegated depends on what the session supports:

- **In-session subagents** (shared-VM workflow agents, sidekick,
  `run_subagent`) when available — preferred.
- **Separate-VM child sessions** (workflow `vm_mode="separate"` or
  `devin_session_create`) when they're not — up to **4 child sessions
  per run, spawned only by you** — a child session never spawns
  descendants. The cap is a hard rule; excess items wait for a slot,
  they don't spawn.

Either way the phase produces **ONE PR** — not one PR per item. The PR
is the unit of review and merge; the roadmap items are its contents.

## Procedure

1. Read `docs/roadmap.md` AND enumerate open PRs
   (`gh pr list --state open`). The active phase is the first `## Phase`
   with open `- [ ]` items. Map open PRs to items so in-flight work is
   reported, not redone. Show the user the phase, the items, and your
   plan before spawning anything.
2. Merge policy — confirm with the user each run. `report` (default):
   the PR stops at ready-for-merge and a human clicks merge. `auto`:
   squash-merge once the gate passes — checks green + every review
   thread resolved or answered + no important comments outstanding. The
   executor's judgment is the approver, never the Devin Review check
   status alone.
3. Fan the phase's open items out to subagents per the availability
   rule above — one agent per coherent slice, each in its own
   `git worktree` (same-VM) or its own clone (separate-VM). Keep
   interpretation and taste at this level: give each agent complete,
   self-contained instructions and an acceptance check. A subagent's
   "done" is a claim — verify it.
4. Assemble the phase PR yourself: collect the agents' branches (rebase
   them onto latest main, resolving clerical conflicts like `bun.lock`
   and `docs/roadmap.md`), or apply their diffs onto one branch. The PR
   body names the phase, lists each shipped item's first line verbatim,
   and states the verification commands + results. Flip each shipped
   item's `- [ ]` to `- [x]` **in this PR** — merge and status update
   stay one event. Partial items: the PR records `- [x] <what shipped>`
   plus a new `- [ ]` for only the remainder — never leave the broad
   original unchecked beside narrower remainders.
5. Drive the review loop on that one PR: `git_pr_checks` until CI
   settles; `git_view_pr` for Devin Review and human comments. Fix what
   is real; answer — don't code — what is wrong; resolve every thread
   you addressed (`resolve_thread_id`). Max 3 fix rounds; then escalate.
   Quiet window before merge: after your last push, wait ~15 min and
   re-read the PR once — a new actionable comment sends you back into
   the loop. Then merge per the confirmed policy.
6. Multi-phase requests loop: merge (or, under `report`, open) the
   phase PR, then return to step 1 for the next requested phase — later
   phases depend on the merged state of earlier ones. Under `report`,
   stop at the open phase PR and tell the user which later phases are
   waiting on its merge.
7. Send the user ONE report: per-item status + summary, plus the
   consolidated `manual_steps` (things only a human can do: secrets,
   dashboards, DNS, billing) and `postponed` (deliberately skipped
   setup, and why it was safe) — together they are the user's work
   queue. `blocked` items stay unchecked for the next run.

## Notes

- One PR per phase is the default; if a phase is genuinely too big for
  one reviewable diff, split along coherent seams (e.g. tooling vs
  schema) — never along item lines just because the items exist.
- If the phase can't fit in one context even delegated, land it in
  slices — each slice is still one PR covering whole items, not partial
  ones.
- Subagent prompts must say: don't touch `docs/roadmap.md`, don't open
  PRs — both are the orchestrator's lane.
- When in-session subagents are unavailable and the user hasn't
  approved child sessions, run items serially in-session rather than
  blocking on the mechanism.
