# ADR 0030: Agent Runtime v3, durable actors on Postgres

- Status: Proposed
- Date: 2026-10-03

## Context

Venduá runs one LLM agent today, the CRM agent that sells Venduá to leads
(`packages/core/src/agent/`). A second, the [Vendedor](0031-vendedor.md), sells for each store to
its shoppers. It is latency-sensitive (a shopper is waiting), tenant-scoped (store data under
RLS) and handles money (one order per confirmed cart, Pix).

The CRM agent can't host it as it stands. The audit in
[`architecture/18-agent-runtime.md` §1](../architecture/18-agent-runtime.md#1-why-a-new-runtime)
found structural causes behind its 342 commits in 13 days:

- **No owner for "may the agent act".** The check is re-implemented about 14 times.
- **Mutable rows instead of a log.** Pending work is a run, an inbox item or a wakeup, plus a JSON
  journal written twice.
- **Effects outside the transaction that records them.** This is patched with claim tokens,
  interrupted markers and nine layers of send dedupe.
- **God modules.** `runner.ts` does 21 jobs; `executeTool` is a 1,735-line switch.
- **Closed unions everywhere.** Adding a job takes about 16 edits across 12 files.
- **Unversioned, unreplayable prompts.** Prompts and context are built from live reads, so
  production turns can't be reproduced.
- **No tenancy.** Its tables have no `tenant_id` and run under the `staff_all` control policy.

## Decision

Build a new runtime, Agent Runtime v3, specified in
[`architecture/18-agent-runtime.md`](../architecture/18-agent-runtime.md). The Vendedor is its
first agent; the CRM agent moves to it afterwards.

1. **A durable actor per conversation.** `agent_actors`, `agent_mailbox` and `agent_events`, each
   with `tenant_id` and the `tenant_isolation` + `control_access` policies. The event log is the
   only state; every other table is a projection that can be rebuilt. Two more tables complete
   the set:
   - `agent_memory`, tenant-scoped like these;
   - `agent_versions`, platform data under the control policy.
2. **One turn at a time under a fenced lease.**
   - Claiming and the watchdog run as control and touch only the lease columns.
   - Every step of a turn runs in a `withTenant(actor.tenant_id)` transaction. It first reads
     the actor row with `owner`, `epoch` and `lease_until > now()` under `FOR SHARE`, the
     gateway's fencing (`src/store-whatsapp/auth-store.ts:73`).
   - Release locks the actor row before recomputing `next_wake_at`.
3. **Memoized steps.** A model call, tool or send is recorded in the log; a re-run turn reads the
   record back. Turn code needn't be deterministic.
4. **Effects are rows.** A tool's business write, its event and any outbox row commit in that one
   transaction. That is exactly-once into the outbox; delivery past it stays at-least-once with
   provider-side dedupe, as ADR 0026 does. External calls are keyed by the business object
   (`order:{id}:pix`), not the step.
5. **One producer.** Everything that wakes an actor is a mailbox row written by
   `dispatchTx(tx, { actor, kind, source, dedupeKey, deliverAt })`. That covers inbound messages,
   webhooks, merchant actions and timers. It runs inside the transaction that caused it, with
   `(tenant_id, dedupe_key)` unique. Nothing else starts a turn. Future touches are timer rows.
6. **Preemption at safe points.** New input stops a turn at the next step boundary. The
   superseding transaction releases the old batch so the next turn answers everything.
   Side-effecting tools are never aborted. The send is the commit point: it checks the mailbox
   for newer input in the transaction that writes the outbox row.
7. **Agents are declarations.**
   - `defineAgent`, `defineTool`, `defineSkill`, guards and a statechart, one file each.
   - The definition is content-hashed into a version that every event carries.
   - Tools take their subject (tenant, conversation, customer) from the runtime, never from the
     model's arguments.
8. **The model cites, Core speaks.** Replies reference ledger figures by id and Core renders
   them. A verifier blocks any literal amount, time, product or promise that didn't come
   through a reference.
9. **A model gateway.**
   - Fast and strong tiers mapped per tenant to the providers the owner allows.
   - Fallback, and hedged requests for the slowest calls.
   - Strict schemas, re-validated by the runtime.
   - Budgets per turn, subject and tenant, checked before and after every call.
10. **Evals gate releases.**
    - Scenarios with hidden goals asserted on the log, passing on every one of k runs (pass^k).
    - Simulated users on more than one model.
    - Cassettes replayed in CI, and counterfactual replay of real logs.
    - Online QA on live traffic.
    - Versions go out in rings (ADR 0011's model) with automatic rollback.
11. **A wall between runtime and Core.** `packages/agent-runtime` imports nothing from Core.
    Core's `src/agent-host/` implements its ports, and a CI check enforces the boundary.
12. **Own the engine on Postgres.** DBOS is the plan B after a one-week spike on each against
    the turn contract.
13. **Staff alerts.** A failed turn, a rollback or an online-QA alert calls `recordStaffEventTx`
    inside the transaction that commits it, with no shopper data (ADR 0023).

### Migration and the agent invariant

1. Build the runtime with the Vendedor; the CRM agent stays on `src/agent/`.
2. Port the CRM `reply` job, gated by its sims.
3. Port outreach, discovery and the strategist.
4. Delete `src/agent/` and its tables.

This ADR supersedes the run machinery of ADRs 0014–0017 when step 4 lands, not before. The agent
invariant in `CLAUDE.md` changes twice:

- **At step 1**, it names both producers: `requestAgentTx` for the old runtime and `dispatchTx`
  for v3, each the only way to start work on its side, with timers as rows of the same producer.
- **At step 4**, it reads: "agent work starts only as a mailbox message with a `source`, written
  by `dispatchTx` inside the transaction that caused it; nothing else creates turns; future
  touches are timer messages."

## Consequences

- The hard problems the CRM agent solved one incident at a time become properties of the
  substrate:
  - concurrency;
  - exactly-once effects;
  - input arriving mid-turn;
  - replay.

  An agent author writes tools, skills and guards.

- Every reply is traceable to the version that produced it. Any turn can be inspected and
  re-run, and a regression can be caught before a store sees it.
- Adding a tool, skill or agent is one file and one registration. No CHECK constraint or union
  has to change.
- Two runtimes coexist until the CRM port ends; that period should be short.
- The engine is ours to build and to keep correct. The plan B and the contract tests on both
  in-memory and Postgres ports bound that risk.
- `agent_events` grows with every step. It is partitioned by month, and model I/O bodies follow
  the retention the owner sets.
- Effects are exactly-once only inside Postgres. Outbound delivery remains at-least-once, and
  external calls rely on business keys.

## Alternatives considered

| Option                                        | Why not                                                                                                                           |
| --------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| Refactor `runner.ts` behind a subject adapter | Keeps the causes: mutable rows, effects outside their record, unions everywhere. The first draft of the Vendedor design did this. |
| Temporal, Restate                             | A cluster and its own store; effects can't share a transaction with Core; Temporal needs deterministic workflow code.             |
| Cloudflare Durable Objects                    | Not portable; per-object SQLite outside our RLS model.                                                                            |
| LangGraph, Vercel Workflow, Mastra            | Checkpointing libraries without fenced leases and recovery.                                                                       |
| DBOS                                          | The closest fit, kept as plan B: its system tables sit outside `tenant_id` + RLS, and our log is a domain record.                 |
| Anthropic Managed Agents, Agent SDK           | One provider's harness; providers stay open under LGPD.                                                                           |

## Open decisions

1. Own engine or DBOS, after the spike.
2. CRM tenancy for the port: a reserved platform tenant or control-scoped variants of the three
   tables.
3. The schema library behind Standard Schema.
4. The trace backend for the OpenTelemetry export, or the built-in inspector only at first.
5. Retention of model I/O bodies.

## Links

- [`architecture/18-agent-runtime.md`](../architecture/18-agent-runtime.md): the full design,
  sources and the converged-vs-frontier review.
- [ADR 0031](0031-vendedor.md): the first agent on it.
- ADRs [0014](0014-crm-agent-v2.md), [0015](0015-one-agent-config.md),
  [0016](0016-agent-dispatch-and-scheduler.md), [0017](0017-due-time-scheduler.md): the run
  machinery this supersedes when the migration ends.
