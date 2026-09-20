import type { Sql } from '../platform/db.ts';
import { log } from '../platform/log.ts';
import { controlTx } from '../modules/control.ts';
import {
  getIntegration,
  getPitch,
  getSetting,
  DEFAULT_GUARDRAILS,
  type Guardrails,
} from '../modules/integrations.ts';
import { segmentStats, type AgentGoal } from '../modules/leads.ts';
import { providerFor, type AgentMessage } from './llm.ts';
import { buildSystemPrompt } from './prompts.ts';
import { executeTool, toolsFor, type ToolContext } from './tools.ts';
import { dispatchMessage } from './send.ts';
import { channelAvailabilityTx, whatsappReadyTx } from './guardrails.ts';

const agentLog = log.child({ mod: 'agent' });

/**
 * agent/runner — the Hermes-style agent loop, CRM-sized: claim a queued run
 * (FOR UPDATE SKIP LOCKED — no double-runs across replicas), converge an
 * OpenAI-style tool loop, write the whole trajectory into agent_runs.steps.
 * Every step is a journal entry; a crashed run resumes as `failed` but its
 * steps are the audit trail.
 */

/** Model-call budget per run kind — each iteration can fan out into parallel
 *  tool calls, so discovery (search → batch extract → create) legitimately
 *  needs more headroom than a reply. */
const STEP_BUDGET: Record<RunRow['kind'], number> = {
  triage: 12,
  reply: 14,
  outreach: 12,
  // Research-per-lead discovery: flavors fan-out → page reads per prospect
  // → dossier'd create. A step fans out into parallel calls, so this is
  // model turns, not tool calls.
  discovery: 30,
};
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
      update agent_runs set status = 'running', started_at = now(), alive_at = now(),
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

