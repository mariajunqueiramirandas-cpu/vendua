import type { Sql } from '../platform/db.ts';
import {
  DEFAULT_GUARDRAILS,
  getSettingTx,
  type Guardrails,
} from '../modules/integrations.ts';

/**
 * agent/guardrails — the hard rules around every outbound message. Enforced
 * in code in the runner path, never in the prompt: the model asks, this
 * decides. Ordering matters — the first false answer wins.
 */

export interface SendVerdict {
  ok: boolean;
  /** true → send_message degrades to a draft for the approvals queue. */
  forceDraft: boolean;
  reason?: string;
}

/** Tx-local guardrail check — the send_message tool calls this inside the
 *  same transaction that takes the lead's advisory lock and inserts the
 *  outbound message, so two concurrent runs can't both see spare cap. */
export async function checkSendAllowedTx(
  tx: Sql,
  g: Guardrails,
  leadId: string,
): Promise<SendVerdict> {
  {
    const lead = (
      await tx<
        {
          agent_mode: string;
          archived_at: string | null;
          unsubscribed_at: string | null;
        }[]
      >`select agent_mode, archived_at, unsubscribed_at from leads where id = ${leadId}`
    )[0];
    if (!lead) return { ok: false, forceDraft: false, reason: 'lead not found' };
    if (lead.archived_at) return { ok: false, forceDraft: false, reason: 'lead archived' };
    if (lead.unsubscribed_at) return { ok: false, forceDraft: false, reason: 'lead unsubscribed' };
    if (lead.agent_mode === 'off')
      return { ok: false, forceDraft: false, reason: 'agent off for lead' };

    // Quiet hours — compared in the configured timezone (America/Sao_Paulo
    // default). Overnight window (21:00→08:00) wraps past midnight.
    const hh = (
      await tx<{ h: number; m: number }[]>`
        select extract(hour from now() at time zone ${g.timezone})::int as h,
               extract(minute from now() at time zone ${g.timezone})::int as m
      `
    )[0]!;
    const cur = hh.h * 60 + hh.m;
    const [qsH, qsM] = g.quietStart.split(':').map(Number);
    const [qeH, qeM] = g.quietEnd.split(':').map(Number);
    const start = (qsH ?? 21) * 60 + (qsM ?? 0);
    const end = (qeH ?? 8) * 60 + (qeM ?? 0);
    const quiet = start <= end ? cur >= start && cur < end : cur >= start || cur < end;
    if (quiet) return { ok: false, forceDraft: false, reason: 'quiet hours' };

    // Daily outbound cap per lead (agent-authored only — staff sends don't count).
    const sentToday = (
      await tx<{ n: number }[]>`
        select count(*)::int as n from lead_messages m
        join lead_threads t on t.id = m.thread_id
        where t.lead_id = ${leadId} and m.direction = 'out' and m.author = 'agent'
          and m.status in ('queued', 'sent', 'delivered')
          and m.created_at > now() - interval '1 day'
      `
    )[0]!.n;
    if (sentToday >= g.maxOutboundPerLeadPerDay) {
      return { ok: false, forceDraft: false, reason: 'daily cap reached' };
    }

    // First contact is always human-approved — the lead has never seen an
    // outbound from us, so this one must wait in the approvals queue.
    const priorOut = (
      await tx<{ n: number }[]>`
        select count(*)::int as n from lead_messages m
        join lead_threads t on t.id = m.thread_id
        where t.lead_id = ${leadId} and m.direction = 'out'
          and m.status in ('queued', 'sent', 'delivered')
      `
    )[0]!.n;
    if (g.firstContactDraftOnly && priorOut === 0) {
      return { ok: true, forceDraft: true };
    }
    if (lead.agent_mode === 'draft') return { ok: true, forceDraft: true };
    return { ok: true, forceDraft: false };
  }
}

async function guardrailsTx(tx: Sql): Promise<Guardrails> {
  const stored = await getSettingTx(tx, 'guardrails', {} as Partial<Guardrails>);
  return { ...DEFAULT_GUARDRAILS, ...stored };
}
