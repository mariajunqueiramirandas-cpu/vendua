import type { Context, Hono } from 'hono';
import { claimControl, controlTx } from '../modules/control.ts';
import { emitControlEvent } from '../modules/control-events.ts';
import { recordStaffEventTx } from '../modules/staff-events.ts';
import { deleteWipedRowsTx, unclassified, wipePlan } from '../modules/store-reset.ts';
import type { Sql } from '../platform/db.ts';
import { bodyJson, HttpError, str } from '../platform/http.ts';
import { log } from '../platform/log.ts';
import { PLATFORM_TENANT_ID, type Tenant } from '../platform/tenancy.ts';
import { resetInstructionsTx } from './policy.ts';

// Staff zero the CRM: the sales agent, the discovery agent and the rest of the CRM's agents start
// over. Every lead goes with its conversations, except the ones that became a store: those stay,
// and the agents forget them like the rest. The agents' memory, queues, turns, campaigns, hunts and
// briefs go, and the sales instructions and pitch go back to the defaults. Connections, limits,
// autonomy, upcoming calls, stores and the team's history stay.
//
// The platform tenant is the CRM's workspace (migration 0131), so its rows go the way a store's
// content goes in a store reset (RESET_WIPES). Every platform table (no tenant_id) is named below
// as wiped, kept or reset by its own step; a table in none of them fails test/crm-reset.test.ts, so
// a new one is a decision.

/** what staff type to confirm */
export const CRM_RESET_WORD = 'zerar crm';

/** every row goes, in this order */
export const CRM_RESET_WIPES = [
  'telegram_prompts',
  'telegram_proposals',
  'sim_runs',
  'pipeline_snapshots',
  'ig_follows',
  'lead_facts',
  'crm_turns',
  'crm_campaign_leads',
  'crm_campaign_hunts',
  'crm_campaigns',
  'discovery_briefs',
  'agent_wakeups',
  'agent_inbox',
  'agent_run_steps',
  'agent_runs',
  'agent_memory_items',
] as const;

/** reset row by row in `resetCrmTx` */
export const CRM_RESET_OWN_STEPS = [
  // the leads that became a store stay with their conversations; the rest cascade with their lead
  'leads',
  'lead_threads',
  'lead_messages',
  'lead_audio',
  'lead_activities',
  'lead_state_history',
  'lead_tasks',
  // a call still ahead stays on the agenda
  'meetings',
  // instructions and pitch back to the defaults
  'control_settings',
  // the CRM sends still queued for the gateway, of the messages that went
  'platform_wa_outbox',
] as const;

/** connections, staff, billing, fleet and history: the reset leaves these alone */
export const CRM_RESET_KEEPS = [
  'agent_versions',
  'ai_packs',
  'control_idempotency_keys',
  'control_integrations',
  'control_saved_views',
  'control_sessions',
  'github_deliveries',
  'ig_auth_state',
  'job_leases',
  'merchant_login_codes',
  'merchant_login_failures',
  'outbox_cursors',
  'partner_payouts',
  'partners',
  'plans',
  'platform_incidents',
  'platform_wa_auth',
  'platform_wa_inbox',
  'platform_wa_media',
  'platform_wa_probes',
  'platform_wa_sessions',
  'provider_events',
  'releases',
  'scheduled_jobs',
  'schema_migrations',
  'signup_coupons',
  'signup_otp_sends',
  'staff_event_messages',
  'telegram_dm_outbox',
  'tenants',
  'wa_auth_state',
  'wa_gateways',
  'web_analytics_events',
  'web_analytics_salts',
] as const;

const NAMED = new Set<string>([...CRM_RESET_WIPES, ...CRM_RESET_OWN_STEPS, ...CRM_RESET_KEEPS]);
const IDENT = /^[a-z_][a-z0-9_]*$/;
const rlog = log.child({ mod: 'crm-reset' });

/** Every public table without a tenant_id. */
export async function platformTables(tx: Sql): Promise<string[]> {
  return (
    await tx<{ t: string }[]>`
      select c.relname as t from pg_class c
        join pg_namespace n on n.oid = c.relnamespace and n.nspname = 'public'
      where c.relkind in ('r', 'p') and not c.relispartition
        and not exists (
          select 1 from pg_attribute a
          where a.attrelid = c.oid and a.attname = 'tenant_id' and not a.attisdropped)
      order by 1`
  ).map((r) => r.t);
}

export function unclassifiedPlatform(tables: string[]): string[] {
  return tables.filter((t) => !NAMED.has(t));
}

export interface CrmResetCounts {
  /** leads that go, with their conversations */
  leads: number;
  /** leads that became a store: they stay, forgotten by the agents */
  keptLeads: number;
  conversations: number;
  /** learnings, debriefs, facts about leads and the runtime's memory */
  memories: number;
  campaigns: number;
  briefs: number;
  /** calls still ahead with leads that go: they stay on the agenda */
  meetingsKept: number;
}

