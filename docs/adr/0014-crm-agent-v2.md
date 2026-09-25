# ADR 0014 — CRM agent v2 (playbooks, autonomy policy, wakeups, memory v2)

Status: accepted (implementation in progress on `staging`)

## Context

The CRM agent (packages/core/src/agent) is reliable but not autonomous: code
decides every run, behaviour is split across prompts.ts / runner.ts / tools.ts,
permission to act is spread over ~8 flags, and memory is a flat list of 100
strings that discovery debriefs evict. See the review in the session report.

## Decision

1. **Tool registry v2** — one module per tool under `agent/tools/`, each
   declaring metadata (`effect: read | write | mint | send`, `leadBound`,
   `remote`, `playbooks`). ACTION/READ/NON_IDEMPOTENT sets are derived from it.
2. **Playbooks** — each run kind is a `Playbook` object (tools, step budget,
   default monid cap, finish gates, parallel tool execution, debrief). Staff
   overrides live in the `agent_playbooks` setting (contract below).
3. **Autonomy policy** — `agent/policy.ts` is the single place that answers
   "may the agent act on this lead, and may it send without approval", with
   human-readable reasons. Workspace preset lives in `agent_autonomy`.
4. **Wakeups** — `agent_wakeups` table + `schedule` tool: the agent books its
   own future runs with an explicit focus; the sweep materializes them through
   `insertRun` (cost cap and suppression gates unchanged).
5. **Memory v2** — `agent_memory_items` (workspace learnings, segment
   learnings, discovery debriefs) and `lead_facts` (structured per-lead facts).
   Debriefs have their own cap and never evict learnings.
6. **Evaluation** — deterministic scripted-provider tests run in CI. The live
   LLM harness (`bun run sim`) stays manual and is never wired into CI.

Critical paths (runner kernel, send/claim gates, tool dispatcher, wakeup
materialization) are implemented by the parent session; UI, memory storage,
metrics and scripted evals are delegated.

## Contracts (shared by all v2 PRs — do not change without updating this file)

All routes are under the existing control auth (`/control/v1/...`), mutating
routes require `Idempotency-Key` exactly like the neighbouring routes.
JSON is camelCase.

### Setting `agent_playbooks` (validated in `validateSetting`)

```ts
type PlaybookKind = 'triage' | 'reply' | 'outreach' | 'discovery' | 'strategist';
type PlaybookOverride = {
  enabled?: boolean; // false → insertRun refuses new runs of this kind
  stepBudget?: number; // integer 1..60
  model?: string | null; // provider model id; null/absent = workspace llm default
  instructions?: string; // ≤ 4000 chars, appended to the system prompt
  monidCapUsd?: number; // 0..5, default paid-enrichment cap for the kind
};
type AgentPlaybooksSetting = Partial<Record<PlaybookKind, PlaybookOverride>>;
```

Read-only defaults: `GET /control/v1/agent/playbooks` →
`{ playbooks: { kind, label, description, defaults: { stepBudget, monidCapUsd },
tools: string[], override: PlaybookOverride }[] }` (parent implements).

### Setting `agent_autonomy`

```ts
type AutonomyLevel = 'off' | 'copilot' | 'supervised' | 'autopilot';
// off        — agent never runs automatically (staff-triggered runs only)
// copilot    — agent runs, every outbound is a draft for approval
// supervised — first contact drafts, follow-ups/replies send (today's default)
// autopilot  — sends without approval (all send guardrails still apply)
type AgentAutonomySetting = {
  level: AutonomyLevel;
  // strategist may enable its own proposed discovery briefs while the
  // trailing-7-day discovery spend stays under this cap. 0 = never.
  strategistAutoApproveUsd?: number; // 0..50
};
```

Lead explanation: `GET /control/v1/leads/:id/autonomy` →

```ts
{
  level: AutonomyLevel; // workspace level after lead overrides
  canRun: boolean; // automatic runs allowed right now
  sendMode: 'auto' | 'draft' | 'blocked';
  reasons: {
    code: string;
    message: string;
  }
  [];
} // ordered, first = decisive
```

