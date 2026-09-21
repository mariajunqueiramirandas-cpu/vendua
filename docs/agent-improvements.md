# Agent improvements backlog

Working list of improvements to the agent engine (`packages/core/src/agent/`),
collected from a competitive review of Explee's AutoGTM and a walkthrough of
our own worker. Ordered by theme; each item names the code it touches.

## Behavior changes (user-requested)

### 1. Triage on manual lead creation should be optional

Today `POST /control/v1/leads` always queues a `triage` run when
`agent_mode != 'off'` (app.ts — lead + run share one claim). Make it opt-in:
a body flag (e.g. `triage: false`) or a guardrail setting defaulting to on/off.
CSV import already creates leads with no run; manual add should be able to
behave the same way.

### 2. New inbound leads should get a full profile automatically

An inbound message from an unknown contact creates the lead and queues a
`reply` run — but nothing does the orientation pass triage does on manual adds
(`add_note` summary, `set_state`, `create_task`, profile fields). Options:

- Cheapest: teach the `reply` prompt — "first time seeing this lead →
  `add_note` a one-line summary + fill missing profile fields first".
- Stronger: when `addInboundMessage` returns `leadCreated: true`, enqueue a
  `triage` run alongside the `reply` run (agent/inbound.ts).

### 3. Reply/negotiation agent quality overhaul

The `reply`/`outreach` run kinds underperform discovery. Concretely:

- **Context management**: the run rebuilds context from scratch each turn —
  thread shows last 12 messages only; no durable per-lead memory object
  (agent_memory facts are global, not lead-scoped). Add a per-lead memory
  surface (e.g. `lead_memory` or facts keyed by lead) that runs read/write.
- **Prompt engineering**: reply prompt is short and reactive; it doesn't teach
  negotiation posture, objection handling, or when to push the goal. Discovery
  got the "field strategist" prompt with anti-patterns and a finish gate —
  reply deserves the same treatment.
- **Profile updating**: reply runs rarely write profile fields (fit, segment,
  notes). Prompt + tool affordance to keep the card current after each
  exchange.
- **Goal updating**: `agent_goal` is set at dispatch and never revisited. A
  lead who says "send me a proposal" while on goal=meeting should flip goals —
  today nothing does that.
- **Memory per lead**: see context item — today only global `agent_memory`
  exists.

## Worker robustness (from the run-reclaim review)

### 4. Attempt cap + backoff for requeued runs

`drain` requeues `running` runs past the 10-min lease forever — a poisoned run
(bad params, deterministic provider crash) requeues ahead of healthy work
(`claimRun` takes oldest first). Add `attempts`/`max_attempts` columns,
`requeue_after = now() + 2^attempts`, then `failed`.

### 5. Retry transient provider errors inside the run

A Gemini 429/timeout fails the whole run permanently; staff redrafts by hand.
Retry inside `provider.chat` (2–3 attempts, backoff) — most flakes never reach
the journal.

### 6. Resume from journal on reclaim

A requeued run restarts from scratch: `steps` are written but never replayed
into model context, so a reclaimed discovery run redoes the whole sweep and a
reclaimed reply can double-contact (idempotency keys dedupe only if the model
emits the identical call at the identical step). Replay journaled tool results
into context on resume.

### 7. Fence side effects, not just journal writes

`claim_token` protects `persist()` writes; `executeTool` still runs mutations
on a stale claim — a run reclaimed mid-`send_message` can send twice. Check
`lost` (or the token) inside mutating tools.

## Pipeline gaps (from the AutoGTM review)

### 8. Feed `next_action_at` (follow-up cadence)

The column + `sweepOutreach` exist, but nothing writes it: no prompt tells the
agent to schedule, no default cadence after a sent message. Add a prompt line
("lead didn't respond → set nextActionAt") plus a per-guardrail default cadence
after sends. This is what turns one-shot outreach into a sequence.

### 9. Analyst loop that acts

Auto-pause dead `discovery_briefs` in `sweepBriefs` — segmentStats already
computes leads/contacted/replied per segment over 30d; a brief with 0 leads
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
hiring posts) — vendua's high-intent tell — into a separate `intent_score`.

### 14. Stale-draft regeneration

When staff approves a draft older than N days, regenerate it once against the
current lead state instead of sending week-old copy.

### 15. Per-segment cost-per-lead on the board

`segmentStats` already computes costCents — surface CPL per segment as a board
column so staff sees which briefs pay.
