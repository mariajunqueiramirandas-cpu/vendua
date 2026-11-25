import { afterCommit, type Sql } from '../platform/db.ts';
import { PLATFORM_TENANT_ID } from '../platform/tenancy.ts';
import { claimControl, type ClaimResult } from '../modules/control.ts';
import { emitControlEvent } from '../modules/control-events.ts';
import {
  DEFAULT_GUARDRAILS,
  DEFAULT_AGENT_RULES,
  capCentsOf,
  newLeadModesOf,
  type NewLeadModes,
  getPitchTx,
  getSettingTx,
  phoneIsIgnored,
  putSettingTx,
  validateSetting,
  type Guardrails,
  type Pitch,
} from '../modules/integrations.ts';
import { channelAvailabilityTx, leadHasContactTx, passesAutoContactScore } from './guardrails.ts';
import { blockedPhonesTx } from '../modules/staff.ts';

// The one agent setting (`agent`): autonomy preset × automatic jobs × staff instructions,
// consulted by the CRM producers (crm/dispatch.ts), every turn's subject load and
// checkSendAllowedTx.

import { type JobKind } from './jobs.ts';
export { JOB_KINDS, type JobKind } from './jobs.ts';

export type AutonomyLevel = 'off' | 'copilot' | 'supervised' | 'autopilot';
export const AUTONOMY_LEVELS: readonly AutonomyLevel[] = [
  'off',
  'copilot',
  'supervised',
  'autopilot',
];

/** kinds automation can start; triage is staff-triggered only */
export type AgentJob = Exclude<JobKind, 'triage'>;
export const AGENT_JOBS: readonly AgentJob[] = ['reply', 'outreach', 'discovery', 'strategist'];

export const AGENT_INSTRUCTIONS_MAX = 8000;
export const DEFAULT_INSTRUCTIONS = DEFAULT_AGENT_RULES.map((r) => `- ${r}`).join('\n');

/** when the recurring jobs run, in the workspace timezone (guardrails.timezone) */
export interface AgentSchedule {
  /** discovery briefs run once a day from this local hour */
  discoveryHour: number;
  /** weekly review: 0 = Sunday … 6 = Saturday */
  weeklyDay: number;
  weeklyHour: number;
}
export const DEFAULT_SCHEDULE: AgentSchedule = { discoveryHour: 9, weeklyDay: 1, weeklyHour: 8 };

export interface AgentSetting {
  level: AutonomyLevel;
  jobs: Record<AgentJob, boolean>;
  instructions: string;
  /** strategist may enable its own discovery briefs while trailing-7d discovery spend stays under this; 0 = never */
  weeklyDiscoveryUsd: number;
  schedule: AgentSchedule;
  /** the agent mode leads start in when no one on staff chose one */
  newLeadMode: NewLeadModes;
  /** voice notes on WhatsApp (crm/voice.ts, ADR 0048) */
  voice: AgentVoice;
}

const AGENT_SETTING_GROUPS = ['jobs', 'schedule', 'newLeadMode', 'voice'] as const;
type AgentSettingGroup = (typeof AGENT_SETTING_GROUPS)[number];
export type AgentSettingPatch = Partial<Omit<AgentSetting, AgentSettingGroup>> & {
  [K in AgentSettingGroup]?: Partial<AgentSetting[K]>;
};
type AgentSettingUpdate = AgentSettingPatch | ((current: AgentSetting) => AgentSettingPatch);

export interface AgentVoice {
  /** a lead's voice note is answered with one */
  replies: boolean;
  /** the agent may send one on its own, at most once a day per lead */
  proactive: boolean;
  /** the TTS sidecar's voice id; '' = its default */
  speechVoice: string;
}

export const DEFAULT_AGENT_VOICE: AgentVoice = { replies: true, proactive: true, speechVoice: '' };

function settingObject(v: unknown): Record<string, unknown> {
  return (v && typeof v === 'object' && !Array.isArray(v) ? v : {}) as Record<string, unknown>;
}

function voiceOf(v: unknown): AgentVoice {
  const o = settingObject(v);
  return {
    replies: o.replies !== false,
    proactive: o.proactive !== false,
    speechVoice:
      typeof o.speechVoice === 'string' && /^[a-z0-9-]{1,40}$/.test(o.speechVoice)
        ? o.speechVoice
        : '',
  };
}

