import { UUID_RE } from '../platform/http.ts';
import type { Sql } from '../platform/db.ts';
import {
  DEFAULT_GUARDRAILS,
  getIntegrationTx,
  getSettingTx,
  type Guardrails,
} from '../modules/integrations.ts';
import { recordStaffEventTx } from '../modules/staff-events.ts';
import type { Channel } from '../modules/threads.ts';
import { checkSendAllowedTx } from './guardrails.ts';
import { automationAllowedTx } from './policy.ts';
import { isAutomated } from './dispatch.ts';
import { cancelAgentWakeupsTx } from './agenda.ts';
import { CRM_AGENT_ID, jobOf } from './jobs.ts';
import { PLATFORM_TENANT_ID } from '../platform/tenancy.ts';
import { hasUnresolvedTemplate } from './style.ts';

export async function unattendedDeliveryTx(
  tx: Sql,
  messageId: string,
  gateway = false,
): Promise<{ reason: string; retryAt?: Date; draft?: true } | null> {
  const [m] = await tx<
    {
      lead_id: string;
      channel: Channel;
      agent_enabled: boolean;
      state: string;
      tenant_id: string | null;
      approved_by: string | null;
      body: string;
      subject: string | null;
      is_farewell: boolean;
      superseded: boolean;
      trigger: string | null;
      source: string | null;
    }[]
  >`
    select t.lead_id, t.channel, t.agent_enabled, l.state, l.tenant_id, m.is_farewell,
      m.approved_by, m.body, m.subject,
      started.payload->'batch'->0->>'kind' as trigger, started.payload->'batch'->0->>'source' as source,
      exists (
        select 1 from lead_messages newer join lead_threads nt on nt.id = newer.thread_id
        where nt.lead_id = t.lead_id and not newer.historical and newer.received_at > coalesce(started.at, m.received_at)
          and ((newer.direction = 'in' and not newer.auto_reply) or (newer.direction = 'out' and newer.author = 'staff'
            and newer.status in ('queued', 'sending', 'sent', 'delivered')))
        union all
        select 1 from lead_activities a where a.lead_id = t.lead_id
          and a.meta->>'type' = 'site_callback' and a.at > coalesce(started.at, m.received_at)
      ) as superseded
    from lead_messages m join lead_threads t on t.id = m.thread_id join leads l on l.id = t.lead_id
    left join lateral (
      select e.at, e.payload from agent_actors a join agent_events e on e.actor_id = a.id
      where a.tenant_id = ${PLATFORM_TENANT_ID} and a.agent_id = ${CRM_AGENT_ID}
        and a.subject_kind = 'lead' and a.subject_id = t.lead_id::text
        and e.turn_id = m.agent_run_id and e.type = 'turn.started'
      order by e.at limit 1
    ) started on true
    where m.id = ${messageId} and m.author = 'agent'
    for share of t, l`;
  if (!m) return null;
  if (hasUnresolvedTemplate(m.body, m.subject)) return { reason: 'unresolved template' };
  if (m.approved_by !== null) return null;
  if (m.state === 'live' || m.tenant_id) return { reason: 'store already created' };
  if (m.superseded) return { reason: 'superseded by newer contact' };
  if (!m.agent_enabled) return { reason: 'thread paused for agent' };
  if (gateway && !(await getIntegrationTx(tx, 'whatsapp')))
    return { reason: 'no enabled whatsapp integration' };
  const settings = await getSettingTx<Partial<Guardrails>>(tx, 'guardrails', {});
  const verdict = await checkSendAllowedTx(
    tx,
    { ...DEFAULT_GUARDRAILS, ...settings },
    m.lead_id,
    m.channel,
    {
      messageId,
      farewell: m.is_farewell,
      skipBudget: gateway,
    },
  );
  if (verdict.forceDraft) return { reason: 'approval required by current policy', draft: true };
  if (m.trigger && m.source && isAutomated(m.trigger, m.source)) {
    const policy = await automationAllowedTx(tx, jobOf(m.trigger, null));
    if (!policy.ok) return { reason: policy.reason };
  }
  if (!verdict.ok)
    return {
      reason: verdict.reason ?? 'send blocked',
      ...(verdict.retryAt ? { retryAt: verdict.retryAt } : {}),
    };
  return null;
}

