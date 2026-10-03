# @vendua/agent-runtime

Agent Runtime v3 ([ADR 0030](../../docs/adr/0030-agent-runtime-v3.md), design in
[`architecture/18-agent-runtime.md`](../../docs/architecture/18-agent-runtime.md)). Every
conversation is a durable actor: a mailbox in, an append-only event log as its only state, one
turn at a time under a fenced lease. Pure TypeScript with no dependencies; it imports nothing from
Core (`tools/check-agent-runtime-boundary.mjs`). Core implements the ports in
`packages/core/src/agent-host/`.

| Path             | What                                                                                       |
| ---------------- | ------------------------------------------------------------------------------------------ |
| `src/define/`    | `defineAgent` (content-hashed version), `defineTool`, `defineSkill`, guards, statecharts   |
| `src/engine/`    | `Runtime`: claim, the turn loop, memoized steps, preemption, budgets, the state fold       |
| `src/context/`   | The context compiler: tiers in cache order, block budgets, untrusted fencing               |
| `src/model/`     | The gateway (ZDR routes, fallback, breaker, hedging, PII tokens) and provider adapters     |
| `src/ledger/`    | Figures, `{{id}}` references and the verifier                                              |
| `src/guards/`    | Stock input, tool and output guards, the supervisor                                        |
| `src/evals/`     | Scenarios, personas, pass^k, cassettes, counterfactual replay, online QA, rings            |
| `src/telemetry/` | OpenTelemetry GenAI spans (metadata only), log and in-memory sinks                         |
| `src/testing/`   | In-memory ports (`MemoryStore`), `FakeClock`, `drive`                                      |
| `src/ports.ts`   | `ActorStore`, `FencedTx`, `Transport`, `MemoryPort`, `VersionResolver`, `SpendPort`, hooks |

## An agent

```ts
import { defineAgent, defineTool, grounded, noHumanClaim, s } from '@vendua/agent-runtime';

const quote = defineTool({
  name: 'quote',
  description: 'Prices the cart.',
  effect: 'read',
  input: s.object({}),
  run: async (ctx) => {
    const cents = await priceCart(ctx.tx, ctx.tenantId, ctx.subject.id); // a Core module
    ctx.figure('cart.total', { value: cents, text: brl(cents), kind: 'money' });
    return { content: 'Total no REGISTRO: {{cart.total}}' };
  },
});

export const seller = defineAgent({
  id: 'seller',
  subject: 'shopper_thread',
  lane: 'interactive',
  transport: 'whatsapp',
  models: { default: 'fast', escalate: [{ when: (s) => s.guardBlocks > 1, to: 'strong' }] },
  instructions: [{ id: 'base', tier: 'static', text: '…', priority: 100 }],
  tools: [quote],
  guards: { output: [grounded(), noHumanClaim] },
  mailbox: { quiet: { minMs: 2_500, maxMs: 20_000 }, preempt: true },
  budgets: { stepsPerTurn: 8, tokensPerTurn: 60_000 },
});
```

Replies go through the built-in `reply` tool; amounts, times and products are cited as `{{id}}`
and rendered from the ledger. The subject (tenant, conversation) comes from `ctx`, never from the
model's arguments.

## Testing

`bun test` runs the engine against the in-memory ports in milliseconds. The same contract runs
on Postgres in `packages/core/test/agent-runtime.test.ts`.