async function countsTx(tx: Sql): Promise<CrmResetCounts> {
  const [r] = await tx<CrmResetCounts[]>`
    select
      (select count(*)::int from leads where tenant_id is null) as leads,
      (select count(*)::int from leads where tenant_id is not null) as "keptLeads",
      (select count(*)::int from lead_threads t join leads l on l.id = t.lead_id
        where l.tenant_id is null) as conversations,
      (select count(*)::int from agent_memory_items)
        + (select count(*)::int from lead_facts)
        + (select count(*)::int from agent_memory where tenant_id = ${PLATFORM_TENANT_ID})
        as memories,
      (select count(*)::int from crm_campaigns) as campaigns,
      (select count(*)::int from discovery_briefs) as briefs,
      (select count(*)::int from meetings m join leads l on l.id = m.lead_id
        where l.tenant_id is null and m.status = 'scheduled' and m.ends_at > now()) as "meetingsKept"`;
  return r!;
}

/** The reset itself, inside a control transaction (the claim's). */
export async function resetCrmTx(
  tx: Sql,
): Promise<CrmResetCounts & { resetAt: string; rows: number }> {
  await tx`select pg_advisory_xact_lock(hashtext('vendua.crm-reset'))`;
  const plan = await wipePlan(tx);
  const loose = [...unclassified(plan.tables), ...unclassifiedPlatform(await platformTables(tx))];
  if (loose.length)
    throw new Error(`crm reset: tables neither kept nor wiped: ${loose.join(', ')}`);
  const counts = await countsTx(tx);
  const resetAt = new Date().toISOString();

  // The agents first, in the platform tenant's own scope with the control scope closed (as a
  // store reset does): a turn still writing holds its actor FOR SHARE, so this waits for it to
  // commit, and anything it tries after finds its lease gone. Its mailbox and log cascade.
  // a throw below aborts the whole transaction, so nothing needs the scope put back on the way out
  await tx`
    select set_config('vendua.tenant_id', ${PLATFORM_TENANT_ID}, true),
      set_config('vendua.control', '', true), set_config('vendua.print_pairing', '1', true)`;
  let rows = await deleteWipedRowsTx(tx, PLATFORM_TENANT_ID, plan.order);
  await tx`
    select set_config('vendua.tenant_id', '', true),
      set_config('vendua.control', '1', true), set_config('vendua.print_pairing', '', true)`;

  for (const t of CRM_RESET_WIPES) {
    if (!IDENT.test(t)) throw new Error(`crm reset: odd table name ${t}`);
    rows += (await tx.unsafe(`delete from "${t}"`)).count;
  }

  // the leads that stay: nothing of the agents' left to send, nor planned
  rows += (
    await tx`
      update lead_messages set status = 'rejected', error = 'CRM zerado pela equipe',
        updated_at = now()
      where direction = 'out' and author = 'agent' and status in ('draft', 'queued')
        and thread_id in (
          select t.id from lead_threads t join leads l on l.id = t.lead_id
          where l.tenant_id is not null)`
  ).count;
  await tx`
    update leads set agent_plan = default, intent_score = null, intent_reason = null,
      next_action_at = null, next_action_source = default, updated_at = now()
    where tenant_id is not null`;

  rows += (
    await tx`
      delete from meetings m using leads l
      where l.id = m.lead_id and l.tenant_id is null
        and not (m.status = 'scheduled' and m.ends_at > now())`
  ).count;
  // threads, messages, tasks, activities and history cascade; a call kept above loses its lead
  rows += (await tx`delete from leads where tenant_id is null`).count;
  // a message that went can't be sent: the gateway would still deliver what it queued
  rows += (
    await tx`
      delete from platform_wa_outbox o
      where o.purpose = 'crm' and o.status = 'pending' and o.ref is not null
        and not exists (select 1 from lead_messages m where m.id::text = o.ref)`
  ).count;

  await resetInstructionsTx(tx, 'all');
  // the retired v1 memory panel's facts
  await tx`delete from control_settings where key = 'agent_memory'`;

  await recordStaffEventTx(tx, 'crm.reset', {
    leads: counts.leads,
    keptLeads: counts.keptLeads,
  });
  return { ...counts, resetAt, rows };
}

export function mountCrmReset(o: {
  app: Hono<{ Variables: { tenant: Tenant } }>;
  sql: Sql;
  controlGate: (c: Context) => void;
  requireIdemKey: (c: Context) => string;
}) {
  const { app, sql, controlGate } = o;

  app.get('/control/v1/crm/reset', async (c) => {
    controlGate(c);
    const counts = await controlTx(sql, countsTx);
    c.header('cache-control', 'no-store');
    return c.json({ word: CRM_RESET_WORD, counts });
  });

  app.post('/control/v1/crm/reset', async (c) => {
    controlGate(c);
    const body = await bodyJson(c);
    const typed = str(body.confirm, 'confirm', 40).trim().toLowerCase().replace(/\s+/g, ' ');
    if (typed !== CRM_RESET_WORD)
      throw new HttpError(422, 'CONFIRM_MISMATCH', `type "${CRM_RESET_WORD}" to confirm`, {
        field: 'confirm',
      });
    const res = await claimControl(sql, o.requireIdemKey(c), async (tx) => {
      const out = await resetCrmTx(tx);
      rlog.warn(
        { leads: out.leads, keptLeads: out.keptLeads, rows: out.rows },
        'crm reset by staff',
      );
      return { status: 200, body: out };
    });
    if (res.replayed) c.header('x-idempotent-replay', 'true');
    else
      for (const type of [
        'lead.change',
        'thread.message',
        'draft.change',
        'run.update',
        'meeting.change',
      ] as const)
        emitControlEvent(type);
    return c.json(res.body, res.status as 200);
  });
}
