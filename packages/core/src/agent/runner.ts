import type { Sql } from '../platform/db.ts';
import { log } from '../platform/log.ts';
import { controlTx } from '../modules/control.ts';
import { getIntegration, getPitch, getSetting } from '../modules/integrations.ts';
import { providerFor, type AgentMessage } from './llm.ts';
import { buildSystemPrompt } from './prompts.ts';
import { executeTool, toolsFor, type ToolContext } from './tools.ts';
import { dispatchMessage } from './send.ts';

const agentLog = log.child({ mod: 'agent' });

/**
 * agent/runner — the Hermes-style agent loop, CRM-sized: claim a queued run
 * (FOR UPDATE SKIP LOCKED — no double-runs across replicas), converge an
 * OpenAI-style tool loop, write the whole trajectory into agent_runs.steps.
 * Every step is a journal entry; a crashed run resumes as `failed` but its
 * steps are the audit trail.
 */

const MAX_STEPS = 12;
const HEARTBEAT_MS = 20_000;

interface RunRow {
  id: string;
  kind: 'triage' | 'reply' | 'outreach' | 'discovery';
  lead_id: string | null;
  thread_id: string | null;
  params: Record<string, unknown>;
  /** Minted at claim; every worker write is conditioned on it so a worker
   *  that loses its lease (reclaimed row) can't overwrite the new owner. */
  claim_token: string;
}

/** Transaction-local insert — call inside an existing tx (e.g. claimControl's)
 *  to atomically pair a run with another write. postgres.js transaction
 *  handles have no .begin(), so callers holding one must not use enqueueRun. */
export async function insertRun(
  tx: Sql,
  input: {
    kind: RunRow['kind'];
    leadId?: string | null;
    threadId?: string | null;
    params?: Record<string, unknown>;
  },
): Promise<string> {
  const row = (
    await tx<{ id: string }[]>`
      insert into agent_runs (kind, lead_id, thread_id, params)
      values (${input.kind}, ${input.leadId ?? null}, ${input.threadId ?? null}, ${tx.json((input.params ?? {}) as never)})
      returning id
    `
  )[0]!;
  return row.id;
}

export async function enqueueRun(
  sql: Sql,
  input: {
    kind: RunRow['kind'];
    leadId?: string | null;
    threadId?: string | null;
    params?: Record<string, unknown>;
  },
): Promise<string> {
  return controlTx(sql, (tx) => insertRun(tx, input));
}

async function claimRun(sql: Sql): Promise<RunRow | null> {
  return controlTx(sql, async (tx) => {
    const rows = await tx<RunRow[]>`
      update agent_runs set status = 'running', started_at = now(),
        claim_token = gen_random_uuid()::text
      where id = (
        select id from agent_runs
        where status = 'queued'
        order by created_at
        limit 1
        for update skip locked
      )
      returning id, kind, lead_id, thread_id, params, claim_token
    `;
    return rows[0] ?? null;
  });
}

async function finishRun(
  sql: Sql,
  run: { id: string; claimToken: string },
  result: {
    status: 'done' | 'failed' | 'canceled';
    steps: unknown[];
    tokensIn: number;
    tokensOut: number;
    costCents: number;
    error?: string;
  },
) {
  await controlTx(
    sql,
    (tx) => tx`
    update agent_runs set
      status = ${result.status},
      steps = ${tx.json(result.steps as never[])},
      tokens_in = ${result.tokensIn},
      tokens_out = ${result.tokensOut},
      cost_cents = ${result.costCents},
      error = ${result.error ?? null},
      finished_at = now()
    where id = ${run.id} and status = 'running' and claim_token = ${run.claimToken}
  `,
  );
}

