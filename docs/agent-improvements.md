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

#65 gave `reply` `serp`/`web_search`, and the negotiation prompt now
instructs a research + `update_lead`/`add_note` pass on raw inbound senders —
the profile-fill half is covered. Remaining gap:

- `reply` lacks `read_pages`/`maps_lookup`/`instagram_profile` (triage has
  them) — deliberately, per the live-conversation latency tradeoff
- No `set_state`/`create_task` intake instruction — a `triage` run alongside
  the `reply` when `addInboundMessage` returns `leadCreated` is still the
  clean fix if we want the full pass

### 3. Reply/negotiation agent quality overhaul — mostly shipped

The `reply`/`outreach` run kinds underperform discovery. #65 added the research
kit and `draftOnly` copilot mode; the negotiation-SOTA PR adds the rest:

- ~~**Context management**~~: `DOSSIÊ` block (recent notes + research
  findings) and `PLANO` block inject into triage/reply/outreach context.
  `leads.agent_plan` is the lead-scoped memory surface — a checklist the
  agent writes and ticks across runs.
- ~~**Prompt engineering**~~: reply/outreach prompts rewritten around the
  proven staged sequence (contexto → qualificação → valor → objeções →
  commit no OBJETIVO), with plan-write + tick discipline.
- ~~**Profile updating**~~: prompt instructs `update_lead` on new business
  info each exchange.
- ~~**Goal updating**~~: `update_lead` now accepts `agentGoal` — the agent
  flips the goal when the lead signals the other one.
- ~~**Fabricated commercial facts**~~: `pitch.offer` is the quotable-facts
  block (price, signup URL, example store) injected as `OFERTA`; the prompt
  forbids citing anything outside OFERTA/BOOKING_URL — empty means "confirm
  with staff", never invent. Sims caught the agent quoting different prices
  and invented links per lead; judge now receives FATOS PERMITIDOS and caps
  fabrication at 3.
- ~~**Opt-out detection**~~: the regex gate in `ingestInbound` is gone — the
  reply run classifies intent itself and calls the `unsubscribe` tool
  (unsubscribed_at + note, never sends after). Inbound on an already
  unsubscribed lead no longer queues a run at all.
- ~~**Eval harness**~~: `bun run sim` — seeded leads + hidden personas, the
  agent runs the real pipeline on a `log` driver, an LLM judge scores the
  transcript; results land in `sim_runs` + `sim-results/`.
- Remaining: a deeper per-lead memory than notes+plan (structured facts
  keyed to the lead), and a negotiation finish-gate/reflection like
  discovery's (the run ends when the model stops, not when the checklist
  says done).

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
`inboundReplyDelayMin` pacing, and the negotiation prompt now instructs
`update_lead nextActionAt` when a sent message goes unanswered — the agent
can produce it now. Remaining: a deterministic fallback so a cold lead gets a
follow-up even when the model forgets to write the field — e.g. a default
cadence stamped on send, or `run_at`-scheduled outreach instead of the lead
column (cleaner: same queue, cancelable in Runs).

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
