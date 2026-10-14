import { randomUUID } from 'node:crypto';
import type { JsonObject } from '@vendua/agent-runtime';
import { controlTx } from '../modules/control.ts';
import type { Sql } from '../platform/db.ts';
import { log } from '../platform/log.ts';
import { syncNextActionTx } from './agenda.ts';
import {
  CRM_DISCOVERY_ID,
  CRM_STRATEGIST_ID,
  HUNT_SUBJECT,
  requestBoardTx,
  requestLeadTx,
  REVIEW_ID,
  REVIEW_SUBJECT,
  type LeadMailKind,
} from './dispatch.ts';

// The cutover to Runtime v3 (ADR 0030 steps 2–4): work the old runner left pending (agenda dates,
// unread mail, queued runs) becomes mailbox rows of the new actors, and runs the old Core still
// finished during the deploy's overlap join crm_turns. Runs at boot and on every reconcile until
// the old tables are dropped (a later migration); each row is taken once, under SKIP LOCKED.

const legacyLog = log.child({ mod: 'crm-legacy' });
const MIGRATED = 'migrado para o runtime v3';
const BATCH = 200;

const LEAD_KIND: Record<string, LeadMailKind> = {
  inbound: 'message.inbound',
  callback: 'timer.callback',
  followup: 'timer.followup',
  first_contact: 'lead.first_contact',
  regenerate: 'staff.regenerate',
  staff: 'staff.request',
};

const obj = (v: unknown): JsonObject =>
  v && typeof v === 'object' && !Array.isArray(v) ? (v as JsonObject) : {};

/** What the old row asked for, in the new payload's terms (crm/dispatch.ts kinds). */
function payloadOf(kind: string, params: unknown, extra: JsonObject = {}): JsonObject {
  const p = obj(params);
  const out: JsonObject = { ...extra };
  for (const k of ['focus', 'channel', 'draftOnly', 'goal', 'src', 'text'] as const)
    if (p[k] !== undefined && p[k] !== null) out[k] = p[k]!;
  if (typeof out.text === 'string') out.text = out.text.slice(0, 1000);
  if (typeof out.focus === 'string') out.focus = out.focus.slice(0, 1000);
  out.kind = kind;
  return out;
}

async function tableExists(tx: Sql, name: string): Promise<boolean> {
  const [row] = await tx<{ r: string | null }[]>`select to_regclass(${name}) as r`;
  return !!row?.r;
}

