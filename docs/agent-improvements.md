# Agent improvements backlog

Working list of improvements to the agent engine (`packages/core/src/agent/`),
collected from a competitive review of Explee's AutoGTM and a walkthrough of
our own worker. Ordered by theme; each item names the code it touches.
Updated after the lead-pacing PR (#65): `run_at` delayed runs, reply/inbound
pacing, research kit on triage/reply, and `draftOnly` copilot mode shipped —
the remaining gaps are noted per item.

## Behavior changes (user-requested)

### 1. Triage on manual lead creation should be optional

Today `POST /control/v1/leads` always queues a `triage` run when
`agent_mode != 'off'` — and since #65 it _also_ queues a scheduled `outreach`
run when `firstContactDelayMin > 0`. Make the automation opt-in: a body flag
(`triage: false`) or guardrail settings covering both the triage run and the
scheduled first-contact run. CSV import already creates leads with no run;
manual add should be able to behave the same way.

### 2. New inbound leads should get a full profile automatically — partially done

#65 gave `reply` `serp`/`web_search`, so an inbound-triggered run can enrich
the sender — but the orientation pass is still missing. Remaining gap:

- `reply` lacks `read_pages`/`maps_lookup`/`instagram_profile` (triage has them)
- No instruction to do triage's intake work on first sight: `add_note`
  summary, `set_state`, `create_task`, fill missing profile fields

Cheapest close: prompt line in `reply` ("first time seeing this lead → note +
fill fields first") — optionally a `triage` run alongside when
`addInboundMessage` returns `leadCreated`.

### 3. Reply/negotiation agent quality overhaul

The `reply`/`outreach` run kinds underperform discovery. #65 added the research
kit and `draftOnly` copilot mode; the core gaps remain:

- **Context management**: thread shows last 12 messages only; no durable
  per-lead memory object (`agent_memory` facts are global, not lead-scoped).
  Add a lead-scoped memory surface that runs read/write.
- **Prompt engineering**: reply prompt is short and reactive — no negotiation
  posture, objection handling, or goal-pressure guidance. Discovery got the
  "field strategist" treatment (anti-patterns, finish gate); reply deserves
  the same.
- **Profile updating**: reply runs rarely write profile fields (fit, segment,
  notes). Prompt + tool affordance to keep the card current after each
  exchange.
- **Goal updating**: `agent_goal` is set at dispatch and never revisited. A
  lead who says "send me a proposal" while on goal=meeting should flip goals —
  today nothing does that.

## Worker robustness (from the run-reclaim review)

### 4. Attempt cap + backoff for requeued runs

`drain` requeues `running` runs past the 10-min lease forever — a poisoned run
requeues ahead of healthy work (`claimRun` takes oldest first). `run_at` (#65)
is the natural primitive: add `attempts`/`max_attempts`, requeue with
`run_at = now() + 2^attempts`, then `failed`.

### 5. Retry transient provider errors inside the run

A Gemini 429/timeout fails the whole run permanently; staff redrafts by hand.
Retry inside `provider.chat` (2–3 attempts, backoff) — most flakes never reach
the journal.

### 6. Resume from journal on reclaim

A requeued run restarts from scratch: `steps` are kept for the monid spend
rebuild but never replayed into model context, so a reclaimed run redoes the
work and can double-contact (idempotency keys dedupe only if the model emits
the identical call at the identical step). Replay journaled tool results into
context on resume.

### 7. Fence side effects, not just journal writes

`claim_token` protects `persist()` writes; `executeTool` still runs mutations
on a stale claim — a run reclaimed mid-`send_message` can send twice. Check
`lost` (or the token) inside mutating tools.

## Pipeline gaps (from the AutoGTM review)

### 8. Follow-up cadence — primitive shipped, nothing feeds it

#65 added `run_at` (delayed runs) and `firstContactDelayMin` /
`inboundReplyDelayMin` pacing — but nothing yet schedules a _follow-up_ after a sent
message that goes unanswered. `next_action_at` remains write-only via
`update_lead`; `sweepOutreach` consumes it but nobody produces it. Two options:
prompt the agent to set `nextActionAt` (existing machinery), or schedule a
follow-up `outreach` run directly via `run_at` (probably cleaner — it flows
through the same queue and is cancelable in Runs).

### 9. Analyst loop that acts

Auto-pause dead `discovery_briefs` in `sweepBriefs` — segmentStats already
computes leads/contacted/replied/live per segment (all-time; only costCents
is 30d-scoped); a brief with 0 leads
over N runs should pause itself with a note, not keep burning runs.

### 10. Strategist run kind

A weekly-cadence run that reads segmentStats + agent_memory and _proposes_
new `discovery_briefs` for staff approval (draft rows, enabled=false) instead
of staff writing them by hand.

### 11. Daily staff digest

One Resend email/day summarizing board state (new leads, replies, meetings,
spend). Pure SQL → email; optional 1 LLM call if the model writes the summary.

### 12. Channel health monitoring

Deliverability analog: rollup of send failures/bounces/quiet-hours blocks per
channel; alert (or pause sends) when the rate crosses a threshold.

### 13. Intent scoring beside fitScore

`fitScore` says ICP match, not buying intent. Score signals the tools already
return (WhatsApp-active business with no ordering link, recent reviews,
hiring posts) into a separate `intent_score`.

### 14. Stale-draft regeneration

When staff approves a draft older than N days, regenerate it once against the
current lead state instead of sending week-old copy.

### 15. Per-segment cost-per-lead on the board

`segmentStats` already computes costCents — surface CPL per segment as a board
column so staff sees which briefs pay.
