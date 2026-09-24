import type { Sql } from '../platform/db.ts';
import {
  DEFAULT_GUARDRAILS,
  capCentsOf,
  getSettingTx,
  phoneIsIgnored,
  type Guardrails,
} from '../modules/integrations.ts';
import { loadPlaybookTx } from './playbooks.ts';
import type { PlaybookKind } from './tool-meta.ts';

/**
 * agent/policy — the single answer to "may the agent act on its own, and may
 * it send without a human". Workspace level (agent_autonomy) × lead flags ×
 * guardrails. Enforcement stays at the existing choke points (claimRun,
 * checkSendAllowedTx, the automatic enqueue paths); this module is what they
 * consult and what the console renders as the explanation.
 */

export type AutonomyLevel = 'off' | 'copilot' | 'supervised' | 'autopilot';
export const AUTONOMY_LEVELS: readonly AutonomyLevel[] = [
  'off',
  'copilot',
  'supervised',
  'autopilot',
];

export interface AgentAutonomySetting {
  level: AutonomyLevel;
  strategistAutoApproveUsd?: number;
}

export async function autonomyTx(tx: Sql): Promise<Required<AgentAutonomySetting>> {
  const v = await getSettingTx<Partial<AgentAutonomySetting>>(tx, 'agent_autonomy', {});
  const level = AUTONOMY_LEVELS.includes(v?.level as AutonomyLevel)
    ? (v.level as AutonomyLevel)
    : 'supervised';
  const usd = Number(v?.strategistAutoApproveUsd);
  return {
    level,
    strategistAutoApproveUsd: Number.isFinite(usd) ? Math.min(50, Math.max(0, usd)) : 0,
  };
}

export type AutomationVerdict = { ok: true } | { ok: false; code: string; reason: string };

/** Gate for runs the automation queues on its own (inbound replies, sweeps,
 *  wakeups, discovery autocontact, first contact). Staff-triggered runs only
 *  check the playbook switch (see playbookEnabledTx). */
export async function automationAllowedTx(tx: Sql, kind: PlaybookKind): Promise<AutomationVerdict> {
  const { level } = await autonomyTx(tx);
  if (level === 'off') {
    return { ok: false, code: 'workspace_off', reason: 'autonomia do agente desligada' };
  }
  return playbookEnabledTx(tx, kind);
}

export async function playbookEnabledTx(tx: Sql, kind: PlaybookKind): Promise<AutomationVerdict> {
  const pb = await loadPlaybookTx(tx, kind);
  if (!pb.enabled) {
    return { ok: false, code: 'playbook_disabled', reason: `playbook ${kind} desativado` };
  }
  return { ok: true };
}

/** Send-time draft decision — called by checkSendAllowedTx after every hard
 *  block passed. firstContactDraftOnly keeps its meaning under 'supervised'
 *  (the default); 'autopilot' lifts it, 'copilot' drafts everything. */
export function draftDecision(input: {
  level: AutonomyLevel;
  firstContact: boolean;
  firstContactDraftOnly: boolean;
  leadMode: string;
}): { forceDraft: boolean; code: string | null } {
  if (input.level === 'copilot' || input.level === 'off') {
    return { forceDraft: true, code: 'workspace_copilot' };
  }
  if (input.leadMode === 'draft') return { forceDraft: true, code: 'lead_mode_draft' };
  if (input.level === 'supervised' && input.firstContact && input.firstContactDraftOnly) {
    return { forceDraft: true, code: 'first_contact_draft' };
  }
  return { forceDraft: false, code: null };
}

export interface AutonomyReason {
  code: string;
  message: string;
}

export interface AutonomyExplanation {
  level: AutonomyLevel;
  canRun: boolean;
  sendMode: 'auto' | 'draft' | 'blocked';
  reasons: AutonomyReason[];
}

/** Human-readable view of the policy for one lead. Reasons are ordered: the
 *  first one decides the outcome, the rest are context. Read-only. */
