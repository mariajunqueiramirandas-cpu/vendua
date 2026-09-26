# Agent improvements backlog

Working list of improvements to the agent engine (`packages/core/src/agent/`),
collected from a competitive review of Explee's AutoGTM and a walkthrough of
our own worker. Ordered by theme; each item names the code it touches.
Last reviewed 2026-09-26: every numbered item is shipped; the open follow-ups
are listed under [Still open](#still-open). `run_at` delayed runs,
reply/inbound pacing, research kit, and `draftOnly` shipped in #65; the
agent v2 contracts (ADRs 0014–0017) landed in #134–#176.

Since the list was written, run kinds are fixed _jobs_ in `agent/jobs.ts`
(ADR 0015) and every run is requested through `requestAgentTx` with a
`source` (ADR 0016) — read "run kind" below with that in mind.

## Behavior changes (user-requested)

### 1. Triage folded into the contact run — shipped

`POST /control/v1/leads` no longer fans out a `triage` run plus a scheduled
`outreach`: one outreach run does the card's whole job — research → dossier →
first contact. `firstContactDelayMin` still paces the send; `0` stays the
approval path (the run fires at once but draft-only). `automation:false`
skips agent work entirely, matching CSV-import behavior; the `triage` body
flag is gone. The `triage` run kind survives for manual re-research via the
dispatch API.

### 2. New inbound leads qualify in-conversation, not via sidecar — shipped

Inbound (`addInboundMessage`) queues only the `reply` run — no triage
sidecar, and that direction was explicitly rejected (user call): a separate
research agent on a live inbound is dumb — the person is right there, so the
reply run ASKS the qualifying questions (the qualification step already lives
in its negotiation plan). `serp`/`web_search` stay in reply's kit as fallback
only — when the thread can't produce the fact (verifying a named business,
a request that needs a lookup). Profile fill rides the same `update_lead`/
`add_note` discipline — from what the person reveals, not silent research.
`reply` still lacks `read_pages`/`maps_lookup`/`instagram_profile` —
deliberately, per the live-conversation latency tradeoff.

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
- ~~**Per-lead memory**~~: `lead_facts` (memory v2, ADR 0014) holds
  structured facts keyed to the lead, beside notes + plan.
- Partly shipped: reply/outreach have a finish gate (`requiresAction` — the
  run must end on a visible lead-facing action, one nudge otherwise). Still
  missing: a reflection step that checks the negotiation checklist, so the
  run ends when the plan says done, not when the model stops.

## Worker robustness (from the run-reclaim review)

### 4. Attempt cap + backoff for requeued runs — shipped (PR #72)

`attempts`/`max_attempts` on `agent_runs`; reclaim requeues behind
`run_at = now() + 2^attempts min` and lands `failed` at the cap.

### 5. Retry transient provider errors inside the run — shipped (PR #68)

Gemini provider wraps calls in a process-wide 14-RPM slot chain plus retries
that honor `Retry-After`; transient 429/5xx flakes no longer fail the run.

### 6. Resume from journal on reclaim — shipped (PR #72)

`replayJournal` feeds journaled assistant/tool turns back into context on
resume; `interrupted` markers close crashed calls so the model re-verifies
instead of double-contacting.

### 7. Fence side effects, not just journal writes — shipped (PR #72)

`assertRunClaimTx` fences every mutating tool (and `dispatchMessage`) first
inside its claim transaction — a stale/canceled claim throws `STALE_CLAIM`
before any write.

## Pipeline gaps (from the AutoGTM review)

### 8. Follow-up cadence — shipped (PR #70)

Deterministic floor landed: `followupCadenceDays` in `dispatchMessage`
finalization stamps `next_action_at` on unanswered sends, never clobbering an
agent-set value. Follow-up noted on the PR: provenance-aware cadence refresh
(`next_action_source`).

### 9. Analyst loop that acts — shipped (PR #73)

`briefAutoPauseRuns` guardrail (default 5, 0=off): a brief with 0 leads over N
runs pauses itself via a journal-mined streak with a `rearmed_at` re-arm
boundary.

### 10. Strategist run kind — shipped (PR #73)

Weekly `strategist` run reads segmentStats + agent_memory and proposes
disabled draft briefs (`propose_brief` tool); the board shows a `proposta`
chip with one-click `aprovar`.

### 11. Daily staff digest — shipped (PR #71)

`sweepDigest` + atomic `digest_state` claim + `digest` settings key sends the
once-a-day Resend summary (new leads, replies, meetings, spend).

### 12. Channel health monitoring — shipped (PR #71)

Blocked sends persist; `/control/v1/channels/health` rolls up
failures/bounces/quiet-hours blocks per channel and the board shows an alert
chip (surface-only, no auto-pause).

### 13. Intent scoring beside fitScore — shipped (PR #73)

`intent_score`/`intent_reason` on leads, surfaced in harvest cards, the leads
table, and `create_lead`.

### 14. Stale-draft regeneration — shipped (PR #70)

`staleDraftDays` guardrail: approving a draft older than N days supersedes it
and regenerates once against current lead state instead of sending week-old
copy.

### 15. Per-segment cost-per-lead on the board — shipped (PR #71)

`cpl` column on the Descoberta segment table.

## Still open

- **Negotiation reflection** — see item 3: a checklist-aware finish step for
  reply/outreach, like discovery's debrief.
- **Reply research kit** — `reply` still lacks `read_pages`/`maps_lookup`/
  `instagram_profile` by design (item 2); revisit only if sims show inbound
  runs stalling on facts the thread can't produce.