// Normalizes a stored row: bad/missing fields fall back to defaults so a hand-edited row can't poison policy.
export function normalizeAgent(v: unknown): AgentSetting {
  const o = settingObject(v);
  const j = (o.jobs && typeof o.jobs === 'object' ? o.jobs : {}) as Record<string, unknown>;
  const usd = Number(o.weeklyDiscoveryUsd);
  const sc = (o.schedule && typeof o.schedule === 'object' ? o.schedule : {}) as Record<
    string,
    unknown
  >;
  const int = (v: unknown, max: number, d: number) =>
    typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= max ? v : d;
  return {
    level: AUTONOMY_LEVELS.includes(o.level as AutonomyLevel)
      ? (o.level as AutonomyLevel)
      : o.level === undefined
        ? 'autopilot'
        : 'supervised',
    jobs: Object.fromEntries(AGENT_JOBS.map((k) => [k, j[k] !== false])) as Record<
      AgentJob,
      boolean
    >,
    instructions:
      typeof o.instructions === 'string'
        ? o.instructions.slice(0, AGENT_INSTRUCTIONS_MAX)
        : DEFAULT_INSTRUCTIONS,
    weeklyDiscoveryUsd: Number.isFinite(usd) ? Math.min(50, Math.max(0, usd)) : 0,
    newLeadMode: newLeadModesOf(o),
    voice: voiceOf(o.voice),
    schedule: {
      discoveryHour: int(sc.discoveryHour, 23, DEFAULT_SCHEDULE.discoveryHour),
      weeklyDay: int(sc.weeklyDay, 6, DEFAULT_SCHEDULE.weeklyDay),
      weeklyHour: int(sc.weeklyHour, 23, DEFAULT_SCHEDULE.weeklyHour),
    },
  };
}

export async function agentSettingTx(tx: Sql): Promise<AgentSetting> {
  return normalizeAgent(await getSettingTx<unknown>(tx, 'agent', {}));
}

export async function patchAgentSettingTx(
  tx: Sql,
  update: AgentSettingUpdate,
): Promise<AgentSetting> {
  // Lock the row before deriving a patch, including on a workspace with no stored settings yet.
  await tx`insert into control_settings (key, value) values ('agent', '{}') on conflict do nothing`;
  const [row] = await tx<{ value: unknown }[]>`
    select value from control_settings where key = 'agent' for update
  `;
  const current = settingObject(row?.value);
  const patch = typeof update === 'function' ? update(normalizeAgent(current)) : update;
  validateSetting('agent', patch, { partialAgent: true });
  const next: Record<string, unknown> = { ...current, ...patch };
  for (const key of AGENT_SETTING_GROUPS) {
    if (patch[key]) next[key] = { ...settingObject(current[key]), ...patch[key] };
  }
  await putSettingTx(tx, 'agent', next);
  return normalizeAgent(next);
}

export async function patchAgentSetting(
  sql: Sql,
  update: AgentSettingUpdate,
  idemKey: string,
): Promise<ClaimResult<AgentSetting>> {
  // Keep the saved response shape for Telegram callbacks that an older Core already handled.
  const res = await claimControl(sql, idemKey, async (tx) => ({
    status: 200,
    body: { key: 'agent', value: await patchAgentSettingTx(tx, update) },
  }));
  return { ...res, body: res.body.value };
}

export const RESET_INSTRUCTION_SCOPES = ['all', 'instructions', 'pitch'] as const;
export type ResetInstructionsScope = (typeof RESET_INSTRUCTION_SCOPES)[number];

/**
 * Drops custom `agent.instructions` and/or `pitch` overrides so the sales agent falls back to the
 * built-in defaults (`DEFAULT_INSTRUCTIONS` / `DEFAULT_PITCH`). Leaves autonomy, jobs, schedule,
 * guardrails, agent memory, and leads untouched.
 */
