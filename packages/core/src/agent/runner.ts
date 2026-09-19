import type { Sql } from '../platform/db.ts';
import { controlTx } from '../modules/control.ts';
import { getIntegration, getPitch, getSetting } from '../modules/integrations.ts';
import { providerFor, type AgentMessage } from './llm.ts';
import { buildSystemPrompt } from './prompts.ts';
import { executeTool, toolsFor, type ToolContext } from './tools.ts';

/**
 * agent/runner — the Hermes-style agent loop, CRM-sized: claim a queued run
 * (FOR UPDATE SKIP LOCKED — no double-runs across replicas), converge an
 * OpenAI-style tool loop, write the whole trajectory into agent_runs.steps.
 * Every step is a journal entry; a crashed run resumes as `failed` but its
 * steps are the audit trail.
 */

const MAX_STEPS = 12;

interface RunRow {
  id: string;
  kind: 'triage' | 'reply' | 'outreach' | 'discovery';
  lead_id: string | null;
  thread_id: string | null;
  params: Record<string, unknown>;
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
  return controlTx(sql, async (tx) => {
    const row = (
      await tx<{ id: string }[]>`
        insert into agent_runs (kind, lead_id, thread_id, params)
        values (${input.kind}, ${input.leadId ?? null}, ${input.threadId ?? null}, ${tx.json((input.params ?? {}) as never)})
        returning id
      `
    )[0]!;
    return row.id;
  });
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

  const steps: unknown[] = [{ type: 'system_prompt', content: system }];
  const messages: AgentMessage[] = [{ role: 'user', content: context }];
  let tokensIn = 0;
  let tokensOut = 0;
  let costCents = 0;

  try {
    for (let i = 0; i < MAX_STEPS; i++) {
      const res = await provider.chat({ system, messages, tools });
      tokensIn += res.tokensIn;
      tokensOut += res.tokensOut;
      if (res.costUsd != null) costCents += Math.round(res.costUsd * 100);
      steps.push({ type: 'model', content: res.text, toolCalls: res.toolCalls.map((t) => t.name) });

      if (!res.toolCalls.length) {
        await finishRun(sql, run.id, {
          status: 'done',
          steps,
          tokensIn,
          tokensOut,
          costCents,
        });
        return true;
      }

      messages.push({
        role: 'assistant',
        content: res.text ?? '',
        toolCalls: res.toolCalls,
      });

      for (const call of res.toolCalls) {
        ctx.step = i;
        let out: unknown;
        try {
          out = await executeTool(ctx, call.name, call.args);
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
      status: 'done',
      steps,
      tokensIn,
      tokensOut,
      costCents,
      error: 'max steps reached',
    });
    return true;
  } catch (e) {
    await finishRun(sql, run.id, {
      status: 'failed',
      steps,
      tokensIn,
      tokensOut,
      costCents,
      error: e instanceof Error ? e.message : String(e),
    });
    return true;
  }
}

/** Drain the queue — called by the worker loop and after enqueues. */
export async function drain(sql: Sql, limit = 20): Promise<number> {
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
