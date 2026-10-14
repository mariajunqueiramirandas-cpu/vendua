import type { Sql } from '../platform/db.ts';
import { HttpError, UUID_RE } from '../platform/http.ts';
import { PLATFORM_TENANT_ID } from '../platform/tenancy.ts';
import { controlTx } from '../modules/control.ts';
import { CRM_AGENTS } from './turns.ts';

// The CRM's activity list on Runtime v3 (ADR 0030 steps 2–4), in the shape its screens already
// read: a "run" is a finished turn (crm_turns), a turn in progress, or a mailbox row still
// waiting (queued, or scheduled for later). A finished run's trajectory is its turn's events.

/** A mailbox kind as the job the screens speak (crm/dispatch.ts `jobOf`, in SQL). */
const KIND_OF = `case m.kind
    when 'message.inbound' then 'reply'
    when 'timer.daily' then 'discovery'
    when 'timer.weekly' then 'strategist'
    when 'staff.request' then coalesce(nullif(m.payload->>'kind', ''), 'outreach')
    else 'outreach' end`;
const LEAD_OF = `case when a.subject_kind = 'lead' then a.subject_id::uuid end`;
const CRM_MAIL = `a.tenant_id = '${PLATFORM_TENANT_ID}'::uuid
    and a.agent_id in (${CRM_AGENTS.map((x) => `'${x}'`).join(', ')})
    and m.kind not like 'runtime.%'`;

const RUNS = `
  select t.turn_id as id, t.kind, t.status, t.lead_id, t.params->>'threadId' as thread_id,
    t.tokens_in, t.tokens_out, t.cost_cents, t.error, t.started_at as created_at,
    t.started_at, t.finished_at, null::timestamptz as run_at, t.source, false as promised,
    t.params
  from crm_turns t
  union all
  select distinct on (m.consumed_by_turn) m.consumed_by_turn, ${KIND_OF}, 'running', ${LEAD_OF},
    m.payload->>'threadId', 0, 0, 0, null, m.created_at, m.deliver_at, null, null, m.source,
    false, m.payload
  from agent_mailbox m join agent_actors a on a.id = m.actor_id
  where ${CRM_MAIL} and m.consumed_by_turn is not null
    and m.deliver_at > now() - interval '1 day'
    and not exists (select 1 from crm_turns x where x.turn_id = m.consumed_by_turn)
  union all
  select m.id, ${KIND_OF}, 'queued', ${LEAD_OF}, m.payload->>'threadId', 0, 0, 0, null,
    m.created_at, null, null, case when m.deliver_at > now() then m.deliver_at end, m.source,
    -- a promise to the lead or a staff ask: the preset never holds it back
    m.kind in ('timer.callback', 'staff.request', 'staff.regenerate'), m.payload
  from agent_mailbox m join agent_actors a on a.id = m.actor_id
  where ${CRM_MAIL} and m.consumed_by_turn is null`;

const TS_RE = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})(?:\.\d+)?[+-](\d{2})$/;