export async function resetAgentInstructions(
  sql: Sql,
  scope: ResetInstructionsScope,
  idemKey: string,
): Promise<ClaimResult<{ scope: ResetInstructionsScope; config: AgentSetting; pitch: Pitch }>> {
  return claimControl(sql, idemKey, async (tx) => {
    if (scope === 'all' || scope === 'instructions') {
      await tx`
        update control_settings
        set value = value - 'instructions'
        where key = 'agent' and value ? 'instructions'
      `;
    }
    if (scope === 'all' || scope === 'pitch') {
      await tx`delete from control_settings where key = 'pitch'`;
    }
    afterCommit(tx, () => emitControlEvent('settings.change'));
    return {
      status: 200,
      body: {
        scope,
        config: await agentSettingTx(tx),
        pitch: await getPitchTx(tx),
      },
    };
  });
}

export type AutomationVerdict = { ok: true } | { ok: false; code: string; reason: string };

const JOB_LABEL: Record<AgentJob, string> = {
  reply: 'responder mensagens',
  outreach: 'prospecção e follow-ups',
  discovery: 'descoberta',
  strategist: 'revisão semanal',
};

// Gate for automation-queued work; staff-triggered runs are never gated by the preset or jobs.
export async function automationAllowedTx(tx: Sql, kind: JobKind): Promise<AutomationVerdict> {
  const a = await agentSettingTx(tx);
  if (a.level === 'off') {
    return { ok: false, code: 'workspace_off', reason: 'autonomia do agente desligada' };
  }
  if (kind !== 'triage' && !a.jobs[kind]) {
    return { ok: false, code: 'job_off', reason: `${JOB_LABEL[kind]} está desligado` };
  }
  return { ok: true };
}