async function contextFor(sql: Sql, run: RunRow): Promise<string> {
  const parts: string[] = [];
  if (run.lead_id) {
    const rows = await controlTx(
      sql,
      (tx) => tx`select row_to_json(l) as j from leads l where l.id = ${run.lead_id}`,
    );
    if (rows[0]) parts.push(`LEAD: ${JSON.stringify(rows[0].j)}`);
  }
  if (run.thread_id) {
    const rows = await controlTx(
      sql,
      (tx) => tx`
        select jsonb_build_object(
          'thread', row_to_json(t),
          'messages', (
            select coalesce(jsonb_agg(m order by m.created_at), '[]'::jsonb)
            from (select direction, body, status, author, created_at
                  from lead_messages where thread_id = ${run.thread_id}
                  order by created_at desc limit 12) m
          )
        ) as j
        from lead_threads t where t.id = ${run.thread_id}
      `,
    );
    if (rows[0]) parts.push(`THREAD: ${JSON.stringify(rows[0].j)}`);
  }
  if (run.kind === 'outreach' && run.params.focus) {
    parts.push(`FOCUS: ${String(run.params.focus)}`);
  }
  if (run.kind === 'discovery' && run.params.query) {
    parts.push(`DISCOVERY QUERY: ${String(run.params.query)}`);
    if (run.params.segment) parts.push(`SEGMENT: ${String(run.params.segment)}`);
    if (run.params.city) parts.push(`CITY: ${String(run.params.city)}`);
  }
  return parts.join('\n\n') || '(no extra context)';
}

