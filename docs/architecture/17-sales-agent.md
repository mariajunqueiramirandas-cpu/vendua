# 17 — Sales Agent

> Status: Accepted · Last reviewed: 2026-09-24
> Decision: [ADR 0014](../adr/0014-lead-owning-sales-agent.md)

The outbound/inbound sales agent that runs Venduá's own acquisition inside
`packages/core/src/agent/` and is operated from `apps/control`. (The storefront
**generation** pipeline is a different system — [14](14-agent-pipeline.md).)

Shape: **one agent per lead** with a durable **case file** and an **event
inbox**, one **manager agent** for the pipeline, a **discovery** agent for
prospecting, and a single legible **autonomy policy** that decides what any of
them may do without a human. The runtime underneath — `agent_runs` queue,
claim-token fencing, journal replay, idempotency keys, cost caps, send gate —
is unchanged by this design and keeps its invariants.

## Run kinds

| Kind        | Scope    | Triggered by                           | Lane                  |
| ----------- | -------- | -------------------------------------- | --------------------- |
| `lead`      | one lead | an **event** (below)                   | live / batch by event |
| `discovery` | board    | a brief (`sweepBriefs`, ~23h) or staff | batch                 |
| `manager`   | board    | `sweepManager` (daily) or staff        | batch                 |

`triage`, `reply`, `outreach` and `strategist` no longer exist — migration
0035 rewrites historical rows (`triage|reply|outreach → lead`,
`strategist → manager`) and their params into the event shape.

### Lead events (`agent_runs.params.event`)

Every `lead` run carries exactly one event. The event says _why_ the agent
woke; the agent decides _what_ to do.

| `event.type`     | Fields                                | Emitted by                                        | Lane  | Canceled by a fresh inbound? |
| ---------------- | ------------------------------------- | ------------------------------------------------- | ----- | ---------------------------- |
| `inbound`        | `threadId`                            | `ingestInbound` (coalesces per lead while queued) | live  | — (it _is_ the inbound)      |
| `wakeup`         | `kind: cadence\|commitment`, `reason` | `sweepWakeups` when `next_action_at` is due       | batch | only `cadence`               |
| `first_contact`  | `source: discovery\|staff`            | discovery autocontact, `POST /leads`              | batch | yes                          |
| `staff`          | `instruction?`, `goal?`, `channel?`   | dispatch, run-on-lead, the lead's "instruir" box  | live  | no                           |
| `assist`         | `threadId`                            | Inbox "agente sugere"                             | live  | no                           |
| `regenerate`     | `reason`, `messageId?`                | stale-draft approve, draft rejected with a reason | batch | no                           |
| `manager`        | `instruction`                         | the manager agent's `queue_followup`              | batch | yes                          |
| `meeting_booked` | `meetingId`                           | booking page confirmation                         | live  | no                           |
| `bounce`         | `channel`                             | email bounce webhook                              | batch | no                           |

Runs are **serial per lead**: at most one `lead` run is `running` for a lead
(claim skips a lead that has one). Queued `inbound` runs coalesce per lead —
one parked run absorbs a burst.

## The autonomy policy

One per-lead level, `leads.autonomy`:

| Level        | Meaning                                                 |
| ------------ | ------------------------------------------------------- |
| `off`        | staff owns the lead; no lead runs are queued or claimed |
| `suggest`    | the agent works, but every outbound becomes a draft     |
| `supervised` | routine replies/follow-ups send; risky actions draft    |
| `autonomous` | everything sends inside the hard guardrails             |

New leads take the default for their **source class** from the `autonomy`
setting (`defaults.inbound|discovery|staff|import`). Seeded defaults:
`inbound: supervised`, `discovery: supervised`, `staff: supervised`,
`import: suggest`.

Every outbound is classified into **one action class** and the policy table
maps `(level, class) → send | draft`. Hard guardrails are evaluated first and
always win (`block`): archived, unsubscribed, handoff pause
(`agent_paused_at`), thread pause (`agent_enabled=false`), bounced email,
daily cap, cost cap.