// copilot/off force drafts; supervised drafts first contact; autopilot sends within guardrails.
export function draftDecision(input: {
  level: AutonomyLevel;
  firstContact: boolean;
  leadMode: string;
}): { forceDraft: boolean; code: string | null } {
  if (input.level === 'copilot' || input.level === 'off') {
    return { forceDraft: true, code: 'workspace_copilot' };
  }
  if (input.leadMode === 'draft') return { forceDraft: true, code: 'lead_mode_draft' };
  if (input.level === 'supervised' && input.firstContact) {
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

// Reasons are ordered: the first decides the outcome, the rest are context.
export async function explainAutonomyTx(
  tx: Sql,
  leadId: string,
): Promise<AutonomyExplanation | null> {
  const lead = (
    await tx<
      {
        state: string;
        agent_mode: string;
        archived_at: string | null;
        unsubscribed_at: string | null;
        agent_paused_at: string | null;
        whatsapp: string | null;
        whatsapp_verified: boolean;
        phone: string | null;
        email: string | null;
        email_bounced_at: string | null;
        fit_score: number | null;
        intent_score: number | null;
        discovered_via: string | null;
        spent: number;
        wa_thread: number;
      }[]
    >`
      select l.state, l.agent_mode, l.archived_at, l.unsubscribed_at, l.agent_paused_at,
        l.whatsapp, l.whatsapp_verified, l.phone, l.email, l.email_bounced_at,
        l.fit_score, l.intent_score, l.discovered_via,
        coalesce((select sum(r.cost_cents) from crm_turns r where r.lead_id = l.id), 0)::int as spent,
        (select count(*) from lead_threads t
          where t.lead_id = l.id and t.channel = 'whatsapp' and t.external_id is not null)::int as wa_thread
      from leads l where l.id = ${leadId}
    `
  )[0];
  if (!lead) return null;
  const { level } = await agentSettingTx(tx);
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
  if (phoneIsIgnored(await blockedPhonesTx(tx), lead.whatsapp, lead.phone))
    blockers.push({
      code: 'ignored_phone',
      message: 'número da equipe — o agente não fala com ele',
    });
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
  const ch = await channelAvailabilityTx(tx, leadId);
  const contacted = await leadHasContactTx(tx, leadId);
  let sendMode: AutonomyExplanation['sendMode'];
  if (blockers.length) sendMode = 'blocked';
  else if (!ch.whatsapp.ok && !ch.instagram.ok && !ch.email.ok) {
    sendMode = 'blocked';
    reasons.push({
      code: 'no_channel',
      message: `sem canal utilizável (whatsapp: ${ch.whatsapp.reason}; instagram: ${ch.instagram.reason}; email: ${ch.email.reason})`,
    });
  } else {
    const d = draftDecision({
      level,
      firstContact: !contacted,
      leadMode: lead.agent_mode,
    });
    sendMode = d.forceDraft ? 'draft' : 'auto';
    const msg: Record<string, string> = {
      workspace_copilot: 'modo copiloto — toda mensagem vira rascunho para aprovação',
      lead_mode_draft: 'lead em modo rascunho — mensagens aguardam aprovação',
      first_contact_draft:
        'primeira abordagem (a gente fala primeiro) passa pela fila de aprovação',
    };
    if (d.code) reasons.push({ code: d.code, message: msg[d.code] ?? d.code });
    else
      reasons.push({
        code: level === 'autopilot' ? 'autopilot' : 'supervised',
        message:
          level === 'autopilot'
            ? 'piloto automático — envia dentro dos limites (horário, msgs sem resposta)'
            : 'supervisionado — follow-ups e respostas saem sem aprovação',
      });
    if (lead.state === 'lead' && lead.discovered_via && !contacted) {
      if (!g.discoveryAutoContact) {
        reasons.push({
          code: 'discovery_auto_contact_off',
          message: 'autocontato na descoberta desligado (aguarda disparo manual)',
        });
      } else if (
        !passesAutoContactScore(lead.fit_score, lead.intent_score, g.discoveryContactMinScore)
      ) {
        reasons.push({
          code: 'below_min_score',
          message:
            lead.fit_score == null
              ? 'sem fitScore — autocontato aguarda qualificação'
              : `fit ${lead.fit_score} abaixo do mínimo ${g.discoveryContactMinScore} para autocontato`,
        });
      } else if (lead.whatsapp && !lead.whatsapp_verified && !ch.instagram.ok && !ch.email.ok) {
        reasons.push({
          code: 'whatsapp_unverified',
          message: 'whatsapp derivado do celular ainda não verificado',
        });
      }
    }
  }
  return { level, canRun, sendMode, reasons };
}

// Rolling discovery budget: trailing-7d spend + reservation per unbooked work unit (mean recent
// cost). excludeBriefId drops a brief whose own imminent run is the reservation under test.
// Callers serialize check+write on the 'brief-proposals' advisory — else two passes both see spare cap.
export async function discoveryBudgetTx(
  tx: Sql,
  excludeBriefId?: string,
): Promise<{ capCents: number; spent: number; open: number; est: number }> {
  const { weeklyDiscoveryUsd } = await agentSettingTx(tx);
  const excl = excludeBriefId ?? null;
  const row = (
    await tx<{ spent: number; open: number; est: number }[]>`
      select
        coalesce((select sum(cost_cents) from crm_turns
          where kind = 'discovery' and finished_at > now() - interval '7 days'), 0)::int as spent,
        -- discovery work waiting in a mailbox, plus strategist briefs that never ran
        ((select count(*) from agent_mailbox m join agent_actors a on a.id = m.actor_id
           where a.tenant_id = ${PLATFORM_TENANT_ID} and a.agent_id = 'crm-discovery' and m.consumed_by_turn is null)
         + (select count(*) from discovery_briefs d
            where d.created_by = 'strategist' and d.enabled
              and d.created_at > now() - interval '7 days'
              and (${excl}::uuid is null or d.id <> ${excl}::uuid)
              and not exists (select 1 from crm_turns r where r.brief_id = d.id)
              and not exists (
                select 1 from agent_mailbox m join agent_actors a on a.id = m.actor_id
                where a.tenant_id = ${PLATFORM_TENANT_ID} and a.agent_id = 'crm-discovery' and a.subject_id = d.id::text
                  and m.consumed_by_turn is null)))::int as open,
        -- exclude zero-cost runs: they'd deflate the unit estimate to 0
        coalesce((select avg(c)::int from (
          select cost_cents as c from crm_turns
          where kind = 'discovery' and status = 'done' and cost_cents > 0
          order by finished_at desc limit 20) t), 50)::int as est
    `
  )[0]!;
  return { capCents: Math.round(weeklyDiscoveryUsd * 100), ...row };
}