export async function runOnce(sql: Sql): Promise<boolean> {
  const run = await claimRun(sql);
  if (!run) return false;
  const claim = { id: run.id, claimToken: run.claim_token };

  const steps: unknown[] = [];
  const messages: AgentMessage[] = [];
  let tokensIn = 0;
  let tokensOut = 0;
  // accumulate fractional dollars — rounding to cents per step would zero out
  // sub-cent calls and skew the run total.
  let costUsd = 0;
  // Set when the row stops matching this execution: canceled via the API, or
  // reclaimed and re-queued after going stale. The loop unwinds at the next
  // boundary — in-flight tool calls finish but nothing else is persisted or
  // sent.
  let lost = false;

  /** Streaming journal: every write commits the steps so far — staff watch
   *  the trajectory live instead of a silent 'running' chip — AND refreshes
   *  started_at, which doubles as the reclaim lease in drain(). Fenced by
   *  claim_token: a stale worker's write no-ops once a new claim owns the
   *  row. Writes serialize on `tail` and each snapshots [...steps, ...extra]
   *  when its turn begins, so parallel tool resolutions can only advance the
   *  journal — a delayed write never re-commits an older pending state. */
  let tail: Promise<void> = Promise.resolve();
  const persist = (extra: unknown[] = []): Promise<void> => {
    const p = tail.then(async () => {
      if (lost) return;
      const rows = await controlTx(
        sql,
        (tx) => tx`
          update agent_runs set started_at = now(), steps = ${tx.json([...steps, ...extra] as never[])}
          where id = ${run.id} and status = 'running' and claim_token = ${run.claim_token}
          returning id
        `,
      );
      if (!rows.length) lost = true;
    });
    tail = p.catch(() => undefined);
    return p;
  };

  /** Journal write for an aborted run — the trajectory up to cancellation is
   *  still the audit trail, so keep it when the cancel endpoint flipped the
   *  row mid-flight. Fenced by claim_token like every other write: a stale
   *  worker can't overwrite the newer execution's journal. */
  const persistAborted = async (): Promise<void> => {
    await tail.catch(() => undefined);
    await controlTx(
      sql,
      (tx) => tx`
        update agent_runs set steps = ${tx.json(steps as never[])}, finished_at = now()
        where id = ${run.id} and status = 'canceled' and claim_token = ${run.claim_token}
      `,
    ).catch(() => undefined);
  };

  // A single tool/model call can outlive the 10-min lease on its own — the
  // timer keeps started_at fresh through it, so reclaim means a dead worker,
  // never a live one stuck inside a slow provider call.
  const heartbeat = setInterval(() => {
    void controlTx(
      sql,
      (tx) => tx`
        update agent_runs set started_at = now()
        where id = ${run.id} and status = 'running' and claim_token = ${run.claim_token}
      `,
    ).catch(() => undefined);
  }, HEARTBEAT_MS);
  heartbeat.unref?.();

  try {
    const integration = await getIntegration(sql, 'llm');
    const provider = providerFor(integration, run.params);
    const pitch = await getPitch(sql);
    const memory = await getSetting<{ facts: string[] }>(sql, 'agent_memory', { facts: [] });
    const system = buildSystemPrompt(run.kind, pitch, memory);
    const context = await contextFor(sql, run);
    const tools = toolsFor(run.kind);
    const ctx: ToolContext = {
      sql,
      runId: run.id,
      runKind: run.kind,
      leadId: run.lead_id,
      threadId: run.thread_id,
      step: 0,
    };

    steps.push({ type: 'system_prompt', content: system });
    messages.push({ role: 'user', content: context });
    await persist();

    for (let i = 0; i < MAX_STEPS && !lost; i++) {
      const res = await provider.chat({ system, messages, tools });
      tokensIn += res.tokensIn;
      tokensOut += res.tokensOut;
      if (res.costUsd != null) costUsd += res.costUsd;
      steps.push({ type: 'model', content: res.text, toolCalls: res.toolCalls.map((t) => t.name) });
      await persist();
      if (lost) break;

      if (!res.toolCalls.length) {
        await finishRun(sql, claim, {
          status: 'done',
          steps,
          tokensIn,
          tokensOut,
          costCents: Math.round(costUsd * 100),
        });
        return true;
      }

      messages.push({
        role: 'assistant',
        content: res.text ?? '',
        toolCalls: res.toolCalls,
      });
      ctx.step = i;

      if (run.kind === 'discovery') {
        // Discovery tools are remote reads or idempotent inserts — a step's
        // calls run in parallel (one provider automation per call would make
        // a single iteration take minutes).
        const batch: unknown[] = res.toolCalls.map((call) => ({
          type: 'tool',
          name: call.name,
          args: call.args,
          pending: true,
        }));
        const toolMsgs: AgentMessage[] = new Array(res.toolCalls.length);
        await persist(batch);
        await Promise.all(
          res.toolCalls.map(async (call, callIndex) => {
            let out: unknown;
            try {
              out = await executeTool(ctx, call.id ?? String(callIndex), call.name, call.args);
            } catch (e) {
              out = { error: e instanceof Error ? e.message : String(e) };
            }
            batch[callIndex] = { type: 'tool', name: call.name, args: call.args, out };
            toolMsgs[callIndex] = {
              role: 'tool',
              toolCallId: call.id,
              name: call.name,
              content: JSON.stringify(out),
            };
            await persist(batch);
          }),
        );
        steps.push(...batch);
        messages.push(...toolMsgs);
      } else {
        // Messaging kinds stay sequential: tool calls in one response may
        // depend on each other's ordering (draft before send).
        for (const [callIndex, call] of res.toolCalls.entries()) {
          let out: unknown;
          try {
            out = await executeTool(ctx, call.id ?? String(callIndex), call.name, call.args);
          } catch (e) {
            out = { error: e instanceof Error ? e.message : String(e) };
          }
          steps.push({ type: 'tool', name: call.name, args: call.args, out });
          messages.push({
            role: 'tool',
            toolCallId: call.id,
            name: call.name,
            content: JSON.stringify(out),
          });
          await persist();
          if (lost) break;
        }
      }
    }
    if (lost) {
      await persistAborted();
      return true;
    }
    await finishRun(sql, claim, {
      // step exhaustion is a failure — the model never converged on an answer
      status: 'failed',
      steps,
      tokensIn,
      tokensOut,
      costCents: Math.round(costUsd * 100),
      error: 'max steps reached',
    });
    return true;
  } catch (e) {
    await finishRun(sql, claim, {
      status: 'failed',
      steps,
      tokensIn,
      tokensOut,
      costCents: Math.round(costUsd * 100),
      error: e instanceof Error ? e.message : String(e),
    });
    return true;
  } finally {
    clearInterval(heartbeat);
  }
}