| Class            | When                                                        | suggest | supervised | autonomous |
| ---------------- | ----------------------------------------------------------- | ------- | ---------- | ---------- |
| `first_contact`  | no prior outbound to the lead                               | draft   | draft      | send       |
| `reply`          | the lead's last message is newer than our last outbound     | draft   | send       | send       |
| `followup`       | our last outbound is unanswered                             | draft   | send       | send       |
| `channel_switch` | sending on a channel other than the lead's last inbound one | draft   | draft      | send       |
| `sensitive`      | the model flagged `sensitive:true` (price, discount, terms) | draft   | draft      | send       |
| `low_confidence` | the model flagged `confidence:'low'`                        | draft   | draft      | draft      |

Precedence when several apply: `low_confidence` > `sensitive` >
`channel_switch` > `first_contact` > `reply`/`followup` — the **strictest**
verdict among all applicable classes wins. An `assist` event forces `draft`
regardless of level. Staff may override single cells via
`autonomy.policy[level][class]`; the effective table is the code default
merged with the override.

**Quiet hours** no longer block-and-fail: a live event arriving inside the
quiet window is queued with `run_at` = the window's end, and `sweepWakeups`
does not fire wakeups inside it. A send that still lands in quiet hours (a
long run crossing the boundary) is blocked as before.

