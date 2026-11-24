# Agent improvements backlog

Working list of improvements to the agent engine (`packages/core/src/agent/`, since 2026-10-14
the CRM agents on Agent Runtime v3, ADR 0030),
collected from a competitive review of Explee's AutoGTM and a walkthrough of
our own worker. Ordered by theme; each item names the code it touches.
Last reviewed 2026-09-26: every numbered item is shipped; the open follow-ups
are listed under [Still open](#still-open). `run_at` delayed runs,
reply/inbound pacing, research kit, and `draftOnly` shipped in #65; the
agent v2 contracts (ADRs 0014–0017) landed in #134–#176.

Since the list was written, run kinds are fixed _jobs_ in `agent/jobs.ts`
(ADR 0015) and every run is requested through `requestAgentTx` with a
`source` (ADR 0016) — read "run kind" below with that in mind.

## Autonomous sales

Autopilot is the default. Explicit workspace presets and lead modes remain effective.
Website callbacks and live inbound go ahead of scheduled outreach. Delivery rechecks
policy, quiet hours and newer contact, including at the WhatsApp gateway. Follow-up
limits apply across an unanswered sequence as well as within a day.

The CRM agent reads the current public plans and sends signed self-serve signup links
when signup is open. A verified signup links the lead and retires pending sales work.
The provisioner records when the store is live. The activity view displays the sales
outcome of a turn, and agent metrics include unanswered intake and signup, activation,
payment and opt-out counts by source.

### Sales playbook

The merchant shares a storefront link through WhatsApp, Instagram, or QR code. Shoppers open it in
the browser (no app download, no account/password), pick items, flavors, options, kits, or scheduled
pre-order dates, and place the order. The merchant manages the menu (paste-list or import, one-tap
sold-out, quick pause), orders, delivery/pickup, Pix/payments, and hours in the Venduá app. Full
plans add Duá on WhatsApp, loyalty, KDS, thermal printing, and PDV. The agent knows the real product
deeply and picks **one** concrete piece that fits the merchant's situation — never a feature dump.

The live offer supplies plan availability, prices, fees, Duá limits, and trial terms. Trial
eligibility is confirmed at signup. The workspace offer holds additional approved claims and
materials. After consulting `get_sales_offer`, `send_message` verifies any quoted price, fee, or
trial days directly against the live catalog so the agent can answer pricing questions and compare
plans naturally in conversation without fabricating numbers. Official signup links always go through
`send_signup_link` with natural `intro`/`outro` framing and compact 38-char signed tokens.

| Situation              | What the agent does                                                                                                                                                    |
| ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Inbound greeting       | Greets warmly as Venduá and asks an open question without guessing what they sell.                                                                                     |
| First-time seller      | Helps them picture the first order (CPF accepted, paste list to start light) and asks one guiding question. Estimates stay estimates.                                  |
| Active merchant        | Uses the order workflow or friction the merchant confirmed. Connects one real feature and answers direct questions in sentence one.                                    |
| Cold outreach          | Verifies the business and contact source, picks **one** natural detail (never a scraped bio dump or SDR clichés), and asks a low-effort human question. No link/price. |
| Short reply to cold DM | Treats "Sim", "Faz", or "Como funciona?" as curiosity — NEVER dumps price or signup link. Explains briefly how it fits their shop and asks 1 discovery question.       |
| Price question         | Reads live plans and answers directly in natural prose (comparing Mirim vs Bandeira when helpful, attributing 0% to Venduá's fee). Does not push the link unasked.     |
| Ready to start         | Checks availability, sends the compact signed signup link via `send_signup_link` wrapped in a natural `intro`/`outro` tailored to their business.                      |
| Follow-up              | Delivers a promised next step or adds one light, genuinely helpful note with an easy out (no guilt-tripping). Skips with `add_note` when there is nothing useful.      |
| Discovery              | Picks a buying situation the source can show, checks duplicates, records owner first name (if public) and one natural hook. Scores fit and intent independently.       |
| Weekly review          | Proposes small single-hypothesis campaigns. Separates real conversations from cold 1-word drop-offs alongside verified signup, activation, payment, cost, opt-outs.    |

With default pacing, an unanswered sequence gets up to two agent touches. The default cadence
waits three days, and drafts older than three days are regenerated against the current context.
Workspace overrides set the effective limits. An explicit callback has its own timer. A plan
uses stable milestones for situation, need, value and next step. A completed milestone carries
the fact or action that completed it, and skipped steps leave the progress denominator.

When planning a campaign, change one element at a time, such as the audience, the signal used
in the first message or the offer to explain a workflow. Review which replies expressed interest
before scaling. Track signup and activation in comparable cohorts. The activity totals in the
weekly review use event dates and can include customers acquired outside that window. A light
first ask is a starting hypothesis. Judge how it works for Venduá using actual reply quality
and conversion. [Gong's cold outreach analysis](https://www.gong.io/resources/guides/how-to-master-cold-email-get-the-data-backed-guide-based-on-85-million-emails)

Run the CRM regression tests for prompt routing, tool outcomes, cadence and signup. For live
model evaluation, run `bun run sims:crm -- --scenario confeitaria-sim-curto` (or
`marmitaria-frio-preco`, `picole-primeira-venda`) from `packages/core` with a simulation database
and model routes configured. It uses the actual CRM, catalog, signed signup links and local log
delivery. The simulator reports a delivered signup link and a verified signup as separate outcomes.
Compare the transcript and outcome on the same scenarios before changing the default sales model
or tactic.

## Behavior changes (user-requested)

### 1. Triage folded into the contact run — shipped

`POST /control/v1/leads` no longer fans out a `triage` run plus a scheduled
`outreach`: one outreach run does the card's whole job — research → dossier →
first contact. `firstContactDelayMin` still paces the send. Zero runs immediately
under the current send policy. `automation:false`
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

### 11. Daily staff digest — shipped (PR #71), moved to Discord

`sweepDigest` + atomic `digest_state` claim + `digest` settings key sent the
once-a-day Resend summary (new leads, replies, meetings, spend). Retired
2026-10-09: the summary is the `discord-digest` job (ADR 0023).

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

### 16. Conversation quality overhaul — shipped

Real-lead tests showed the agent interrogating a bare "Ola" ("O que vocês vendem
por aí? (doces, marmitas, pizza...)"), offering demos and example catalogs no one
delivers, inventing benefits ("sem comissão") and sending a literal `\n\n`.

- **Prompt layout** (`agent/prompts.ts`): identity → product → _O que existe de
  verdade_ (the only offerable next steps: BOOKING_URL, OFERTA, handoff) → staff
  rules → writing rules → negotiation → goal → per-kind playbook → channels →
  pre-send check. Examples teach by contrast (Bom/Ruim with why); a lone quoted
  line gets copied verbatim by small models.
- **Style check** (`agent/style.ts`): `send_message`/`draft_message` bounce the
  first robotic body of a run (em dash, markdown, bullets, guess lists, 3+
  questions, template placeholders, demo/example offers, stock bot phrases)
  back to the model with the issues; the second attempt goes out as written.
  Escaped `\n` in bodies becomes a real line break.
- **Context** (`agent/context-render.ts`): `AGORA` (local weekday/time), a
  trimmed lead card, a `NOME` warning when the name is still the phone, and
  `CONVERSA` as a dated transcript (who said it, what never reached the lead);
  runs without a thread see the lead's recent messages across channels.
- **WhatsApp**: áudio/imagem/vídeo/documento arrive tagged instead of dropped;
  Baileys marks the lead's pending messages read and shows "digitando…" right
  before each send.
- **Context budgets** (`CTX` in `runner.ts`): lead runs read the lead's whole
  history across channels (≤400 messages, 60k chars; overflow keeps the opening +
  the recent tail with a cut marker), up to 30 notes (3k chars each, 20k total),
  200 facts, open team tasks and stage history.
- **Caching**: the Anthropic driver caches the system prompt and the run's growing
  conversation (`max_tokens` 16k, cache-aware cost); OpenRouter caches the system
  prompt for `anthropic/*` models. The system prompt holds nothing volatile (time
  lives in the context message), so the prefix stays byte-stable.
- **Defaults**: the stock pitch no longer pre-authorizes trials/demos. Installs
  with a stored `pitch`/`agent.instructions` keep their own text.
- **Sim**: lead-opened scenarios (`opener`) incl. `inbound-oi`,
  `brownie-quer-ver`, `inbound-cliente-final`, `robo-e-preco`; the judge scores
  a rubric (escuta, naturalidade, descoberta, veracidade, avanço) and caps
  promised-but-nonexistent deliverables like fabricated prices.

## Still open

- **Negotiation reflection** — see item 3: a checklist-aware finish step for
  reply/outreach, like discovery's debrief.
- **Reply research kit** — `reply` still lacks `read_pages`/`maps_lookup`/
  `instagram_profile` by design (item 2); revisit only if sims show inbound
  runs stalling on facts the thread can't produce.