/** One staff task per failed inbound, triage request or delivery. */
export async function salesAttentionTx(
  tx: Sql,
  leadId: string,
  key: string,
  reason: string,
  threadId: string | null = null,
  pause = false,
): Promise<boolean> {
  await tx`select pg_advisory_xact_lock(hashtext(${`crm:attention:${key}`}))`;
  const [lead] = await tx<{ name: string; business_name: string | null }[]>`
    select name, business_name from leads
    where id = ${leadId} and archived_at is null and unsubscribed_at is null
      and state <> 'live' and tenant_id is null`;
  if (!lead) return false;
  const [seen] = await tx`select 1 from lead_activities
    where lead_id = ${leadId} and meta->>'attentionKey' = ${key}`;
  if (seen) return true;
  if (pause) {
    await cancelAgentWakeupsTx(tx, leadId);
    await tx`update leads set agent_paused_at = coalesce(agent_paused_at, now()), updated_at = now()
      where id = ${leadId}`;
  }
  const [task] = await tx<{ id: string }[]>`
    insert into lead_tasks (lead_id, title, due_at, created_by)
    values (${leadId}, ${`[humano] ${lead.name}: ${reason}`.slice(0, 300)}, now(), 'agent') returning id`;
  await tx`insert into lead_activities (lead_id, kind, body, meta, created_by)
    values (${leadId}, 'system', ${reason}, ${tx.json({ attentionKey: key, taskId: task!.id })}, 'agent')`;
  await recordStaffEventTx(
    tx,
    'handoff.requested',
    {
      taskId: task!.id,
      leadId,
      leadName: lead.name,
      business: lead.business_name,
      channel: null,
      threadId,
      reason: reason.slice(0, 500),
    },
    { dedupeKey: `crm:attention:${key}` },
  );
  return true;
}

/** Transport failures need attention when a prospect was waiting on the message. */
export async function salesDeliveryFailedTx(tx: Sql, messageId: string): Promise<void> {
  const [row] = await tx<{ lead_id: string; thread_id: string }[]>`
    select t.lead_id, m.thread_id from lead_messages m join lead_threads t on t.id = m.thread_id
    where m.id = ${messageId} and m.author = 'agent' and not m.is_farewell and exists (
      select 1 from lead_messages i join lead_threads it on it.id = i.thread_id
      where it.lead_id = t.lead_id and i.direction = 'in' and not i.historical and not i.auto_reply
        and i.received_at between m.received_at - interval '3 days' and m.received_at
      union all
      select 1 from lead_activities a where a.lead_id = t.lead_id and a.meta->>'type' = 'site_callback'
        and a.at between m.received_at - interval '3 days' and m.received_at
    )`;
  if (row)
    await salesAttentionTx(
      tx,
      row.lead_id,
      `delivery:${messageId}`,
      'falha no envio da resposta do agente — confira a conversa e responda',
      row.thread_id,
      true,
    );
}

export async function returnAgentMessageToDraftTx(tx: Sql, messageId: string): Promise<void> {
  const [draft] = await tx<
    {
      id: string;
      thread_id: string;
      lead_id: string;
      name: string;
      business_name: string | null;
      channel: string;
      subject: string | null;
      body: string;
    }[]
  >`
    update lead_messages m set status = 'draft', send_after = null, dispatch_attempted_at = null,
      updated_at = now()
    from lead_threads t join leads l on l.id = t.lead_id
    where m.id = ${messageId} and t.id = m.thread_id and m.status in ('queued', 'sending')
    returning m.id, m.thread_id, t.lead_id, l.name, l.business_name, t.channel, m.subject, m.body`;
  if (draft)
    await recordStaffEventTx(tx, 'draft.pending', {
      messageId: draft.id,
      threadId: draft.thread_id,
      leadId: draft.lead_id,
      leadName: draft.name,
      business: draft.business_name,
      channel: draft.channel,
      subject: draft.subject,
      body: draft.body,
    });
}

/** Revalidate a CRM message at the final WhatsApp claim, after Core handed it off. */
export async function prepareCrmGatewayTx(
  tx: Sql,
  row: { id: string; purpose: string; ref: string | null },
): Promise<'ready' | 'deferred' | 'settled'> {
  if (row.purpose !== 'crm' || !row.ref || !UUID_RE.test(row.ref)) return 'ready';
  const policy = await unattendedDeliveryTx(tx, row.ref, true);
  if (!policy) return 'ready';
  if (policy.retryAt) {
    await tx`update platform_wa_outbox set status = 'pending', lease_until = null,
      next_attempt_at = ${policy.retryAt}, expires_at = greatest(expires_at, ${policy.retryAt}::timestamptz + interval '6 hours')
      where id = ${row.id}`;
    return 'deferred';
  }
  if (policy.draft) await returnAgentMessageToDraftTx(tx, row.ref);
  await tx`update platform_wa_outbox set status = 'failed', lease_until = null, error = ${policy.reason},
    settled_at = case when ${policy.draft === true} then now() else settled_at end
    where id = ${row.id}`;
  return 'settled';
}