`decide()` lives in `agent/policy.ts` and is the only place the verdict is
computed — the send tool, the preview endpoint and tests all call it.
`GET /control/v1/agent/policy` returns the effective table, defaults, and a
list of human-readable **scenarios** ("lead novo de inbound responde às 22h →
rascunho? não: responde às 08:00") computed by `decide()`.

Removed knobs: `agent_mode`, `guardrails.firstContactDraftOnly`,
`guardrails.discoveryAutoContact` (discovery autocontact is on iff
`autonomy.defaults.discovery != 'off'`), run `params.draftOnly` (→ `assist`
event), and the `firstContactDelayMin = 0 ⇒ draft` overload (it is now only a
delay).

## The case file

`leads.agent_case` (jsonb) is the lead-scoped memory every lead run reads and
writes through `update_case`:

```ts
interface AgentCase {
  stage?: 'contexto' | 'qualificacao' | 'valor' | 'objecoes' | 'commit' | 'fechado';
  facts: { key: string; value: string; source: 'lead' | 'research' | 'staff'; at: string }[]; // upsert by key
  commitments: {
    id: string;
    who: 'we' | 'they';
    what: string;
    due?: string;
    done?: boolean;
    at: string;
  }[];
  objections: { text: string; status: 'open' | 'handled'; at: string }[];
  refused: string[]; // formats the lead declined — never re-offer
  plan: { step: string; status: 'todo' | 'done' | 'skip'; note?: string }[]; // was leads.agent_plan
  nextStep?: { what: string; why: string };
}
```

Bounded: ≤40 facts, ≤20 commitments, ≤20 objections, ≤12 plan steps, strings
≤300 chars. `leads.agent_plan` is migrated into `agent_case.plan` and dropped.

## Wakeups

A lead has one wakeup slot: `next_action_at`, `next_action_kind`
(`cadence | commitment`), `next_action_reason`.

- `commitment` — a promise: the lead asked ("me chama terça"), staff set it,
  or we committed to a date. A fresh inbound **never** cancels it.
- `cadence` — the automation's own nudge. A fresh inbound clears it and
  cancels queued/running cancelable events (table above) and their drafts.

Writers: the `schedule_wakeup` tool, staff `PATCH /leads/:id nextActionAt`
(always `commitment`), and the deterministic cadence floor in
`dispatchMessage` (`followupCadenceDays`, `cadence`, only when empty).
Migration maps the old provenance: `staff|requested|agent → commitment`,
`cadence|auto → cadence`; `next_action_source` and `next_action_requested`
are dropped.

## Context of a lead run

Built per event by `agent/context.ts`:

- `LEAD` (row, trimmed), `OBJETIVO` (`agent_goal`), `AUTONOMIA`
- `CASO` — the case file
- `NOTAS` — last 4 notes (research findings live here)
- `CONVERSA` — the last 30 messages **across every thread/channel**,
  chronological, each tagged `[canal · direção · autor · hora]`, plus
  "+N anteriores — use read_conversation"
- `CANAIS` — reachability per channel, `CANAL FORÇADO` when staff pinned one
- `EVENTO` — a short preamble per event type (e.g. the staff instruction, the
  rejection reason with the rejected text, the wakeup reason)

System prompt layers (`agent/prompts.ts`): identity + policy (short) →
OFERTA / BOOKING_URL → **playbook** (setting `playbook {version, text}`,
editable in Config) → **doctrine** (curated facts) → kind instructions.
Tool manuals live in tool descriptions, not the system prompt.

## Tools

| Tool                                                                                            | lead | discovery | manager |
| ----------------------------------------------------------------------------------------------- | :--: | :-------: | :-----: |
| `search_leads`, `get_lead`                                                                      |  ✓   |     ✓     |    ✓    |
| `read_conversation({before?, limit?})`                                                          |  ✓   |           |         |
| `update_lead` (no autonomy/pause/next-action fields)                                            |  ✓   |     ✓     |         |
| `set_state`, `add_note`, `create_task`                                                          |  ✓   | add_note  |         |
| `send_message({body, channel?, subject?, sensitive?, confidence?})` — policy decides send/draft |  ✓   |           |         |
| `update_case`                                                                                   |  ✓   |           |         |
| `schedule_wakeup({at, kind, reason})`                                                           |  ✓   |           |         |
| `request_human({reason})` — handoff, pauses the lead                                            |  ✓   |           |         |
| `ask_staff({question})` — non-blocking question, `[pergunta]` task                              |  ✓   |           |         |
| `unsubscribe`                                                                                   |  ✓   |           |         |
| `web_search`, `read_pages`, `serp`, `maps_lookup`, `instagram_profile`                          |  ✓   |     ✓     |         |
| `create_lead`, `book`, `plan` (campaign text), `remember` (field notes)                         |      |     ✓     |         |
| `propose_brief`, `update_brief`, `queue_followup`, `propose_doctrine`, `write_digest_note`      |      |           |    ✓    |

`draft_message` is gone — drafting is a policy verdict, not a model choice.
`read_pages` keeps its per-run cap (2) on `inbound`/`assist` events.

## Memory

| Store       | Setting key                         | Written by                     | Read by          |
| ----------- | ----------------------------------- | ------------------------------ | ---------------- |
| Case file   | `leads.agent_case`                  | lead agent, staff              | that lead's runs |
| Doctrine    | `agent_doctrine {facts, proposals}` | staff; manager proposes        | lead + manager   |
| Field notes | `discovery_notes {facts}`           | discovery `remember` + debrief | discovery        |
| Playbook    | `playbook {version, text}`          | staff                          | lead             |

`agent_memory` is migrated: debrief lines (`run …`) → `discovery_notes`, the
rest → `agent_doctrine.facts`. Doctrine proposals are approved/rejected by
staff in the Agent page; nothing reaches lead prompts unapproved.

## Manager agent

Daily (`sweepManager`, advisory-locked, ≥20h since the last board-scoped
`manager` run). Context: funnel by state, segment stats, briefs with recent
yield, stuck leads (active state, no wakeup, no activity 7d, autonomy ≠ off,
top 20), approvals backlog (count, oldest age), 7-day spend, outcomes summary,
doctrine + pending proposals. It may pause/retarget briefs but never enable
one (enabling is staff approval of a proposal), queue ≤10 `manager` follow-up
events per run, propose doctrine, and write the digest note the daily email
includes when fresh (<24h).

## Scheduler

Two lanes, one queue. `live` = `lead` runs whose event is `inbound`, `staff`,
`assist` or `meeting_booked`; everything else is `batch`. The worker runs a
live loop (concurrency 2) and a batch loop (concurrency 1); a live kick never
waits for batch work. The LLM rate limiter is shared per driver but
priority-ordered: live calls take the next slot ahead of queued batch calls.
Sweeps (wakeups, briefs, manager, cap flags, snapshots, meeting reminders,
digest) run on their own timer, never behind a drain.

## Learning signals

- Approvals: approve accepts an edited `body` (the original is kept in
  `lead_messages.draft_body`); reject accepts a `reason` (stored in
  `reject_reason`) and, when given, queues a `regenerate` event.
- Every run stores `model` and `prompt_version`
  (`lead@2+pb<playbook version>`, `discovery@2`, `manager@1`).
- `GET /control/v1/agent/outcomes?days=30` groups agent outbound by
  `(prompt_version, model)`: sent, drafts approved as-is / edited / rejected,
  reply-within-48h rate, stage-advanced-within-7d rate, meetings booked.
- `GET /control/v1/agent/stats` reports live-lane reply latency (p50/p95,
  inbound `received_at` → next agent outbound) over 7 days.
- `bun run sim` stays a local, on-demand eval — it is deliberately **not** run
  in CI (token cost).

## Sandbox

`POST /control/v1/agent/sandbox` `{text}` / `DELETE` (reset) /
`GET` (transcript): a sandbox lead (`source = 'sandbox'`, autonomy
`autonomous`) whose outbound never reaches a driver — `dispatchMessage` marks
it `sent` in place. Staff type as the lead and watch the real lead agent
answer. Sandbox leads are excluded from lead lists, board, stats, outcomes and
the digest.

## Control API (the console contract)

Lead JSON gains `autonomy`, `agentCase`, `nextActionKind`, `nextActionReason`
and loses `agentMode`, `agentPlan`. Run JSON gains `model`, `promptVersion`,
`lane`, and exposes `params.event`.

| Route                                                                | Body / query                                                                       | Returns                                                                                                                                                 |
| -------------------------------------------------------------------- | ---------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `PATCH /control/v1/leads/:id`                                        | `autonomy`, `agentCase`, `nextActionAt` (+`nextActionReason`; always `commitment`) | `{lead}`                                                                                                                                                |
| `POST /control/v1/leads/:id/run`                                     | `{event: {type:'staff', instruction?} \| {type:'assist', threadId}}`               | `{runId}`                                                                                                                                               |
| `POST /control/v1/leads/:id/instruct`                                | `{instruction}` (≤1000 chars)                                                      | `{runId}`                                                                                                                                               |
| `POST /control/v1/agent/dispatch`                                    | `{leadIds, goal, channel?, instruction?}`                                          | `{enqueued, skipped}`                                                                                                                                   |
| `POST /control/v1/agent/runs`                                        | `{kind: 'discovery'\|'manager', params}`                                           | `{runId}`                                                                                                                                               |
| `GET /control/v1/agent/policy`                                       | —                                                                                  | `{levels, classes, table, defaults, scenarios: {label, verdict, why}[]}`                                                                                |
| `PUT /control/v1/settings/autonomy`                                  | `{defaults, policy?}`                                                              | setting                                                                                                                                                 |
| `PUT /control/v1/settings/playbook`                                  | `{text}` (server bumps `version`)                                                  | setting                                                                                                                                                 |
| `PUT /control/v1/settings/agent_doctrine`                            | `{facts}` (proposals are server-owned)                                             | setting                                                                                                                                                 |
| `POST /control/v1/agent/doctrine/proposals/:id/approve` \| `/reject` | —                                                                                  | `{doctrine}`                                                                                                                                            |
| `POST /control/v1/messages/:id/approve`                              | `{body?}`                                                                          | `{message, …}`                                                                                                                                          |
| `POST /control/v1/messages/:id/reject`                               | `{reason?}`                                                                        | `{message, runId?}`                                                                                                                                     |
| `GET /control/v1/agent/outcomes`                                     | `?days=30`                                                                         | `{rows: {promptVersion, model, sent, drafts, approvedAsIs, edited, rejected, replied48h, stageAdvanced7d, meetings}[]}`                                 |
| `GET /control/v1/agent/stats`                                        | —                                                                                  | `{replyLatency: {p50Sec, p95Sec, n}, lanes: {live: {queued, running}, batch: {queued, running}}, needsYou: {drafts, humanTasks, questions, proposals}}` |
| `GET` / `POST` / `DELETE /control/v1/agent/sandbox`                  | POST `{text}`                                                                      | `{leadId, messages}`                                                                                                                                    |

LLM integration config accepts `models: {lead?, discovery?, manager?}`; a
missing entry falls back to `config.model`.