// calendar sanity too: a loose regex passes values that 500 the timestamptz cast
function tsOk(ts: string): boolean {
  const m = TS_RE.exec(ts);
  if (!m) return false;
  const [y, mo, d, h, mi, s, oh] = m.slice(1).map(Number) as [
    number,
    number,
    number,
    number,
    number,
    number,
    number,
  ];
  const feb = y % 4 === 0 && (y % 100 !== 0 || y % 400 === 0) ? 29 : 28;
  const days = [31, feb, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return (
    mo >= 1 &&
    mo <= 12 &&
    d >= 1 &&
    d <= days[mo - 1]! &&
    h <= 23 &&
    mi <= 59 &&
    s <= 59 &&
    oh <= 15
  );
}

export interface RunsQuery {
  kind?: string | undefined;
  status?: string | undefined;
  leadId?: string | undefined;
  limit?: number | undefined;
  /** the agenda view: rows waiting on a start time, soonest first */
  scheduled?: boolean | undefined;
  cursor?: string | undefined;
}

export async function listRuns(
  sql: Sql,
  q: RunsQuery,
): Promise<{ runs: Record<string, unknown>[]; nextCursor?: string }> {
  if (q.leadId && !UUID_RE.test(q.leadId))
    throw new HttpError(400, 'BAD_REQUEST', 'lead_id must be a uuid');
  const limit = Math.min(Math.max(q.limit ?? 50, 1), 200);
  const params: unknown[] = [];
  const p = (v: unknown) => {
    params.push(v);
    return `$${params.length}`;
  };
  const scheduled = q.scheduled === true;
  // cursors carry timestamptz::text so microseconds survive (JS Date truncates to ms)
  let cursorCond = 'true';
  if (q.cursor) {
    const cursor = q.cursor;
    const sep = cursor.indexOf('|');
    const key = sep > 0 ? cursor.slice(0, cursor.indexOf(':')) : '';
    const ts = sep > 0 ? cursor.slice(cursor.indexOf(':') + 1, sep) : '';
    const id = sep > 0 ? cursor.slice(sep + 1) : '';
    const want = scheduled ? 'run_at' : 'created_at';
    if (key !== want || !tsOk(ts) || !UUID_RE.test(id))
      throw new HttpError(400, 'BAD_REQUEST', `cursor must be "${want}:<ts>|<run uuid>"`);
    cursorCond = scheduled
      ? `(r.run_at > ${p(ts)}::text::timestamptz or (r.run_at = ${p(ts)}::text::timestamptz and r.id > ${p(id)}::uuid))`
      : `(r.created_at < ${p(ts)}::text::timestamptz or (r.created_at = ${p(ts)}::text::timestamptz and r.id < ${p(id)}::uuid))`;
  }
  const where = [
    q.kind ? `r.kind = ${p(q.kind.slice(0, 40))}` : 'true',
    q.status ? `r.status = ${p(q.status.slice(0, 40))}` : 'true',
    q.leadId ? `r.lead_id = ${p(q.leadId)}` : 'true',
    scheduled ? 'r.run_at is not null' : 'true',
    cursorCond,
  ];
  const order = scheduled ? 'r.run_at asc, r.id asc' : 'r.created_at desc, r.id desc';
  const rows = await controlTx(sql, (tx) =>
    tx.unsafe(
      `select r.id, r.kind, r.status, r.lead_id, r.thread_id::uuid as thread_id, r.tokens_in,
              r.tokens_out, r.cost_cents, r.error, r.created_at, r.started_at, r.finished_at,
              r.run_at, r.source, r.promised,
              r.created_at::text as created_at_ts, r.run_at::text as run_at_ts,
              l.name as lead_name, th.agent_enabled as thread_agent_enabled
       from (${RUNS}) r
       left join leads l on l.id = r.lead_id
       left join lead_threads th on th.id = (case when r.thread_id ~* '^[0-9a-f-]{36}$' then r.thread_id::uuid end)
       where ${where.join(' and ')}
       order by ${order} limit ${p(limit)}`,
      params as never[],
    ),
  );
  const last = rows[rows.length - 1] as
    { id: string; created_at_ts: string; run_at_ts: string | null } | undefined;
  const nextCursor =
    rows.length === limit && last
      ? `${scheduled ? 'run_at' : 'created_at'}:${(scheduled ? last.run_at_ts : last.created_at_ts) ?? last.created_at_ts}|${last.id}`
      : undefined;
  return { runs: rows as Record<string, unknown>[], ...(nextCursor ? { nextCursor } : {}) };
}

const text = (v: unknown) => (typeof v === 'string' ? v : null);

/** A turn's events as the activity screen's journal: the input, model steps, tool calls, nudges. */
function journal(events: { type: string; payload: Record<string, unknown> }[]): unknown[] {
  const steps: unknown[] = [];
  for (const e of events) {
    const p = e.payload ?? {};
    switch (e.type) {
      case 'turn.started': {
        const batch = Array.isArray(p.batch) ? (p.batch as Record<string, unknown>[]) : [];
        const lines = batch.map((b) => {
          const pl = (b.payload ?? {}) as Record<string, unknown>;
          const what = text(pl.focus) ?? text(pl.text) ?? '';
          return `${String(b.kind)} (${String(b.source)})${what ? `: ${what}` : ''}`;
        });
        if (lines.length) steps.push({ type: 'inbox', content: lines.join('\n') });
        break;
      }
      case 'model.responded': {
        const out = (p.output ?? {}) as { text?: string; toolCalls?: unknown[] };
        const usage = (p.usage ?? {}) as Record<string, number>;
        steps.push({
          type: 'model',
          content: out.text ?? '',
          toolCalls: out.toolCalls ?? [],
          usage: {
            costUsd: usage.costUsd ?? null,
            tokensIn: usage.inputTokens ?? 0,
            tokensOut: usage.outputTokens ?? 0,
          },
        });
        break;
      }
      case 'tool.returned':
        if (p.name === 'reply') break;
        steps.push({
          type: 'tool',
          name: p.name,
          callId: p.callId,
          args: p.args ?? {},
          out: p.ok === true ? (p.data ?? p.content) : { error: p.content },
        });
        break;
      case 'guard.blocked':
        steps.push({ type: 'nudge', content: text(p.feedback) ?? text(p.reason) ?? '' });
        break;
    }
  }
  return steps;
}

export async function getRun(sql: Sql, id: string): Promise<Record<string, unknown>> {
  return controlTx(sql, async (tx) => {
    const [run] = await tx.unsafe(
      `select r.*, l.name as lead_name from (${RUNS}) r
       left join leads l on l.id = r.lead_id where r.id = $1 limit 1`,
      [id],
    );
    if (!run) throw new HttpError(404, 'RUN_NOT_FOUND', 'run not found');
    if (run.status === 'queued') return { ...run, steps: [] };
    const events = await tx<{ type: string; payload: Record<string, unknown> }[]>`
      select type, payload from agent_events
      where tenant_id = ${PLATFORM_TENANT_ID} and turn_id = ${id}
      order by seq`;
    return { ...run, steps: journal(events) };
  });
}

/** Cancels work that hasn't started: the mailbox row goes. A turn in progress runs to its end. */
export async function cancelRun(
  tx: Sql,
  id: string,
): Promise<{ status: string; leadId: string | null }> {
  const [row] = await tx<{ lead_id: string | null }[]>`
    delete from agent_mailbox m using agent_actors a
    where m.id = ${id} and a.id = m.actor_id and m.consumed_by_turn is null
      and ${tx.unsafe(CRM_MAIL)}
    returning (case when a.subject_kind = 'lead' then a.subject_id end) as lead_id`;
  if (row) {
    if (row.lead_id) {
      const { syncNextActionTx } = await import('./agenda.ts');
      await syncNextActionTx(tx, row.lead_id);
    }
    return { status: 'canceled', leadId: row.lead_id };
  }
  const [cur] = await tx.unsafe<{ status: string }[]>(
    `select r.status from (${RUNS}) r where r.id = $1 limit 1`,
    [id],
  );
  if (!cur) throw new HttpError(404, 'RUN_NOT_FOUND', 'run not found');
  if (cur.status === 'running')
    throw new HttpError(
      409,
      'RUN_RUNNING',
      'a run em andamento termina sozinha — pause o agente do lead para que ele não aja de novo',
    );
  // already finished: report it (cancel is idempotent)
  return { status: cur.status, leadId: null };
}