/** Drain the queue — called by the worker loop and after enqueues. First
 *  reclaims runs whose worker died mid-flight (crash/restart leaves them
 *  'running' forever): past the lease they're requeued, not failed, so a
 *  crashed outreach still reaches the lead. */
const RUN_LEASE_MIN = 10;

export async function drain(sql: Sql, limit = 20): Promise<number> {
  await controlTx(
    sql,
    (tx) => tx`
      update agent_runs set status = 'queued', started_at = null, claim_token = null
      where status = 'running' and started_at < now() - make_interval(mins => ${RUN_LEASE_MIN})
    `,
  );
  // 'sending' past the lease = worker died between provider call and status
  // write. Fail it visibly — staff redrafts — instead of silently requeuing
  // (at-most-once: the provider may already have accepted it).
  await controlTx(
    sql,
    (tx) => tx`
      update lead_messages set status = 'failed', error = 'dispatch-interrupted', updated_at = now()
      where status = 'sending' and updated_at < now() - make_interval(mins => ${RUN_LEASE_MIN})
    `,
  );
  // Queued messages outlive the request that queued them — a crash between
  // approve/commit and dispatch must not strand one. The 20s grace lets the
  // inline request-path dispatch win first.
  const stranded = await controlTx(
    sql,
    (tx) =>
      tx<{ id: string }[]>`
        select id from lead_messages
        where status = 'queued' and created_at < now() - interval '20 seconds'
        order by created_at limit 10
      `,
  );
  for (const m of stranded) {
    await dispatchMessage(sql, m.id).catch((e) =>
      agentLog.error({ err: e, messageId: m.id }, 'dispatch failed'),
    );
  }
  let ran = 0;
  while (ran < limit && (await runOnce(sql))) ran++;
  return ran;
}

let workerTimer: ReturnType<typeof setInterval> | null = null;
let draining = false;

/** Persistent in-process worker: polls the durable queue, plus the periodic
 *  outreach sweep. Queue lives in Postgres, so queued runs survive reboots. */
export function startAgentWorker(sql: Sql, intervalMs = 15_000) {
  if (workerTimer) return;
  workerTimer = setInterval(() => {
    if (draining) return;
    draining = true;
    void drain(sql)
      .then(() => sweepOutreach(sql))
      .catch((e) => agentLog.error({ err: e }, 'worker failed'))
      .finally(() => {
        draining = false;
      });
  }, intervalMs);
  workerTimer.unref?.();
}

/** Periodic sweep: leads due for a follow-up get an outreach run. */
export async function sweepOutreach(sql: Sql): Promise<number> {
  return controlTx(sql, async (tx) => {
    // for update skip locked — concurrent sweeps on different replicas take
    // disjoint lead sets instead of both inserting a run for the same due
    // lead (the not-exists check alone only sees committed runs).
    const due = await tx<{ id: string }[]>`
      select l.id from leads l
      where l.next_action_at is not null and l.next_action_at <= now()
        and l.archived_at is null and l.unsubscribed_at is null
        and l.agent_mode != 'off'
        and not exists (
          select 1 from agent_runs r
          where r.lead_id = l.id and r.kind = 'outreach'
            and r.status in ('queued', 'running')
        )
      limit 20
      for update skip locked
    `;
    for (const { id } of due) {
      await tx`
        insert into agent_runs (kind, lead_id, params)
        values ('outreach', ${id}, '{}'::jsonb)
      `;
      await tx`update leads set next_action_at = null where id = ${id}`;
    }
    return due.length;
  });
}
