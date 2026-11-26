import type { Context, Hono } from 'hono';
import { claimControl, controlTx } from '../modules/control.ts';
import { emitControlEvent } from '../modules/control-events.ts';
import { recordStaffEventTx } from '../modules/staff-events.ts';
import { deleteWipedRowsTx, unclassified, wipePlan } from '../modules/store-reset.ts';
import type { Sql } from '../platform/db.ts';
import { bodyJson, HttpError, str } from '../platform/http.ts';
import { log } from '../platform/log.ts';
import { PLATFORM_TENANT_ID, type Tenant } from '../platform/tenancy.ts';

// Staff zero the whole sales side (the CRM's Vendas: Hoje, Pipeline, Inbox, Agenda, Agente): every
// lead with its conversations and tasks, every call, the agents' memory, queues, turns, campaigns,
// hunts and briefs, and the agent's whole setup back to the defaults, switched off. Stores (a lead
// that became one only loses its CRM card), connections, the team and staff history stay.
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
  'crm_agenda_reviews',
  'crm_campaign_leads',
  'crm_campaign_hunts',
  'crm_campaigns',
  'discovery_briefs',
  'meetings',
  'agent_wakeups',
  'agent_inbox',
  'agent_run_steps',
  'agent_runs',
  'agent_memory_items',
] as const;

/** reset row by row in `resetCrmTx` */
export const CRM_RESET_OWN_STEPS = [
  // every lead; its conversations, tasks and history cascade
  'leads',
  'lead_threads',
  'lead_messages',
  'lead_audio',
  'lead_activities',
  'lead_state_history',
  'lead_tasks',
  // the agent's setup back to the defaults, switched off (`resetAgentSetupTx`)
  'control_settings',
  // the CRM sends still queued for the gateway
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
  leads: number;
  /** of those, the ones that became a store (the store stays) */
  storeLeads: number;
  conversations: number;
  meetings: number;
  /** learnings, debriefs, facts about leads and the runtime's memory */
  memories: number;
  campaigns: number;
  briefs: number;
}

async function countsTx(tx: Sql): Promise<CrmResetCounts> {
  const [r] = await tx<CrmResetCounts[]>`
    select
      (select count(*)::int from leads) as leads,
      (select count(*)::int from leads where tenant_id is not null) as "storeLeads",
      (select count(*)::int from lead_threads) as conversations,
      (select count(*)::int from meetings) as meetings,
      (select count(*)::int from agent_memory_items)
        + (select count(*)::int from lead_facts)
        + (select count(*)::int from agent_memory where tenant_id = ${PLATFORM_TENANT_ID})
        as memories,
      (select count(*)::int from crm_campaigns) as campaigns,
      (select count(*)::int from discovery_briefs) as briefs`;
  return r!;
}

/**
 * Agente → Configurar back to the defaults, switched off until staff turn it on: the default level
 * is autopilot, and nobody has told the agent what to sell yet. Numbers in the retired
 * guardrails.ignoredPhones are still honored (blockedPhonesTx), so they stay.
 */
async function resetAgentSetupTx(tx: Sql): Promise<void> {
  await tx`
    insert into control_settings (key, value) values ('agent', ${tx.json({ level: 'off' })})
    on conflict (key) do update set value = excluded.value`;
  const [g] = await tx<{ phones: unknown }[]>`
    select value->'ignoredPhones' as phones from control_settings where key = 'guardrails'`;
  if (Array.isArray(g?.phones) && g.phones.length)
    await tx`
      update control_settings set value = ${tx.json({ ignoredPhones: g.phones })}
      where key = 'guardrails'`;
  else await tx`delete from control_settings where key = 'guardrails'`;
  // agent_memory: the retired v1 memory panel's facts
  await tx`delete from control_settings where key in ('pitch', 'agent_memory')`;
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
  // threads, messages, tasks, activities and history cascade; a store only loses its CRM card
  rows += (await tx`delete from leads`).count;
  // the gateway would still deliver what it queued for messages that are gone
  rows += (await tx`delete from platform_wa_outbox where purpose = 'crm' and status = 'pending'`)
    .count;

  await resetAgentSetupTx(tx);

  await recordStaffEventTx(tx, 'crm.reset', { leads: counts.leads });
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
      rlog.warn({ leads: out.leads, rows: out.rows }, 'crm reset by staff');
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
        'settings.change',
      ] as const)
        emitControlEvent(type);
    return c.json(res.body, res.status as 200);
  });
}