export async function explainAutonomyTx(
  tx: Sql,
  leadId: string,
): Promise<AutonomyExplanation | null> {
  const lead = (
    await tx<
      {
        agent_mode: string;
        archived_at: string | null;
        unsubscribed_at: string | null;
        agent_paused_at: string | null;
        whatsapp: string | null;
        phone: string | null;
        email: string | null;
        email_bounced_at: string | null;
        spent: number;
        prior_out: number;
        wa_thread: number;
      }[]
    >`
      select l.agent_mode, l.archived_at, l.unsubscribed_at, l.agent_paused_at,
        l.whatsapp, l.phone, l.email, l.email_bounced_at,
        coalesce((select sum(r.cost_cents) from agent_runs r where r.lead_id = l.id), 0)::int as spent,
        (select count(*) from lead_messages m join lead_threads t on t.id = m.thread_id
          where t.lead_id = l.id and m.direction = 'out'
            and m.status in ('queued', 'sending', 'sent', 'delivered'))::int as prior_out,
        (select count(*) from lead_threads t
          where t.lead_id = l.id and t.channel = 'whatsapp' and t.external_id is not null)::int as wa_thread
      from leads l where l.id = ${leadId}
    `
  )[0];
  if (!lead) return null;
  const { level } = await autonomyTx(tx);
  const g: Guardrails = {
    ...DEFAULT_GUARDRAILS,
    ...(await getSettingTx<Partial<Guardrails>>(tx, 'guardrails', {})),
  };
  const reasons: AutonomyReason[] = [];
  const blockers: AutonomyReason[] = [];
  if (lead.archived_at) blockers.push({ code: 'archived', message: 'lead arquivado' });
  if (lead.unsubscribed_at)
    blockers.push({ code: 'unsubscribed', message: 'lead pediu para não ser contatado' });
  if (lead.agent_mode === 'off')
    blockers.push({ code: 'lead_mode_off', message: 'agente desligado neste lead' });
  if (lead.agent_paused_at)
    blockers.push({ code: 'paused', message: 'agente pausado — aguardando um humano' });
  if (phoneIsIgnored(g.ignoredPhones, lead.whatsapp, lead.phone))
    blockers.push({ code: 'ignored_phone', message: 'número na lista de ignorados' });
  const capCents = capCentsOf(g);
  if (capCents > 0 && lead.spent >= capCents)
    blockers.push({
      code: 'cost_cap',
      message: `custo acumulado atingiu o teto de US$ ${g.leadLifetimeCostCapUsd}`,
    });
  const canRun = level !== 'off' && blockers.length === 0;
  if (level === 'off')
    reasons.push({ code: 'workspace_off', message: 'autonomia do workspace desligada' });
  reasons.push(...blockers);
  const waOk = Boolean(lead.whatsapp || lead.wa_thread);
  const emailOk = Boolean(lead.email) && !lead.email_bounced_at;
  let sendMode: AutonomyExplanation['sendMode'];
  if (blockers.length) sendMode = 'blocked';
  else if (!waOk && !emailOk) {
    sendMode = 'blocked';
    reasons.push({ code: 'no_channel', message: 'sem whatsapp ou email utilizável' });
  } else {
    const d = draftDecision({
      level,
      firstContact: lead.prior_out === 0,
      firstContactDraftOnly: g.firstContactDraftOnly,
      leadMode: lead.agent_mode,
    });
    sendMode = d.forceDraft ? 'draft' : 'auto';
    const msg: Record<string, string> = {
      workspace_copilot: 'modo copiloto — toda mensagem vira rascunho para aprovação',
      lead_mode_draft: 'lead em modo rascunho — mensagens aguardam aprovação',
      first_contact_draft: 'primeiro contato passa pela fila de aprovação',
    };
    if (d.code) reasons.push({ code: d.code, message: msg[d.code] ?? d.code });
    else
      reasons.push({
        code: level === 'autopilot' ? 'autopilot' : 'supervised',
        message:
          level === 'autopilot'
            ? 'piloto automático — envia dentro dos limites (horário, teto diário)'
            : 'supervisionado — follow-ups e respostas saem sem aprovação',
      });
  }
  return { level, canRun, sendMode, reasons };
}
