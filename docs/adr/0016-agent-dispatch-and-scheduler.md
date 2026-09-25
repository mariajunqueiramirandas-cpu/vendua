# ADR 0016 — One dispatcher, one agenda, one scheduler

Status: accepted

## Context

Twelve code paths started agent runs: four staff endpoints, three event paths
(inbound, discovery auto-contact, expired-draft regenerate) and five sweeps.
Each wrote an `agent_runs` row and an `agent_inbox` item on its own, and they
talked to each other through markers in `params` — `auto` (nine values),
`origin` (`staff`/`inbound`), and "unmarked means a promise". Later touches
lived in two places (`leads.next_action_at` with five provenance values, and
`agent_wakeups`), with fold logic between them. All recurring work hung off one
15-second promise chain behind the agent's own LLM runs, so a long drain made
meeting reminders late, one throwing sweep skipped every sweep after it, and
the briefs / weekly review drifted ("23h / 7d since the last run").

## Decision

1. **Provenance is data.** `agent_runs` and `agent_inbox` carry `source`
   (`inbound | callback | staff | regenerate | first_contact | followup | brief
| weekly`), `promised`, and (runs) `priority` — `agent/sources.ts`. Parking
   under the preset / job switches is `source <> 'staff' and not promised`;
   an inbound retires only the agent's own unanswered outreach
   (`first_contact`, `followup`). Migration 0044 backfills from the old markers
   and removes them.
2. **One dispatcher.** `requestAgentTx` (`agent/dispatch.ts`) is the only
   producer path: it files the lead's inbox item, picks the start, and adopts
   the active run or queues one via `insertRun`. The orphan sweep lives there
   too and serves the highest-priority pending item first. A request the cost
   cap refuses is withdrawn (the lead's own messages wait for budget instead).
3. **Smart start.** Send-bound work (a reply, callback, follow-up, first
   contact) that would go out live is queued for the end of quiet hours instead
   of waking up to be blocked; drafting work (copilot, draft-mode leads, a
   supervised first contact) runs at once.
4. **Priority.** `claimRun` orders by priority, then age: a waiting customer,
   then promises, staff asks, first contacts, the agent's follow-ups, briefs,
   the weekly review.
5. **One agenda.** Every future touch is an `agent_wakeups` row — the
   post-send cadence, dates the agent picks (`schedule`, `update_lead
nextActionAt`), callbacks the lead asked for, dates staff set.
   `leads.next_action_at` only mirrors the earliest pending one.
   `sweepOutreach` is gone; migration 0045 moved existing dates.
6. **One staff endpoint.** `POST /control/v1/agent/requests
{ kind, leadIds?, threadId?, focus?, channel?, draftOnly?, goal?, params? }`
   replaces `/leads/:id/run`, `POST /agent/runs` and `/agent/dispatch`. One
   lead: failures are 404/422 as before. Many: `{ runs, skipped }`.
7. **Scheduler.** `agent/scheduler.ts` runs two loops that never wait on each
   other (agent runs; routines). Each routine is isolated and recorded in
   `scheduled_jobs` (migration 0046) — `GET /agent/routines` shows cadence,
   next run and failing streaks. Briefs run daily at
   `agent.schedule.discoveryHour` and the weekly review at
   `weeklyDay`/`weeklyHour`, in the workspace timezone; the pipeline snapshot
   uses the workspace's date. SIGTERM stops claiming and lets the run in hand
   finish (bounded) before exiting.

## Consequences

- A new trigger names a `source` and calls `requestAgentTx` — nothing else.
- The Estúdio shows the schedule next to the job switches and the routines'
  health on the agenda tab; every run in Atividade says why it exists.
