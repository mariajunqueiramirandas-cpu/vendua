# 18 — Agent Runtime v3

> Status: Proposed · Last reviewed: 2026-10-03 · Decision: [ADR 0030](../adr/0030-agent-runtime-v3.md) · Supersedes when the migration ends: the run machinery of
> ADRs [0014](../adr/0014-crm-agent-v2.md)–[0017](../adr/0017-due-time-scheduler.md) · First
> user: the [Vendedor](../features/sales-agent.md) · Later: the CRM sales agent

A new runtime for every LLM agent Venduá runs, built for the Vendedor first and then the CRM
agent, replacing `packages/core/src/agent/`. Not a refactor of the runner: a different model of
what an agent is. Paths are under `packages/core/` unless they start with `packages/`, `apps/`
or `docs/`.

## Summary

- **Why.** The CRM agent's problems are structural, not bugs. It keeps mutable rows plus a JSON
  journal instead of a log. Its effects aren't in the transaction that records them. Eligibility
  is checked in 14 places, and two god modules hold it together. Its 342 commits in 13 days are
  mostly patches over those causes ([§1](#1-why-a-new-runtime)).
- **The model in one line.** Every conversation is a **durable actor** on Postgres: a mailbox
  in, an append-only **event log** as its only state, one **turn** at a time under a fenced
  lease. A turn is a short program whose every step (model call, tool, guard, send) is recorded
  in the log, so a crash resumes where it stopped, a replay reproduces it, and an eval can re-run
  it against a new version.
- **Agents are declarations, not code paths.** `defineAgent` names the models, instructions,
  skills, tools, guards, statechart, budgets and evals. The definition is content-hashed into a
  **version** that every event carries, released through rings like the fleet (ADR 0011).
- **The model cites, Core speaks.** Replies reference ledger figures by id
  (`{{cart.total}}`); a renderer fills them with Core's values. A model that can't type a price
  can't invent one; the verifier is a second net, not the first.
- **Effects are rows.** A tool's business write, its result event and any outbound message
  commit in one transaction. Inside Postgres that is exactly-once, which replaces claim tokens,
  journals, STALE_CLAIM fences and "interrupted" markers.
- **Small context, loaded on demand.** A context compiler builds each request from typed,
  budgeted, cache-tiered blocks; skills load their instructions only when the conversation needs
  them; long threads are compacted in the background.
- **Evals ship the agent.** Scenarios with hidden goals and assertions on the event log, LLM
  users, pass^k, cassettes recorded from sims for deterministic CI, counterfactual replay of real
  logs, online QA on live traffic, and rollback when monitors regress.
- **A package with a wall around it.** `packages/agent-runtime` knows nothing about Core; Core's
  `src/agent-host/` implements its ports (Postgres, tools over modules, transports). An import
  check keeps it that way.
- **Migration** is a strangler: the Vendedor is born on v3; the CRM agent moves job by job,
  each gated by its sims; then `src/agent/` and its tables go away
  ([§13](#13-migration)).

## 1. Why a new runtime

Audited on 2026-10-02 (`packages/core/src/agent/`, 14,143 lines; its tests, 8,719). GitHub
counts 342 commits on that directory between 2026-09-19 and 2026-10-01: 168 touch
`runner.ts`, 124 `tools.ts`, 87 say "fix". By subject, about 58 are about concurrency, claims,
leases or the journal, 39 about mail and scheduling, and 18 about double sends and loops. The
design is not old so much as layered: each fix patched a symptom of one of the causes below.

| Root cause                                             | Evidence                                                                                                                                                                                                                                             | In v3                                                                                                                  |
| ------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| No single owner of "may the agent act"                 | The check is re-implemented about 14 times (`runner.ts:427`, `dispatch.ts:228`, `inbound.ts:121`, `wakeups.ts:346`, `send.ts:86`, `policy.ts:183`, `src/app.ts:2226` "mirror the claim gate"…); a test exists only to assert two copies agree.       | The statechart and the tool guards are the only gate; a turn exists only if the actor is woken.                        |
| Mutable rows plus a JSON journal, no log               | Pending work is a queued run, an inbox item or a wakeup, reconciled by `insertRun`'s adopt (`runner.ts:215`); the journal is written twice (`runner.ts:1521`); `next_action_at` mirrors wakeups.                                                     | One mailbox, one event log, projections rebuilt from it ([§4.1](#41-state)).                                           |
| Effects not in the transaction that records them       | Claim tokens and `assertRunClaimTx` (`tools.ts:728`), lock-ordering rules across 7 files, interrupted markers and `reconcileInterrupted` (`runner.ts:1327`), send dedupe in about 9 layers.                                                          | Effect, event and outbox row commit together under the epoch fence ([§4.3](#43-the-turn)).                             |
| God modules                                            | `runner.ts` (2,915 lines) does 21 jobs, from claiming to cron; `executeTool` (`tools.ts:770`) is one 1,735-line switch; 9 dynamic imports dodge cycles.                                                                                              | Engine, context, gateway, guards and tools are separate modules behind ports ([§3](#3-shape)).                         |
| New input mid-run bolted on                            | The inbox (#146) was followed by 11 fix PRs the next day; mail widens the toolset and state mid-run (`runner.ts:1741`, `:1758`).                                                                                                                     | Preemption at step boundaries, with the send as commit point ([§4.3](#43-the-turn)).                                   |
| Closed unions copied everywhere                        | Adding a job takes about 16 edits in 12 files (5 unions, 2 CHECK migrations, prompts, UI); adding a tool takes 4 mandatory edits and up to 6 more; Instagram touched 14 core files.                                                                  | One file and one registration per tool, skill or agent ([§5](#5-defining-an-agent)).                                   |
| Quality control as loop patches                        | Finish nudges with `limit = i + 5` (`runner.ts:2144`, `:2170`), REPEAT and LOOP guards, a reflection tick, the style bounce.                                                                                                                         | A statechart, finish conditions, guards with feedback, and evals that catch regressions.                               |
| Prompts and context unversioned, built from live reads | `contextFor` (`runner.ts:710`, 293 lines, about 12 queries); the lead card is `row_to_json` minus a skip-list, so new columns leak into prompts; no prompt or model version on runs; initial context not journaled, so production can't be replayed. | A pure context compiler, a version hash on every event, full replay ([§6](#6-context), [§10](#10-evals-and-releases)). |
| Cost computed in 6+ places, never capped mid-run       | The lifetime sum is enforced at `runner.ts:123`, `:363`, `:438`, `wakeups.ts:369`, `policy.ts:185`, `:271`; `cost_cents` is overwritten at finish; a provider failure fails the run and mints a staff task.                                          | One meter in the gateway, budgets checked before and after every call ([§7](#7-models)).                               |
| Tests that need the world                              | 9 of 11 agent test files need Postgres; `agent-reclaim.test.ts` is 56% of the test lines, with 304 raw SQL calls, hand-built journals and 3.6 s of sleeps; the live sims can't run in CI.                                                            | In-memory ports for the engine, cassettes for CI, scenarios on the real host ([§10](#10-evals-and-releases)).          |

The lesson the table draws: the agent's hard problems (concurrency, exactly-once, mid-run input,
replay) were solved one incident at a time inside a loop that wasn't designed for them. v3 makes
them properties of the substrate, so an agent author never sees them.

## 2. Principles

1. **The log is the truth.** Anything that happened is an event; every other table is a
   projection that can be rebuilt. No decision reads a flag that the log can't explain.
2. **One writer per conversation.** A fenced lease makes the actor single-threaded, so there are
   no races to guard in application code.
3. **Deterministic shell, probabilistic core.** The model proposes; typed code decides what is
   allowed (statechart, tool gates, guards, budgets, the ledger). Nothing safety-relevant lives
   only in a prompt.
4. **Declare, don't wire.** Adding a tool, a skill, a guard or an agent is one file and one
   registration, no enum, CHECK constraint or switch to update elsewhere.
5. **Everything replayable.** A turn can be re-run from its log with a fake clock and recorded
   model outputs, and re-run with live models against a new version.
6. **Measured before it's believed.** A version doesn't reach a store until its eval suite
   passes, and it leaves when its monitors regress.
7. **Boring infrastructure.** Postgres, Bun and TypeScript, which Venduá already runs. No new
   cluster.

### Converged and frontier

As of October 2026 the field has converged on some of this; the rest is where few teams are.

| Pattern                                                              | Status    | Here                                                           |
| -------------------------------------------------------------------- | --------- | -------------------------------------------------------------- |
| Memoized steps around every model and tool call, per conversation    | Converged | [§4.3](#43-the-turn)                                           |
| An append-only session log outside a stateless loop                  | Converged | [§4.1](#41-state)                                              |
| People in the loop as suspend and resume                             | Converged | [§4.3](#43-the-turn)                                           |
| Strict tool schemas, tool guards, code for policy-critical steps     | Converged | [§5](#5-defining-an-agent), [§8](#8-grounding-by-construction) |
| Stable-prefix caching, compaction, small always-on context           | Converged | [§6](#6-context)                                               |
| Simulations and pass^k gating releases                               | Converged | [§10](#10-evals-and-releases)                                  |
| Durability on Postgres alone, no deterministic-replay constraint     | Frontier  | [§4.3](#43-the-turn), [§14](#14-decisions)                     |
| The model cites figures by id; the system renders every number       | Frontier  | [§8](#8-grounding-by-construction)                             |
| Effects and their events in one transaction (exactly-once in the DB) | Frontier  | [§4.3](#43-the-turn)                                           |
| Preemption at safe points when the user writes mid-turn              | Frontier  | [§4.3](#43-the-turn)                                           |
| Counterfactual replay of real logs against a candidate version       | Frontier  | [§10](#10-evals-and-releases)                                  |
| Background memory consolidation after the conversation               | Frontier  | [§9](#9-memory)                                                |
| Agent versions released through rings with automatic rollback        | Frontier  | [§10](#10-evals-and-releases)                                  |
| A voice front end delegating to the same actor                       | Frontier  | [§12](#12-other-front-ends)                                    |

## 3. Shape

```
packages/agent-runtime/            pure TypeScript; imports nothing from Core, no DB driver
  define/      defineAgent · defineTool · defineSkill · defineGuard · statechart
  engine/      actor activation, turn loop, step memoization, preemption, budgets
  context/     context compiler: blocks, budgets, cache tiers, compaction
  model/       gateway: provider adapters, router, fallback, hedging, cost
  ledger/      figure ledger, reference rendering, the verifier
  guards/      input, tool, output and supervisor pipelines; stock guards
  evals/       scenarios, simulated users, judges, pass^k, cassettes, replay
  telemetry/   OpenTelemetry GenAI spans
  ports.ts     EventStore · Mailbox · Leases · Effects · Clock · Telemetry

packages/core/src/agent-host/      Core's side of the wall
  store/       Postgres ports: agent_actors, agent_mailbox, agent_events (RLS)
  scheduler    LISTEN + due-time sleep; lanes; tenant fairness
  transports/  whatsapp (store gateway, ADR 0026), web chat, instagram
  agents/
    vendedor/  definition, tools over modules, skills, guards, evals
    crm/       the CRM agent, after its port
```

`agent-runtime` exposes a small public API and a set of ports. Core implements the ports, so the
runtime can be tested with in-memory ports in milliseconds and the host with the real database.
A CI check (like `storefront-isolation`) fails any import from `packages/core` inside the
runtime.

## 4. Durable actors

### 4.1 State

An actor lives in three tables, all with `tenant_id`, the `tenant_isolation` + `control_access`
policy pair and bounded columns. They replace `agent_runs`, `agent_inbox`, `agent_wakeups`,
`agent_run_steps` and the agent columns spread over `leads`. Two more complete the set:
`agent_memory` ([§9](#9-memory)), tenant-scoped like these, and `agent_versions`, the deployed
definitions, which are platform data under the control policy like today's agent tables.

| Table           | Holds                                                                                                                                                                                                                        |
| --------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `agent_actors`  | One row per (agent, subject): the version pin, the lease (`owner`, `epoch`, `until`), `next_wake_at`, and a cached projection of the actor's state with the log sequence it reflects.                                        |
| `agent_mailbox` | What wakes an actor: inbound messages, timers, webhooks, merchant actions. `kind`, bounded `payload`, `source`, `deliver_at`, `dedupe_key` unique per `(tenant_id, dedupe_key)`, `consumed_by_turn`.                         |
| `agent_events`  | The log: `(actor_id, seq)` unique, `turn_id`, `step`, `type`, `payload`, `version`, `at`. Partitioned by month; bodies of model I/O kept for the retention the owner sets, everything else for the life of the conversation. |

Event types are namespaced strings validated by the definition that emits them, not a CHECK
enum: `turn.started`, `model.responded`, `tool.called`, `tool.returned`, `guard.blocked`,
`message.sent`, `state.changed`, `memory.proposed`, `handoff.started`, `timer.set`,
`turn.ended`, and so on. Adding one touches one file.

Projections (the Vendedor's `shopper_threads`, the inbox's list, metrics) are folds over the log,
updated in the same transaction as the events that change them, and rebuildable.

### 4.2 Scheduling

- **Waking.** A trigger on `agent_mailbox` sets `next_wake_at` and `pg_notify`s, the pattern of
  migration 0048 and ADR 0017: the scheduler sleeps until the next due time or a notification.
- **Claiming.** `FOR UPDATE SKIP LOCKED` on actors that are due and unleased; the lease bumps
  `epoch`. The claim and the watchdog run as control, because they span stores, and they only
  touch the lease columns.
- **Tenant scope.** Everything else in a turn runs in `withTenant(actor.tenant_id)`
  transactions, so RLS applies to every read and write the model can cause. A step's fence
  check, tool write, events, mailbox update, projection and outbox row are one such
  transaction.
- **Fencing.** That transaction first reads the actor row with
  `owner = me and epoch = mine and lease_until > now() … FOR SHARE`, which holds off a lease
  steal until it commits. It is the fencing the WhatsApp gateway uses
  (`src/store-whatsapp/auth-store.ts:73`). A process that lost its lease can't write.
- **Lanes.** Each agent declares a lane: `interactive` (a person is waiting), `followup`,
  `background`. Lanes have their own worker pools, so a 30-step research turn never delays a
  shopper's reply.
- **Fairness.** Within a lane, claims rotate across tenants (weighted round robin), so one
  store's Friday rush can't starve the others; per-tenant concurrency caps bound it.

### 4.3 The turn

```
activate(actor)
  lease → epoch
  batch ← mailbox.take(actor, quiet window)           coalescing, declared per agent
  log: turn.started {batch, version}
  state ← project(log)
  repeat ≤ budget.steps
    if new input arrived and agent.preempt: log turn.superseded → restart with it
    request ← compile(context, state, skills, tools allowed in state)
    out ← step('model', gateway.generate(request))     recorded; a replay returns the record
    for call in out.toolCalls                          reads in parallel, writes in order
      guards.tool(call, state)  → block | run
      step('tool', tx ⇒ tool.run(ctx, input) + log tool.returned + outbox)   one transaction
    for reply in out.replies
      guards.output(reply) → block (feedback to the model) | render + log message.sent + outbox
    state ← fold(new events)
    until agent.finish(state)
  log: turn.ended {usage, cost}
  release: lock the actor row FOR UPDATE, set next_wake_at from unconsumed mailbox rows, clear the lease
```

- **Step memoization.** `step(id, fn)` returns the recorded result if the log has one for this
  turn and step; otherwise it runs `fn` and records it. A crashed turn is re-run from the top and
  fast-forwards through what already happened: the same model output, the same tool results, no
  second charge, and no second outbox row. Because results are loaded from the log rather than
  recomputed, the turn code needn't be deterministic (Temporal's constraint); this is the
  Postgres-only model of DBOS and of Absurd, in our own tables.
- **Watchdog.** A lease that lapses (a dead worker) is reclaimed with backoff; the epoch fence
  makes two recoveries racing harmless. A turn that fails its retry budget ends in
  `turn.failed`, and the agent's degrade path runs (for the Vendedor, the storefront link and a
  handoff).
- **Exactly-once effects.** A tool that writes (a cart line, an order) does it in the
  transaction that appends its `tool.returned` event, under the epoch fence. Either both commit
  or neither does. Outbound messages are outbox rows in that same transaction
  (`store_wa_messages`), so a message exists only if its turn step does, the rule ADR 0026 set
  for order updates. That is exactly-once into the outbox. Delivery stays at-least-once: the
  gateway re-sends a row whose send lease lapsed (`src/store-whatsapp/gateway.ts:465`), and
  WhatsApp shows it once because the message id derives from the row id. The outbox needs the
  chat-row changes listed in [sales-agent §4.2](../features/sales-agent.md#42-transport-and-inbound).
- **External calls** (Mercado Pago, a transcription API) are keyed by the business object, not
  the step: `order:{id}:pix`, `media:{id}:transcript`. A superseded turn's successor has new
  step ids but finds the same charge. Their results are recorded like any step.
- **Preemption.** If the shopper writes again mid-turn, the engine stops at the next step
  boundary, marks the turn superseded and starts a new one with the new input. The
  `turn.superseded` transaction releases the old turn's batch (clears `consumed_by_turn`), so
  the next turn answers everything the shopper sent. A running
  side-effecting tool is never aborted; read results already recorded are reused. Sending is the
  commit point: the transaction that writes the outbox row first checks the mailbox for newer
  input and, if there is any, supersedes instead of sending. No stale answers, no half
  replies.
- **One producer.** Everything that wakes an actor (an inbound message, a webhook, a merchant
  action, a timer) is a mailbox row written by `dispatchTx(tx, { actor, kind, source,
dedupeKey, deliverAt })` inside the transaction that caused it. Nothing else inserts mailbox
  rows or starts turns.
- **Timers are messages.** "Nudge in 15 minutes", "Pix expires at 21:16", "hand back in 30
  minutes" are mailbox rows with a `deliver_at`, written through `dispatchTx` like the rest.
  There is no separate wakeup machinery.
- **What the team hears.** A failed turn, an automatic rollback and an online-QA alert are staff
  events: `recordStaffEventTx` inside the transaction that commits them, never in a
  `Promise.all` with that transaction's other statements, with no shopper names or phones in
  the payload (ADR 0023).
- **Human in the loop.** An approval (a draft in `shadow` mode, a merchant's "Devolver") is a
  mailbox message; the actor waits for it like any other input. Draft, approve, edit and reject
  are events, not statuses on a message row.

## 5. Defining an agent

```ts
export const vendedor = defineAgent({
  id: 'vendedor',
  subject: 'shopper_thread',
  lane: 'interactive',
  models: {
    default: 'fast',
    escalate: [{ when: (s) => s.guardBlocks > 0 || s.complex, to: 'strong' }],
  },
  instructions: [base, storeVoice, houseRules], // blocks, see §6
  skills: [halves, combos, encomenda, reorder, complaint, allergens, outOfZone],
  tools: [searchCatalog, getProduct, cartEdit, quote, sendCard, reply, placeOrder, handoff /* … */],
  statechart: sellerChart, // states, allowed tools, required slots
  guards: {
    input: [markUntrusted, redactContacts],
    tool: [stateGate, budget, confirmation],
    output: [grounded, noHumanClaim, promises, style],
  },
  mailbox: { quiet: { minMs: 2500, maxMs: 20_000, extendWhile: 'typing' }, preempt: true },
  budgets: { stepsPerTurn: 8, tokensPerTurn: 60_000, tenantDaily: 'store_agent.budget' },
  finish: (s) => s.repliedSinceLastInput || s.owner !== 'agent',
  evals: import.meta.dir + '/evals',
});
```

- **The version** is a hash of the definition, every instruction and skill text, and every tool
  schema. It is stored in `agent_versions` on deploy and carried by every event, so any reply can
  be traced to the exact prompt and tools that produced it.
- **Tools** are typed capabilities:

  ```ts
  export const cartEdit = defineTool({
    name: 'cart_edit',
    effect: 'write', // read | write | money | send | irreversible
    states: ['browsing', 'building', 'checkout'],
    input: s.object({ ops: s.array(cartOp).max(20) }), // Standard Schema → JSON Schema
    run: (ctx, input) => editCart(ctx.tx, ctx.tenantId, ctx.subject.cartId, input.ops), // Core module
  });
  ```

  The subject (tenant, thread, phone, cart) comes from `ctx`, never from the model's arguments.
  Catalog items, modifiers and orders reach the model as short aliases (`p12`, `m3`) that the
  host maps to UUIDs; short semantic ids are measurably harder to hallucinate than UUIDs, and an
  alias that doesn't exist is a validation error.
  Schemas use the Standard Schema interface, so the runtime emits JSON Schema for providers and
  validates with whatever library the host picks. `read` tools may run in parallel; the rest run
  in order. A tool's result can add ledger figures and cards.

- **Statecharts** hold the deterministic skeleton: states, transitions on events and tool
  results, the tools allowed in each state, and the required slots that produce the `FALTA`
  checklist ([sales-agent §4.6](../features/sales-agent.md#46-state-checklist-and-tools)). The
  model moves inside it and can't leave it.
- **Skills** are instruction packs with a one-line trigger: `defineSkill({ id: 'halves', when:
'pizza com dois sabores', instructions, tools?, examples?, evals })`. The base prompt lists
  them by trigger only; the statechart or the model (`load_skill`) loads one when the
  conversation needs it. The always-on prompt stays small and the cache prefix stays stable.

## 6. Context

A **context compiler** turns the agent definition and the actor's state into a provider request.
It is a pure function, snapshot-tested.

| Tier         | Blocks                                                    | Changes when          | Cache             |
| ------------ | --------------------------------------------------------- | --------------------- | ----------------- |
| static       | Base rules, tool schemas, skill triggers                  | A new version         | Always            |
| tenant       | The store pack: profile, hours, catalog lines, knowledge  | The merchant edits    | Per store version |
| subject      | Customer card, memory, episodic summary                   | Between conversations | Per conversation  |
| conversation | The transcript since the last compaction, loaded skills   | Every turn            | Growing prefix    |
| volatile     | `AGORA`, `ESTADO`, `CARRINHO`, `FALTA`, `SUGESTÃO`, input | Every step            | Never             |

- **Ordering and cache breakpoints** follow the tiers, so the prefix the provider caches is as
  long as possible and byte-stable. Volatile facts (the clock, the cart) never sit above stable
  ones; where the provider supports turn-scoped system messages they go there, so the top-level
  system prompt never changes. The tenant tier uses the longest cache lifetime the provider
  offers. Every `model.responded` records cache reads, writes and, where reported, the miss
  reason.
- **Budgets per block.** Each block declares a token budget and a priority; over budget, the
  compiler drops or summarizes the lowest priority first and records what it cut.
- **Untrusted content is fenced.** Shopper text, transcripts, image descriptions and anything a
  third party wrote enter as data blocks the base rules tell the model never to obey.
- **Compaction.** When a conversation's transcript passes a threshold, a background turn writes
  a summary event and the compiler uses it in place of the older messages. Providers now offer
  server-side compaction and context editing; the gateway may use them, but the runtime keeps
  its own so behaviour doesn't change with the provider.
- **Multimodal at the edge.** The runtime's message model carries text, image and audio parts;
  the host's ingest step can still turn media into text first (transcripts, photo descriptions
  with catalog candidates), so a text-only model works and evals stay cheap.

## 7. Models

A **model gateway** sits between the engine and the providers.

- **Adapters** normalize each provider to one message model (parts, tool calls, reasoning,
  cache markers, usage). The drivers in `src/agent/llm.ts` are the starting point.
- **Routing** by policy: a fast tier and a strong tier per agent, mapped per tenant to the
  providers reached only through a zero-data-retention arrangement (owner, 2026-10-03; a
  `zdr` flag per provider route, set by staff, enforced here); escalation rules in the
  definition.
- **Resilience.** A circuit breaker per provider, a fallback chain, and for the interactive lane
  a hedged second request when the first passes the p95 latency, cancelled when either answers.
  Hedging only repeats a model call (never a tool), and a hedge usually misses the prompt cache,
  so it is reserved for the tail.
- **Streaming inside, whole messages outside.** The gateway streams so it can see a tool call
  as soon as its arguments close and start a `read` tool before the model finishes
  (speculative tool execution). Shoppers still receive whole WhatsApp messages.
- **Structured outputs.** Tool arguments are generated against strict schemas wherever the
  provider supports constrained decoding. Strict modes don't enforce every bound (lengths,
  ranges), so the runtime validates every argument again.
- **Escalation in place.** Besides routing a turn to the strong tier, the gateway can use a
  provider's advisor pattern, where a cheap model consults a stronger one mid-generation, when
  evals show it beats a full switch.
- **Accounting.** Tokens, cache reads and writes, latency and cost are fields of
  `model.responded`; budgets are checked before the call (estimate) and after (actual), per turn,
  per subject and per tenant.

## 8. Grounding by construction

- **The ledger.** Every figure Core returns (prices, totals, fees, discounts, ETAs, hours) is
  entered in the actor's ledger with an id, a value, its formatted text and its source event.
- **References.** The `reply` tool takes text with references, `Total {{cart.total}}, chega em
{{quote.eta}}`. The renderer substitutes Core's formatting. An unknown reference is a
  validation error the model sees and fixes.
- **The verifier** (sales-agent [§4.8](../features/sales-agent.md#48-the-verifier)) still runs
  on the rendered text: a literal amount, time, product or promise that didn't come through a
  reference is blocked. With references it should almost never fire; when it does, it's a
  signal worth an alert.
- **Supervisor.** For the few high-stakes outputs (an incentive, a complaint, a refusal to
  sell), a second, cheap model checks the reply against a short rubric before it is sent. It can
  only block or pass; blocks feed the eval suite.

## 9. Memory

| Kind       | What                                                                | Where                                  |
| ---------- | ------------------------------------------------------------------- | -------------------------------------- |
| Working    | The compiled context of a step                                      | Not stored beyond the model event      |
| Episodic   | Conversation summaries from compaction                              | `agent_events` (`memory.compacted`)    |
| Semantic   | Facts about a customer or a store, with provenance and confidence   | `agent_memory`, keyed, RLS             |
| Procedural | Skills, and per-store examples the merchant approved in shadow mode | Code, and `agent_memory` (`example.*`) |

- **Writes are proposals.** A turn emits `memory.proposed`; a policy (allowlisted keys,
  confidence, health data only with recorded consent and a confirmation on every use)
  accepts it into `agent_memory`.
- **Consolidation after the conversation** ("sleep-time"): a background turn reads a finished
  conversation and proposes facts, knowledge gaps and examples, so the interactive turn never
  pays for it.
- **Retrieval** is by key and Postgres full-text search first; embeddings (pgvector) only if
  evals show the need.

## 10. Evals and releases

- **Scenarios are code** next to the agent: a store fixture, a simulated user with a hidden goal,
  and assertions on the event log.

  ```ts
  scenario('meia calabresa meia frango, borda, pix', {
    store: fixtures.pizzaria,
    user: persona({
      goal: order(pizzaG.half(calabresa, frango).borda(cheddar), coca2l),
      style: 'áudio, pressa',
    }),
    expect: [placedOrderEquals(goal), noLiteralFigures(), turnsAtMost(6), noHandoff()],
    k: 5, // pass^k: all five runs must pass
  });
  ```

- **Simulated users are agents** on the same runtime, with the fake clock and in-memory
  transports, against a real Core on the test database. Simulators are imperfect proxies (one
  2026 study measured up to 9 points of variance from the choice of user model alone), so each
  scenario runs under more than one user model, personas are audited against real
  conversations, and the regression suite is seeded with real failures (start with the first
  20–50) as soon as there are any.
- **Cassettes.** A passing live sim records its model outputs; CI replays them with the scripted
  provider, so code changes are checked deterministically and free, and only prompt or model
  changes need live runs.
- **Counterfactual replay.** Any actor's log (synthetic, or real with consent and anonymized)
  can be re-run from a chosen event with a candidate version; a judge and a diff report what
  changed.
- **Online QA.** A background agent scores a sample of finished conversations against the same
  rubrics and opens alerts on drops.
- **Rings.** A new version goes internal stores → pilot stores → a share of stores → all,
  promoted when its suite passes and its monitors (guard blocks, handoffs, conversion,
  complaints) hold, rolled back automatically when they don't. Stores can be pinned. It is ADR
  0011's ring model applied to agent versions.
- **Prompt optimization** (GEPA-style reflective search) runs offline on small curated sets,
  for the supervisor and individual prompt sections, and proposes changes as PRs; nothing
  rewrites a prompt in production.

## 11. Observability and safety

- **Traces.** Each turn is an OpenTelemetry trace with GenAI spans (`invoke_agent`, `chat`,
  `execute_tool`) carrying the agent version, tokens, cache use and cost, keyed by
  `gen_ai.conversation.id`. The GenAI conventions are still marked Development in 2026, so spans
  go through an adapter, and they carry metadata only: content and personal data stay in the
  Postgres log, under RLS.
- **The turn inspector** in the CRM shows, for any turn, the compiled context, the model output,
  every guard decision and every effect, straight from the log. The merchant inbox gets a
  simpler "por que respondeu isso".
- **Capabilities, not trust.** Tools are bound to the actor's subject by the host; no tool takes
  a tenant, subject or customer id from the model.
- **PII.** Phone numbers and emails are replaced by tokens before a request leaves for a provider
  and restored on render.
- **The audit trail is the log.** Who (agent version, merchant, staff) did what, when and why.

## 12. Other front ends

The actor doesn't care how input arrives. A web chat, Instagram DM or a voice call is a
transport that writes to the mailbox and reads the outbox. Voice is the next frontier: WhatsApp's
Calling API (official API only) plus a full-duplex speech model as a front end that delegates
reasoning, tools and grounding to the same actor, so a call and a chat share one cart and one
log. Agent-to-agent commerce protocols (MCP, A2A, the 2026 checkout protocols) would be another
transport; the owner declined external assistant integrations on 2026-10-01.

## 13. Migration

1. **Build the runtime and host with the Vendedor** (its V0–V2). The CRM agent keeps running on
   `src/agent/` untouched.
2. **Port the CRM `reply` job.** Its sims (`bun run sim`) move to the new scenario format and
   must match or beat the old scores before inbound leads switch.
3. **Port outreach, then discovery and the strategist** as `followup` and `background` agents.
4. **Delete** `runner.ts`, `tools.ts` and the rest of `src/agent/`, archive and drop
   `agent_runs`, `agent_inbox`, `agent_wakeups` and `agent_run_steps`, and the agent columns on
   `leads`.
5. **[ADR 0030](../adr/0030-agent-runtime-v3.md)** records the runtime and supersedes the run machinery of ADRs 0014–0017 once this step lands.

The agent invariant in `CLAUDE.md` changes twice. At step 1, when the first mailbox row is
written, it names two producers: `requestAgentTx` for the old runtime and `dispatchTx` for v3,
each the only way to start work on its side, with timers as rows of the same producer. At step
4 it drops `requestAgentTx` and reads: agent work starts only as a mailbox message with a
`source`, written by `dispatchTx` inside the transaction that caused it; nothing else creates
turns; future touches are timer messages.

CRM data is platform data with no `tenant_id` today. Before step 2 the owner picks between a
reserved platform tenant (one RLS model everywhere) and a control-scoped variant of the three
tables ([§14](#14-decisions)).

## 14. Decisions

Taken here as proposals, for the owner to accept:

- **Own tables on Postgres, not a workflow engine.** The patterns have converged (memoized
  steps, a session log, suspend and resume for people), so the choice is where they run:

  | Option                               | Why not first                                                                                                                                                                     |
  | ------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
  | Temporal, Restate                    | A cluster to run and its own store; effects can't share a transaction with Core's writes; Temporal also requires deterministic workflow code.                                     |
  | Cloudflare Durable Objects ("Think") | Not portable off Cloudflare; per-object SQLite outside our RLS model.                                                                                                             |
  | LangGraph, Vercel Workflow, Mastra   | Checkpointing libraries, not leases with fenced recovery; Vercel's Postgres backend is a reference implementation.                                                                |
  | DBOS (MIT, Postgres-only, TS v5)     | The closest fit and the fallback: steps, queues, fair queues since 2026-09-29. Its system tables sit outside `tenant_id` + RLS, and our log is a domain record, not a checkpoint. |
  | Anthropic Managed Agents, Agent SDK  | One provider's harness; the owner keeps providers open under LGPD.                                                                                                                |

  The engine we need is small (Absurd, a Postgres-only durable runtime in production since
  2026, is one SQL file and about 1,400 lines of TypeScript), and owning it keeps tenant RLS on
  every row and effects in Core's transactions. If building it slips, a spike on DBOS is the
  plan B.

- **One agent with skills, not a swarm.** A transactional seller needs one accountable loop; the
  supervisor and the background agents are separate actors with narrow jobs.
- **No fine-tuning on conversations.** Meta's Business Platform terms forbid training on its
  data and LGPD would need a basis; better prompts, skills and examples come from evals. Distilling
  a small model from synthetic simulations stays possible later.

Open:

1. **Own engine or DBOS**, after a one-week spike on each against the turn contract of §4.3.
2. **CRM tenancy** for the port: a platform tenant or control-scoped tables.
3. **Schema library** behind Standard Schema (Core validates by hand today).
4. **Trace backend** for the OpenTelemetry export, or only the built-in inspector at first.
5. **Retention** of model I/O bodies in the log (ties to sales-agent decision 4).

## Sources

Researched 2026-10-02. Vendor figures are claims; several pages were read through a summarizer.

- **Durable execution:** anthropic.com/engineering/managed-agents (2026-04-08);
  docs.restate.dev/ai/patterns/sessions; temporal.io/blog/announcing-openai-agents-sdk-integration
  (2026-03-23); blog.cloudflare.com/project-think/ (2026-04-15);
  diagrid.io/blog/checkpoints-are-not-durable-execution-… ; vercel.com/kb/guide/durableagent-to-workflowagent
  (2026-06-25); pydantic.dev/docs/ai/capabilities/durable_execution/backends/;
  github.com/dbos-inc/dbos-transact-ts and dbos.dev/blog/whats-new-in-dbos-september-2026;
  lucumr.pocoo.org/2026/4/4/absurd-in-production/.
- **Context:** anthropic.com/engineering/effective-context-engineering-for-ai-agents
  (2025-09-29); platform.claude.com docs on context editing, compaction, memory tool, tool
  search, prompt caching and release notes; OpenAI and Google prompt-caching guides;
  mastra.ai/blog/changelog-2026-02-11.
- **Grounding:** platform.claude.com/docs/en/build-with-claude/structured-outputs;
  anthropic.com/engineering/writing-tools-for-agents (2025-09-11, short ids);
  decagon.ai/blog/aop-the-future-of-cx; intercom.com/blog/procedures-simulations-updates/
  (2026-02-25); sierra.ai/blog/constellation-of-models (2025-12-03);
  openai.github.io/openai-agents-python/guardrails/.
- **Evals:** anthropic.com/engineering/demystifying-evals-for-ai-agents (2026-01-09);
  github.com/sierra-research/tau2-bench (τ³); arxiv.org/pdf/2601.17087 ("Lost in Simulation");
  sierra.ai/blog/simulations-the-secret-behind-every-great-agent; arxiv.org/pdf/2507.19457
  (GEPA); decagon.ai/blog/optimizing-gepa-for-production (2026-03-25).
- **Observability:** github.com/open-telemetry/semantic-conventions-genai (agent spans);
  opentelemetry.io/blog/2026/genai-observability/.
- **Latency:** platform.claude.com docs on fast mode, programmatic tool calling and the advisor
  tool (2026-04-09).
- **Voice:** developers.openai.com/api/docs/models/gpt-live-1 (2026-07-08);
  developers.facebook.com/docs/whatsapp/cloud-api/calling.
- **Memory consolidation:** platform.claude.com/docs/en/managed-agents/dreams;
  platform.claude.com/docs/en/managed-agents/define-outcomes.

## Change log

- 2026-10-02: first proposal.