(parent implements)

### Wakeups (parent implements table, sweep, `schedule` tool)

`GET /control/v1/agent/wakeups?leadId=&status=pending|fired|canceled&limit=`
→ `{ wakeups: Wakeup[] }`
`POST /control/v1/agent/wakeups/:id/cancel` → `{ wakeup: Wakeup }`

```ts
type Wakeup = {
  id: string;
  leadId: string | null;
  leadName: string | null;
  kind: PlaybookKind;
  at: string /* ISO */;
  focus: string;
  status: 'pending' | 'fired' | 'canceled';
  createdBy: 'agent' | 'staff';
  createdByRunId: string | null;
  firedRunId: string | null;
  createdAt: string;
};
```

### Memory v2 (delegated backend)

`GET /control/v1/agent/memory?scope=workspace|segment|debrief&segment=`
→ `{ items: MemoryItem[] }`
`POST /control/v1/agent/memory` body `{ scope, segment?, content }` → `{ item }`
`PATCH /control/v1/agent/memory/:id` body `{ content?, pinned? }` → `{ item }`
`DELETE /control/v1/agent/memory/:id` → `{ ok: true }`

```ts
type MemoryItem = {
  id: string;
  scope: 'workspace' | 'segment' | 'debrief';
  segment: string | null;
  content: string /* ≤500 */;
  pinned: boolean;
  source: 'agent' | 'staff' | 'debrief';
  sourceRunId: string | null;
  uses: number;
  createdAt: string;
  updatedAt: string;
};
```

`GET /control/v1/leads/:id/facts` → `{ facts: LeadFact[] }`
`PUT /control/v1/leads/:id/facts/:key` body `{ value, confidence? }` → `{ fact }`
`DELETE /control/v1/leads/:id/facts/:key` → `{ ok: true }`

```ts
type LeadFact = {
  key: string /* snake_case ≤60 */;
  value: string /* ≤500 */;
  confidence: number /* 0..1 */;
  source: 'agent' | 'staff';
  sourceRunId: string | null;
  updatedAt: string;
};
```

Core module `modules/agent-memory.ts` exports (consumed by the runner/tools):
`memoryForRunTx(tx, { segment?: string | null; limit?: number }) → Promise<string[]>`,
`rememberTx(tx, { scope, segment?, content, source, sourceRunId? })`,
`appendDebriefTx(tx, { content, sourceRunId })`,
`leadFactsTx(tx, leadId) → Promise<LeadFact[]>`,
`upsertLeadFactTx(tx, leadId, { key, value, confidence?, source, sourceRunId? })`.

### Metrics (delegated)

`GET /control/v1/agent/metrics?days=7|30` →

```ts
{ window: { from: string; to: string };
  byKind: { kind: PlaybookKind; runs: number; done: number; failed: number;
            canceled: number; actedRate: number; avgSteps: number;
            costUsd: number; avgCostUsd: number }[];
  outbound: { sent: number; drafted: number; approved: number; rejected: number };
  replies: { leadsContacted: number; leadsReplied: number; replyRate: number };
  wakeups: { pending: number; fired: number } | null; }
```

## Evaluation

Two harnesses, two budgets:

- **Scripted evals — CI, free.** `packages/core/src/agent/scripted-provider.ts`
  replays a fixed script of turns (text + toolCalls) through the real
  pipeline — `ingestInbound → drain → runOnce → tools → dispatch` on the
  `log` channel drivers — and records every request it received, so a test
  asserts both what the model "said" did in the DB and what the runner fed
  back. Golden scenarios live in `packages/core/test/agent-evals.test.ts`
  (send lands, firstContactDraftOnly forces a draft, unsubscribe suppresses,
  loop guard, finish gate, cost cap). No network, no keys, no tokens —
  `bun test` covers them.
- **Sim — manual, paid.** `bun run sim` drives the same pipeline through a
  real provider (Gemini) to judge end-to-end quality. It is never invoked
  by a workflow or test — run it locally when you want model behaviour on
  the record, not in CI.
