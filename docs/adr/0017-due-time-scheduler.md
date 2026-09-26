# ADR 0017 — Sleep until due, wake on change

Status: accepted (supersedes decision 7 of ADR 0016)

## Context

ADR 0016 left two `setInterval` loops firing every 15 seconds. Every routine ran
on every tick whether or not anything had changed: the agenda, meeting reminders,
the cost-cap scan and a full orphan-inbox scan. The daily and weekly routines asked
"has it run since the anchor?" roughly 5,760 times a day to act once. Latency was
set by the tick, idle load was constant, and the orphan sweep quietly made up for
missed transitions, so those bugs never showed.

## Decision

1. **Everything future is a due time in the database.** Runs have `run_at`, the
   agenda has `agent_wakeups.at`, reminders are `starts_at − 24h / − 1h`, and briefs,
   the weekly review, the digest and the pipeline snapshot come from their anchors
   (`anchorTx`) or state (`digestNextAtTx`). Recovery has due times too: a run's lease,
   a send stuck in `sending`, a queued send past its 20-second inline grace
   (`nextWorkAt`).
2. **No tick.** `agent/scheduler.ts` runs two loops (agent runs; routines), and they
   still never wait on each other. Each loop sleeps until its earliest due time.
   Only future times count. A row that is due but parked (paused lead, preset off,
   cost cap) is not "due now": the change that frees it sends a notification.
3. **Postgres notifications wake the loops.** Migration 0048 adds triggers that call
   `pg_notify('vendua_agent', {t: table, l: lead})` on the changes that can create
   due work:
   - queued runs, status changes, re-pended inbox mail
   - wakeups, lead suppression switches, thread `agent_enabled`
   - outbound message states, config keys in `control_settings`, briefs, meetings

   Notifications are delivered on commit and debounced (250 ms). Each routine
   declares `wakesOn`. A reconnected listener assumes it missed events and runs
   everything.

4. **Events replace the sweeps.**
   - Orphaned mail is served per lead (`serveOrphan`) for every lead a
     notification names. The full scan (`sweepOrphanInbox`) runs only after a config
     change or on reconcile.
   - The cost-cap scan runs when the cap changes.
   - Meeting heal and calendar drift are recovery work and run on reconcile.
   - HTTP and inbound kicks still drain from their own process, without the scan.
5. **Short retries when blocked.** A claim or wakeup skipped only because a lock was
   busy retries after 2 s. A reminder held by quiet hours, no channel or a failed
   send retries after 5 min. A failing routine backs off 30 s, doubling to 10 min.
   A routine that is still "due now" right after running is treated as a bug: it
   backs off and logs a warning, so it can't spin.
6. **One safety net.** A reconcile pass every 10 minutes scans every lead's mail and
   runs every routine. When it finds work the events didn't cover, it logs
   `reconcile found … — a change went un-notified`. That points at a missing trigger
   or call site to fix; it is not normal operation.

## Consequences

- An idle workspace does no scheduler work between reconciles.
- A due wakeup fires at its time, and a staff request or inbound message runs as
  soon as it commits.
- The CRM's routines panel shows real next times for the agenda, reminders and the
  queue.
- A new source of future work needs a due time the loop can read (a `nextAt`) and
  a notification when it changes (a trigger or `wakesOn`). Otherwise it waits for
  the reconcile, and the log says so.
- `startScheduler(sql, { jobs, work })` can narrow what runs, for tests.