export async function adoptLegacy(sql: Sql): Promise<number> {
  return controlTx(sql, async (tx) => {
    if (!(await tableExists(tx, 'agent_runs'))) return 0;
    let n = 0;
    const leads = new Set<string>();

    const wakeups = await tx<
      {
        id: string;
        lead_id: string;
        at: Date;
        focus: string;
        requested: boolean;
        created_by: string;
      }[]
    >`
      select id, lead_id, at, focus, requested, created_by from agent_wakeups
      where status = 'pending' order by at limit ${BATCH} for update skip locked`;
    for (const w of wakeups) {
      await requestLeadTx(tx, {
        leadId: w.lead_id,
        kind: w.requested || w.created_by === 'staff' ? 'timer.callback' : 'timer.followup',
        source: w.created_by === 'staff' ? 'staff' : 'agent',
        dedupeKey: `crm:legacy:wakeup:${w.id}`,
        payload: {
          focus: w.focus,
          requested: w.requested,
          by: w.created_by === 'staff' ? 'staff' : 'agent',
        },
        at: w.at,
        keepParked: true,
      });
      leads.add(w.lead_id);
      n++;
    }
    if (wakeups.length)
      await tx`
        update agent_wakeups set status = 'canceled', cancel_reason = ${MIGRATED}, updated_at = now()
        where id = any(${wakeups.map((w) => w.id)}::uuid[])`;

    const mail = await tx<
      { id: string; lead_id: string; source: string; payload: JsonObject; channel: string | null }[]
    >`
      select i.id, i.lead_id, i.source, i.payload,
        (select t.channel::text from lead_threads t where t.id::text = i.payload->>'threadId') as channel
      from agent_inbox i
      where i.consumed_at is null order by i.created_at limit ${BATCH} for update of i skip locked`;
    for (const m of mail) {
      const kind = LEAD_KIND[m.source] ?? 'staff.request';
      const job =
        typeof m.payload.requestedKind === 'string' ? m.payload.requestedKind : 'outreach';
      const at = typeof m.payload.notBefore === 'string' ? new Date(m.payload.notBefore) : null;
      await requestLeadTx(tx, {
        leadId: m.lead_id,
        kind,
        source: kind === 'message.inbound' ? (m.channel ?? 'whatsapp') : m.source,
        dedupeKey: `crm:legacy:inbox:${m.id}`,
        payload: payloadOf(kind === 'message.inbound' ? 'reply' : job, m.payload.params, {
          ...(typeof m.payload.threadId === 'string' ? { threadId: m.payload.threadId } : {}),
          ...(m.channel && kind === 'message.inbound' ? { channel: m.channel } : {}),
          ...(typeof m.payload.text === 'string' ? { text: m.payload.text.slice(0, 1000) } : {}),
        }),
        ...(at && !Number.isNaN(at.getTime()) ? { at } : {}),
      });
      leads.add(m.lead_id);
      n++;
    }
    if (mail.length)
      await tx`
        update agent_inbox set consumed_at = now()
        where id = any(${mail.map((m) => m.id)}::uuid[])`;

    const runs = await tx<
      {
        id: string;
        kind: string;
        lead_id: string | null;
        thread_id: string | null;
        source: string | null;
        params: JsonObject;
        run_at: Date | null;
      }[]
    >`
      select id, kind, lead_id, thread_id, source, params, run_at from agent_runs
      where status = 'queued' order by created_at limit ${BATCH} for update skip locked`;
    for (const r of runs) {
      const at = r.run_at && r.run_at.getTime() > Date.now() ? r.run_at : null;
      if (r.lead_id) {
        const kind =
          r.kind === 'reply' ? 'message.inbound' : (LEAD_KIND[r.source ?? ''] ?? 'staff.request');
        await requestLeadTx(tx, {
          leadId: r.lead_id,
          kind,
          source: r.source ?? 'staff',
          dedupeKey: `crm:legacy:run:${r.id}`,
          payload: payloadOf(r.kind, r.params, r.thread_id ? { threadId: r.thread_id } : {}),
          at,
        });
        leads.add(r.lead_id);
      } else if (r.kind === 'discovery') {
        const briefId = typeof r.params.briefId === 'string' ? r.params.briefId : null;
        await requestBoardTx(tx, {
          agent: CRM_DISCOVERY_ID,
          subject: { kind: HUNT_SUBJECT, id: briefId ?? randomUUID() },
          kind: briefId ? 'timer.daily' : 'staff.request',
          source: briefId ? 'schedule' : 'staff',
          dedupeKey: `crm:legacy:run:${r.id}`,
          payload: { ...r.params, kind: 'discovery' },
          at,
        });
      } else if (r.kind === 'strategist') {
        await requestBoardTx(tx, {
          agent: CRM_STRATEGIST_ID,
          subject: { kind: REVIEW_SUBJECT, id: REVIEW_ID },
          kind: r.source === 'weekly' ? 'timer.weekly' : 'staff.request',
          source: r.source === 'weekly' ? 'schedule' : 'staff',
          dedupeKey: `crm:legacy:run:${r.id}`,
          payload: { kind: 'strategist' },
          at,
        });
      }
      n++;
    }
    if (runs.length)
      await tx`
        update agent_runs set status = 'canceled', error = ${MIGRATED}, finished_at = now()
        where id = any(${runs.map((r) => r.id)}::uuid[])`;

    // runs the old Core finished during the overlap (the migration copied the ones before it)
    await tx`
      insert into crm_turns (turn_id, actor_id, agent_id, kind, source, lead_id, brief_id, status,
                             started_at, finished_at, steps, acted, leads_created, tokens_in,
                             tokens_out, cost_cents, error, params)
      select r.id, r.id, 'crm', r.kind, coalesce(r.source, 'agent'),
             case when exists (select 1 from leads l where l.id = r.lead_id) then r.lead_id end,
             (select b.id from discovery_briefs b where b.id::text = r.params->>'briefId'),
             r.status, coalesce(r.started_at, r.created_at), coalesce(r.finished_at, r.created_at),
             0, false,
             (select count(*)::int from jsonb_array_elements(
                case when jsonb_typeof(r.steps) = 'array' then r.steps else '[]'::jsonb end) s
              where s->>'name' = 'create_lead' and s->'out'->'lead'->>'id' is not null),
             coalesce(r.tokens_in, 0), coalesce(r.tokens_out, 0),
             coalesce(r.cost_cents, 0), left(r.error, 1000),
             case when octet_length(r.params::text) <= 8000 then r.params else '{}'::jsonb end
      from agent_runs r
      where r.status in ('done', 'failed') and r.finished_at > now() - interval '1 day'
      on conflict (turn_id) do nothing`;

    for (const l of leads) await syncNextActionTx(tx, l);
    if (n) legacyLog.info({ adopted: n }, 'adopted pending work from the old agent runtime');
    return n;
  });
}
