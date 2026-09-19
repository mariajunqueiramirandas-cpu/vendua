import type { Sql } from '../platform/db.ts';
import { controlTx } from '../modules/control.ts';
import {
  DEFAULT_GUARDRAILS,
  getGuardrails,
  getIntegration,
  getPitch,
  getSetting,
} from '../modules/integrations.ts';
import type { Guardrails } from '../modules/integrations.ts';
import { providerFor, type AgentMessage } from './llm.ts';
import { buildSystemPrompt } from './prompts.ts';
import { executeTool, toolsFor, type ToolContext } from './tools.ts';
import { dispatchMessage } from './send.ts';

/**
 * agent/runner — the Hermes-style agent loop, CRM-sized: claim a queued run
 * (FOR UPDATE SKIP LOCKED — no double-runs across replicas), converge an
 * OpenAI-style tool loop, write the whole trajectory into agent_runs.steps.
 * Every step is a journal entry; a crashed run resumes as `failed` but its
 * steps are the audit trail.
 */

/** Step cap for the tool loop: run params override guardrails, guardrails
 *  fall back to the default. 0 (or negative) = uncapped — the loop runs until
 *  the model stops calling tools, and this cap is the only runaway bound.
 *  Returns Infinity for the uncapped case so the loop condition stays `i <`. */
export function resolveMaxSteps(params: Record<string, unknown>, guardrails: Guardrails): number {
  const fromParams = params.maxSteps;
  const n =
    typeof fromParams === 'number' && Number.isFinite(fromParams)
      ? fromParams
      : typeof guardrails.maxSteps === 'number' && Number.isFinite(guardrails.maxSteps)
        ? guardrails.maxSteps
        : DEFAULT_GUARDRAILS.maxSteps;
  return n > 0 ? n : Number.POSITIVE_INFINITY;
}

interface RunRow {
  id: string;
  kind: 'triage' | 'reply' | 'outreach' | 'discovery';
  lead_id: string | null;
  thread_id: string | null;
  params: Record<string, unknown>;
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
      update agent_runs set status = 'running', started_at = now()
      where id = (
        select id from agent_runs
        where status = 'queued'
        order by created_at
        limit 1
        for update skip locked
      )
      returning id, kind, lead_id, thread_id, params
    `;
    return rows[0] ?? null;
  });
}

async function finishRun(
  sql: Sql,
  runId: string,
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
    where id = ${runId}
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

  const steps: unknown[] = [];
  const messages: AgentMessage[] = [];
  let tokensIn = 0;
  let tokensOut = 0;
  // accumulate fractional dollars — rounding to cents per step would zero out
  // sub-cent calls and skew the run total.
  let costUsd = 0;

  try {
    const integration = await getIntegration(sql, 'llm');
    const provider = providerFor(integration, run.params);
    const pitch = await getPitch(sql);
    const memory = await getSetting<{ facts: string[] }>(sql, 'agent_memory', { facts: [] });
    const guardrails = await getGuardrails(sql);
    const maxSteps = resolveMaxSteps(run.params, guardrails);
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

    for (let i = 0; i < maxSteps; i++) {
      // Heartbeat: `started_at` doubles as the reclaim lease in drain() —
      // refreshing it every step means only a genuinely wedged run (no step in
      // 10 min) gets requeued, never a live one mid-flight.
      await controlTx(
        sql,
        (tx) => tx`update agent_runs set started_at = now() where id = ${run.id}`,
      );
      const res = await provider.chat({ system, messages, tools });
      tokensIn += res.tokensIn;
      tokensOut += res.tokensOut;
      if (res.costUsd != null) costUsd += res.costUsd;
      steps.push({ type: 'model', content: res.text, toolCalls: res.toolCalls.map((t) => t.name) });

      if (!res.toolCalls.length) {
        await finishRun(sql, run.id, {
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

      for (const [callIndex, call] of res.toolCalls.entries()) {
        ctx.step = i;
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
      }
    }
    await finishRun(sql, run.id, {
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
    await finishRun(sql, run.id, {
      status: 'failed',
      steps,
      tokensIn,
      tokensOut,
      costCents: Math.round(costUsd * 100),
      error: e instanceof Error ? e.message : String(e),
    });
    return true;
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
      update agent_runs set status = 'queued', started_at = null
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
      console.error('[agent drain] dispatch failed', m.id, e),
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
      .catch((e) => console.error('[agent worker]', e))
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
