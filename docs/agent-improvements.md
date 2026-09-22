# Agent improvements backlog

Working list of improvements to the agent engine (`packages/core/src/agent/`),
collected from a competitive review of Explee's AutoGTM and a walkthrough of
our own worker. Ordered by theme; each item names the code it touches.
Updated after the `cool-fixes` batch (PRs #70–#73): every item below is now
shipped except the remaining gaps noted inside items 2 and 3. `run_at`
delayed runs, reply/inbound pacing, research kit, and `draftOnly` shipped in
#65.

## Behavior changes (user-requested)

### 1. Triage on manual lead creation should be optional — shipped (PR #70)

`POST /control/v1/leads` accepts `automation`/`triage` opt-outs — no triage
run and no scheduled first-contact run when disabled, matching CSV-import
behavior. Board got a toggle alongside.

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