async function contextFor(
  sql: Sql,
  run: RunRow,
): Promise<{ text: string; goal: AgentGoal; bookingUrl: string | null }> {
  const parts: string[] = [];
  let goal: AgentGoal = 'negotiation';
  let bookingUrl: string | null = null;
  if (run.lead_id) {
    const rows = await controlTx(
      sql,
      (tx) =>
        tx<
          { j: { agent_goal?: AgentGoal } & Record<string, unknown> }[]
        >`select row_to_json(l) as j from leads l where l.id = ${run.lead_id}`,
    );
    if (rows[0]) {
      parts.push(`LEAD: ${JSON.stringify(rows[0].j)}`);
      goal = rows[0].j.agent_goal === 'meeting' ? 'meeting' : 'negotiation';
      // Run params can override the lead's standing goal for a one-off run —
      // dispatch writes agent_goal; ad-hoc callers may pass params.goal only.
      if (run.params.goal === 'meeting' || run.params.goal === 'negotiation') {
        goal = run.params.goal;
      }
      if (run.kind === 'triage' || run.kind === 'reply' || run.kind === 'outreach') {
        parts.push(`GOAL: ${goal}`);
        if (goal === 'meeting') {
          const meeting = await getSetting<{ bookingUrl?: string }>(sql, 'meeting', {});
          bookingUrl = meeting.bookingUrl ?? null;
          parts.push(`BOOKING_URL: ${bookingUrl ?? '(não configurado)'}`);
        }
        // Ground truth on reachable channels — the model must not compose on
        // a channel the lead can't be reached on (the classic bug: draft on
        // whatsapp when the lead has no number or the driver is off).
        const avail = await controlTx(sql, (tx) => channelAvailabilityTx(tx, run.lead_id!));
        const chanLine = (['whatsapp', 'email'] as const)
          .map((ch) => `${ch} ${avail[ch].ok ? 'ok' : `indisponível (${avail[ch].reason})`}`)
          .join(' · ');
        parts.push(`CANAIS: ${chanLine}`);
        const want = run.params.channel;
        if (want === 'whatsapp' || want === 'email') {
          parts.push(`CANAL FORÇADO (staff escolheu): ${want}`);
        }
      }
    }
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
    // Caller-chosen lead goal — the prompt turns it into the stop condition;
    // the guardrail cap still bounds it from above.
    const target = Number(run.params.target);
    if (Number.isFinite(target) && target > 0) {
      parts.push(`META: criar até ${Math.floor(target)} leads`);
    }
    if (run.params.briefName) {
      parts.push(`BRIEF: ${String(run.params.briefName)}`);
    }
    // What already converts — the learning loop. Discovery should lean toward
    // segments that reply, not just the brief's default.
    const stats = await segmentStats(sql);
    if (stats.length) {
      parts.push(
        `SEGMENTOS (leads · responderam · ativos · custo):\n${stats
          .map(
            (s) =>
              `- ${s.segment}: ${s.leads} leads · ${s.replied} responderam · ${s.live} ativos · R$${(s.costCents / 100).toFixed(2)}`,
          )
          .join('\n')}`,
      );
    }
  }
  return { text: parts.join('\n\n') || '(no extra context)', goal, bookingUrl };
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
   *  alive_at, the reclaim lease in drain() (started_at stays the real
   *  attempt-start timestamp — UIs read it for elapsed time). Fenced by
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
          update agent_runs set alive_at = now(), steps = ${tx.json([...steps, ...extra] as never[])}
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
  // timer keeps alive_at fresh through it, so reclaim means a dead worker,
  // never a live one stuck inside a slow provider call.
  const heartbeat = setInterval(() => {
    void controlTx(
      sql,
      (tx) => tx`
        update agent_runs set alive_at = now()
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
    const { text: context, goal, bookingUrl } = await contextFor(sql, run);
    const g = await getSetting<Partial<Guardrails>>(sql, 'guardrails', {});
    // The prompt only promises autocontact when it can actually happen —
    // the same conditions create_lead's gate checks (enabled + reachable).
    const waDriverOn = run.kind === 'discovery' && (await whatsappReadyTx(sql));
    const system = buildSystemPrompt(run.kind, pitch, memory, {
      goal,
      bookingUrl,
      autoContact: {
        enabled: (g.discoveryAutoContact ?? DEFAULT_GUARDRAILS.discoveryAutoContact) && waDriverOn,
        minScore: g.discoveryContactMinScore ?? DEFAULT_GUARDRAILS.discoveryContactMinScore,
      },
    });
    const tools = toolsFor(run.kind);
    const ctx: ToolContext = {
      sql,
      runId: run.id,
      runKind: run.kind,
      leadId: run.lead_id,
      threadId: run.thread_id,
      step: 0,
      briefName: typeof run.params.briefName === 'string' ? run.params.briefName : null,
      channelOverride:
        run.params.channel === 'whatsapp' || run.params.channel === 'email'
          ? run.params.channel
          : null,
      pageCache: new Map(),
    };

    steps.push({ type: 'system_prompt', content: system });
    messages.push({ role: 'user', content: context });
    await persist();

    for (let i = 0; i < STEP_BUDGET[run.kind] && !lost; i++) {
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
    // Step exhaustion is a failure — the model never converged. For
    // discovery the trajectory still reports what it produced: the create
    // count keeps a lead-yielding run from reading as a dead loss.
    const created = steps.filter(
      (s) =>
        typeof s === 'object' &&
        s !== null &&
        (s as { name?: string }).name === 'create_lead' &&
        typeof (s as { out?: { lead?: { id?: string } } }).out?.lead?.id === 'string',
    ).length;
    await finishRun(sql, claim, {
      status: 'failed',
      steps,
      tokensIn,
      tokensOut,
      costCents: Math.round(costUsd * 100),
      error: `max steps reached${created ? ` — ${created} lead(s) created` : ''}`,
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
      update agent_runs set status = 'queued', started_at = null, alive_at = null, claim_token = null
      where status = 'running' and coalesce(alive_at, started_at) < now() - make_interval(mins => ${RUN_LEASE_MIN})
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
      .then(() => sweepBriefs(sql))
      .catch((e) => agentLog.error({ err: e }, 'worker failed'))
      .finally(() => {
        draining = false;
      });
  }, intervalMs);
  workerTimer.unref?.();
}

/** Scheduled discovery: each enabled brief past its 23h cadence gets a
 *  discovery run carrying its query/segment/city/target + briefId (the
 *  not-exists check keeps a still-queued brief run from double-firing). Leads
 *  it creates land tagged 'descoberto' — contact dispatch stays manual. */
export async function sweepBriefs(sql: Sql): Promise<number> {
  return controlTx(sql, async (tx) => {
    const due = await tx<
      {
        id: string;
        name: string;
        query: string;
        segment: string | null;
        city: string | null;
        target: number | null;
      }[]
    >`
      select id, name, query, segment, city, target from discovery_briefs
      where enabled
        and (last_run_at is null or last_run_at < now() - interval '23 hours')
        and not exists (
          select 1 from agent_runs r
          where r.kind = 'discovery' and r.status in ('queued', 'running')
            and r.params->>'briefId' = discovery_briefs.id::text
        )
      limit 10
      for update of discovery_briefs skip locked
    `;
    for (const b of due) {
      await insertRun(tx, {
        kind: 'discovery',
        params: {
          query: b.query,
          ...(b.segment ? { segment: b.segment } : {}),
          ...(b.city ? { city: b.city } : {}),
          ...(b.target ? { target: b.target } : {}),
          briefId: b.id,
          briefName: b.name,
        },
      });
      await tx`update discovery_briefs set last_run_at = now() where id = ${b.id}`;
    }
    return due.length;
  });
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
