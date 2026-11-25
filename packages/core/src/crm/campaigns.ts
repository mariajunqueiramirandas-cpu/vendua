import { randomUUID } from 'node:crypto';
import type { JsonObject } from '@vendua/agent-runtime';
import type { Sql } from '../platform/db.ts';
import { afterCommit } from '../platform/db.ts';
import { HttpError, UUID_RE } from '../platform/http.ts';
import { PLATFORM_TENANT_ID } from '../platform/tenancy.ts';
import { claimControl, controlTx } from '../modules/control.ts';
import { emitControlEvent } from '../modules/control-events.ts';
import {
  DEFAULT_GUARDRAILS,
  getSettingTx,
  putSettingTx,
  validateSetting,
  type Guardrails,
} from '../modules/integrations.ts';
import { recordStaffEventTx } from '../modules/staff-events.ts';
import { CRM_CAMPAIGN_ID, CAMPAIGN_SUBJECT, requestCampaignTx } from './dispatch.ts';
import {
  emailReadyTx,
  instagramColdBudgetTx,
  instagramReadyTx,
  sendWindowOpenAtTx,
  whatsappColdBudgetTx,
  whatsappReadyTx,
} from './guardrails.ts';
import { agentSettingTx, type AutonomyLevel } from './policy.ts';
import { crmOfferTx } from './signup.ts';

// Autonomous Campaign Mode (`crm-campaign` actor on Agent Runtime v3):
// Durable goal-driven sales campaigns with code-enforced budget/time/pacing guardrails,
// WIP-aware cadence, event-driven win hooks (signup/meeting/reply), and living Telegram cards.

export const CAMPAIGN_GOAL_KINDS = ['signup', 'meeting', 'reply'] as const;
export type CampaignGoalKind = (typeof CAMPAIGN_GOAL_KINDS)[number];

export const CAMPAIGN_SCOPES = ['any', 'campaign_only'] as const;
export type CampaignScope = (typeof CAMPAIGN_SCOPES)[number];

export const CAMPAIGN_STATUSES = ['active', 'paused', 'won', 'stopped', 'exhausted'] as const;
export type CampaignStatus = (typeof CAMPAIGN_STATUSES)[number];

export const MAX_ACTIVE_CAMPAIGNS = 3;
export const DEFAULT_CAMPAIGN_BUDGET_USD = 20;
export const DEFAULT_CAMPAIGN_MAX_DAYS = 7;
export const DEFAULT_CAMPAIGN_MAX_HUNTS_PER_DAY = 3;
export const DEFAULT_CAMPAIGN_TARGET_WIP = 15;
export const DEFAULT_CAMPAIGN_CHECK_INTERVAL_MIN = 180;

export interface CampaignRow {
  id: string;
  title: string;
  objective: string;
  goal_kind: CampaignGoalKind;
  goal_target: number;
  goal_progress: number;
  goal_scope: CampaignScope;
  status: CampaignStatus;
  stop_reason: string | null;
  focus_segment: string | null;
  focus_city: string | null;
  playbook: string;
  budget_cents: number;
  spent_cents: number;
  max_days: number;
  expires_at: Date;
  max_hunts_per_day: number;
  target_wip: number;
  check_interval_min: number;
  allow_existing_leads: boolean;
  created_by: string;
  chat_id: string | null;
  hunts_launched: number;
  leads_enrolled: number;
  last_tick_at: Date | null;
  next_tick_at: Date | null;
  last_progress_report_at: Date | null;
  won_at: Date | null;
  ended_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

export interface CampaignHuntRow {
  id: string;
  campaign_id: string;
  hunt_subject_id: string;
  query: string;
  segment: string | null;
  city: string | null;
  target: number | null;
  status: 'queued' | 'done' | 'failed';
  turn_id: string | null;
  leads_created: number;
  cost_cents: number;
  created_at: Date;
  finished_at: Date | null;
}

export interface CampaignPreflight {
  autonomyLevel: AutonomyLevel;
  signupOpen: boolean;
  channels: {
    whatsapp: boolean;
    instagram: boolean;
    email: boolean;
    any: boolean;
  };
  researchReady: boolean;
  whatsappColdRemaining: number | null;
  whatsappColdCap: number;
  instagramColdRemaining: number;
  instagramColdCap: number;
  activeCampaigns: number;
  warnings: string[];
}

export interface CampaignScoreboard {
  campaign: CampaignRow;
  spentCents: number;
  remainingBudgetCents: number;
  hoursRemaining: number;
  huntsTotal: number;
  huntsLast24h: number;
  huntsQueued: number;
  recentHunts: CampaignHuntRow[];
  wip: {
    enrolledTotal: number;
    uncontacted: number;
    awaitingReply: number;
    activeConversations: number;
    coldOrExhausted: number;
    pendingDrafts: number;
    openHandoffs: number;
    activeWip: number;
    conversions: number;
  };
  untouchedCrmPool: number;
  health: {
    autonomyLevel: AutonomyLevel;
    signupOpen: boolean;
    whatsappReady: boolean;
    instagramReady: boolean;
    emailReady: boolean;
    researchReady: boolean;
    whatsappColdRemaining: number | null;
    whatsappColdNextSlotAt: Date | null;
    instagramColdRemaining: number;
    instagramColdNextSlotAt: Date | null;
    inQuietHours: boolean;
    nextSendWindowAt: Date;
  };
}

export interface StartCampaignInput {
  title: string;
  objective: string;
  goalKind?: CampaignGoalKind | undefined;
  goalTarget?: number | undefined;
  goalScope?: CampaignScope | undefined;
  budgetUsd?: number | undefined;
  maxDays?: number | undefined;
  maxHuntsPerDay?: number | undefined;
  targetWip?: number | undefined;
  checkIntervalMin?: number | undefined;
  focusSegment?: string | null | undefined;
  focusCity?: string | null | undefined;
  allowExistingLeads?: boolean | undefined;
  /** When explicitly confirmed by staff, switches global autonomy to autopilot + enables reply/outreach/discovery. */
  enableAutopilot?: boolean | undefined;
  by: string;
  chatId?: string | null | undefined;
  idemKey: string;
}

export function goalKindLabel(kind: CampaignGoalKind, count = 1): string {
  if (kind === 'signup') return count === 1 ? 'cadastro' : 'cadastros';
  if (kind === 'meeting') return count === 1 ? 'reunião' : 'reuniões';
  return count === 1 ? 'resposta' : 'respostas';
}

function clampInt(v: number | undefined, fallback: number, min: number, max: number): number {
  if (v === undefined || !Number.isFinite(v)) return fallback;
  return Math.min(max, Math.max(min, Math.round(v)));
}

function assertUuid(id: string): string {
  if (!UUID_RE.test(id)) throw new HttpError(400, 'BAD_ID', 'campaignId inválido');
  return id;
}

/** Checks workspace readiness before launching or ticking a campaign. */
export async function preflightCampaignTx(
  tx: Sql,
  goalKind: CampaignGoalKind = 'signup',
): Promise<CampaignPreflight> {
  const [agent, rawG, offer, waReady, igReady, emailReady, activeRow] = await Promise.all([
    agentSettingTx(tx),
    getSettingTx<Partial<Guardrails>>(tx, 'guardrails', {}),
    crmOfferTx(tx),
    whatsappReadyTx(tx),
    instagramReadyTx(tx),
    emailReadyTx(tx),
    tx<{ n: number }[]>`select count(*)::int as n from crm_campaigns where status = 'active'`,
  ]);
  const g: Guardrails = { ...DEFAULT_GUARDRAILS, ...rawG };
  const waBudget = waReady
    ? await whatsappColdBudgetTx(tx, g)
    : { cap: g.whatsappColdPerDay, used: 0, remaining: 0, nextSlotAt: null };
  const igBudget =
    igReady && g.instagramColdDmsPerDay > 0
      ? await instagramColdBudgetTx(tx, g)
      : { remaining: 0, nextSlotAt: null };
  const { discoveryUnavailable } = await import('./channels/discovery.ts');
  const discWhy = await discoveryUnavailable(tx, false);
  const researchReady = !discWhy || Boolean(process.env.MONID_API_KEY);
  const anyChannel = waReady || (igReady && g.instagramColdDmsPerDay > 0) || emailReady;
  const warnings: string[] = [];

  if (agent.level === 'off') {
    warnings.push('autonomia global está desligada (precisa ligar para a campanha enviar)');
  } else if (agent.level === 'copilot') {
    warnings.push('autonomia está em copiloto (mensagens viram rascunho até você aprovar)');
  } else if (agent.level === 'supervised') {
    warnings.push('autonomia está em supervisionado (primeiros contatos pedem aprovação)');
  }
  if (goalKind === 'signup' && !offer.signupOpen) {
    warnings.push('cadastro online está fechado agora (Config → Cadastro)');
  }
  if (!anyChannel) {
    warnings.push('nenhum canal de envio conectado (WhatsApp, Instagram ou email)');
  }
  if (!researchReady) {
    warnings.push('nenhuma ferramenta de pesquisa configurada para novas descobertas');
  }
  const activeCampaigns = activeRow[0]?.n ?? 0;
  if (activeCampaigns >= MAX_ACTIVE_CAMPAIGNS) {
    warnings.push(
      `já existem ${activeCampaigns} campanhas ativas (limite: ${MAX_ACTIVE_CAMPAIGNS})`,
    );
  }

  return {
    autonomyLevel: agent.level,
    signupOpen: offer.signupOpen,
    channels: { whatsapp: waReady, instagram: igReady, email: emailReady, any: anyChannel },
    researchReady,
    whatsappColdRemaining: waBudget.remaining,
    whatsappColdCap: g.whatsappColdPerDay,
    instagramColdRemaining: igBudget.remaining,
    instagramColdCap: g.instagramColdDmsPerDay,
    activeCampaigns,
    warnings,
  };
}

/** Deletes any pending heartbeat timer for this campaign actor. */
export async function dropCampaignTicksTx(tx: Sql, campaignId: string): Promise<void> {
  await tx`
    delete from agent_mailbox m using agent_actors a
    where a.id = m.actor_id
      and a.tenant_id = ${PLATFORM_TENANT_ID}
      and a.agent_id = ${CRM_CAMPAIGN_ID}
      and a.subject_kind = ${CAMPAIGN_SUBJECT}
      and a.subject_id = ${campaignId}
      and m.kind = 'timer.campaign_tick'
      and m.consumed_by_turn is null
  `;
  await tx`
    update crm_campaigns set next_tick_at = null, updated_at = now()
    where id = ${campaignId}
  `;
}

/** Replaces any pending heartbeat with one new `timer.campaign_tick`, shifted past quiet hours. */
export async function scheduleCampaignTickTx(
  tx: Sql,
  input: {
    campaignId: string;
    at: Date;
    reason: string;
    source: string;
    dedupeSuffix: string;
  },
): Promise<{ deliverAt: Date; mailboxId: string | null }> {
  const rawG = await getSettingTx<Partial<Guardrails>>(tx, 'guardrails', {});
  const g: Guardrails = { ...DEFAULT_GUARDRAILS, ...rawG };
  const open = await sendWindowOpenAtTx(tx, g, input.at);
  const deliverAt = open.getTime() > input.at.getTime() ? open : input.at;

  await dropCampaignTicksTx(tx, input.campaignId);
  const d = await requestCampaignTx(tx, {
    campaignId: input.campaignId,
    kind: 'timer.campaign_tick',
    source: input.source,
    dedupeKey: `crm:campaign:tick:${input.campaignId}:${input.dedupeSuffix}`.slice(0, 200),
    at: deliverAt,
    payload: { reason: input.reason.slice(0, 400) } as JsonObject,
  });
  await tx`
    update crm_campaigns set next_tick_at = ${deliverAt}, updated_at = now()
    where id = ${input.campaignId}
  `;
  return { deliverAt, mailboxId: d.mailboxId };
}

/** Starts a new autonomous goal-driven campaign and dispatches its first director turn. */
export async function startCampaign(
  sql: Sql,
  input: StartCampaignInput,
): Promise<{ campaign: CampaignRow; mailboxId: string | null; replayed: boolean }> {
  const title = input.title.trim().slice(0, 160);
  const objective = input.objective.trim().slice(0, 2000);
  if (!title) throw new HttpError(422, 'BAD_REQUEST', 'título da campanha obrigatório');
  if (!objective) throw new HttpError(422, 'BAD_REQUEST', 'objetivo da campanha obrigatório');

  const goalKind: CampaignGoalKind = CAMPAIGN_GOAL_KINDS.includes(
    input.goalKind as CampaignGoalKind,
  )
    ? (input.goalKind as CampaignGoalKind)
    : 'signup';
  const goalScope: CampaignScope = CAMPAIGN_SCOPES.includes(input.goalScope as CampaignScope)
    ? (input.goalScope as CampaignScope)
    : 'any';
  const goalTarget = clampInt(input.goalTarget, 1, 1, 100);
  const budgetUsd =
    input.budgetUsd !== undefined && Number.isFinite(input.budgetUsd)
      ? Math.min(1000, Math.max(1, input.budgetUsd))
      : DEFAULT_CAMPAIGN_BUDGET_USD;
  const budgetCents = Math.round(budgetUsd * 100);
  const maxDays = clampInt(input.maxDays, DEFAULT_CAMPAIGN_MAX_DAYS, 1, 60);
  const maxHuntsPerDay = clampInt(input.maxHuntsPerDay, DEFAULT_CAMPAIGN_MAX_HUNTS_PER_DAY, 1, 12);
  const targetWip = clampInt(input.targetWip, DEFAULT_CAMPAIGN_TARGET_WIP, 3, 80);
  const checkIntervalMin = clampInt(
    input.checkIntervalMin,
    DEFAULT_CAMPAIGN_CHECK_INTERVAL_MIN,
    15,
    1440,
  );
  const focusSegment = input.focusSegment?.trim().slice(0, 120) || null;
  const focusCity = input.focusCity?.trim().slice(0, 120) || null;
  const allowExistingLeads = input.allowExistingLeads !== false;
  const by = input.by.trim().slice(0, 120) || 'equipe';
  const chatId = input.chatId?.trim().slice(0, 32) || null;

  const res = await claimControl(sql, input.idemKey, async (tx) => {
    const [active] = await tx<{ n: number }[]>`
      select count(*)::int as n from crm_campaigns where status = 'active'
    `;
    if ((active?.n ?? 0) >= MAX_ACTIVE_CAMPAIGNS) {
      throw new HttpError(
        409,
        'CAMPAIGN_LIMIT',
        `já existem ${MAX_ACTIVE_CAMPAIGNS} campanhas ativas — pause ou encerre uma antes`,
      );
    }

    if (input.enableAutopilot) {
      const cur = await agentSettingTx(tx);
      const next = {
        ...cur,
        level: 'autopilot' as AutonomyLevel,
        jobs: { ...cur.jobs, reply: true, outreach: true, discovery: true },
      };
      validateSetting('agent', next);
      await putSettingTx(tx, 'agent', next);
    }

    const expiresAt = new Date(Date.now() + maxDays * 86_400_000);
    const [row] = await tx<CampaignRow[]>`
      insert into crm_campaigns (
        title, objective, goal_kind, goal_target, goal_scope,
        focus_segment, focus_city, budget_cents, max_days, expires_at,
        max_hunts_per_day, target_wip, check_interval_min, allow_existing_leads,
        created_by, chat_id
      )
      values (
        ${title}, ${objective}, ${goalKind}, ${goalTarget}, ${goalScope},
        ${focusSegment}, ${focusCity}, ${budgetCents}, ${maxDays}, ${expiresAt},
        ${maxHuntsPerDay}, ${targetWip}, ${checkIntervalMin}, ${allowExistingLeads},
        ${by}, ${chatId}
      )
      returning *
    `;
    const campaign = row!;

    await recordStaffEventTx(
      tx,
      'campaign.started',
      {
        campaignId: campaign.id,
        title: campaign.title,
        objective: campaign.objective,
        goalKind: campaign.goal_kind,
        goalTarget: campaign.goal_target,
        budgetCents: campaign.budget_cents,
        maxDays: campaign.max_days,
        by: campaign.created_by,
        focusSegment: campaign.focus_segment,
        focusCity: campaign.focus_city,
      },
      { dedupeKey: `campaign.started:${campaign.id}` },
    );

    const d = await requestCampaignTx(tx, {
      campaignId: campaign.id,
      kind: 'campaign.started',
      source: `staff:${by}`,
      dedupeKey: `crm:campaign:start:${campaign.id}`,
      payload: { by } as JsonObject,
    });

    return { status: 201, body: { campaign, mailboxId: d.mailboxId } };
  });

  if (!res.replayed && res.body.mailboxId) emitControlEvent('run.update', res.body.mailboxId);
  return { ...res.body, replayed: res.replayed };
}

/** Pauses an active campaign and clears pending heartbeat timers. */
export async function pauseCampaign(
  sql: Sql,
  input: { campaignId: string; reason?: string | null; by: string; idemKey: string },
): Promise<{ campaign: CampaignRow; replayed: boolean }> {
  const id = assertUuid(input.campaignId);
  const by = input.by.trim().slice(0, 120) || 'equipe';
  const reason = input.reason?.trim().slice(0, 400) || `pausada por ${by}`;

  const res = await claimControl(sql, input.idemKey, async (tx) => {
    const [cur] = await tx<CampaignRow[]>`
      select * from crm_campaigns where id = ${id} for update
    `;
    if (!cur) throw new HttpError(404, 'CAMPAIGN_NOT_FOUND', 'essa campanha não existe mais');
    if (cur.status === 'won' || cur.status === 'stopped') {
      throw new HttpError(409, 'CAMPAIGN_ENDED', 'essa campanha já foi encerrada');
    }
    await dropCampaignTicksTx(tx, id);
    const [updated] = await tx<CampaignRow[]>`
      update crm_campaigns
      set status = 'paused', stop_reason = ${reason}, next_tick_at = null, updated_at = now()
      where id = ${id}
      returning *
    `;
    await recordStaffEventTx(tx, 'campaign.updated', {
      campaignId: updated!.id,
      title: updated!.title,
      status: 'paused',
      goalKind: updated!.goal_kind,
      goalTarget: updated!.goal_target,
      goalProgress: updated!.goal_progress,
      spentCents: updated!.spent_cents,
      budgetCents: updated!.budget_cents,
      hunts: updated!.hunts_launched,
      leads: updated!.leads_enrolled,
      reason,
      by,
    });
    return { status: 200, body: { campaign: updated! } };
  });
  return { ...res.body, replayed: res.replayed };
}

/** Resumes a paused or exhausted campaign (optionally extending time or adding budget). */
export async function resumeCampaign(
  sql: Sql,
  input: {
    campaignId: string;
    by: string;
    extraBudgetUsd?: number | undefined;
    extendDays?: number | undefined;
    idemKey: string;
  },
): Promise<{ campaign: CampaignRow; mailboxId: string | null; replayed: boolean }> {
  const id = assertUuid(input.campaignId);
  const by = input.by.trim().slice(0, 120) || 'equipe';

  const res = await claimControl(sql, input.idemKey, async (tx) => {
    const [cur] = await tx<CampaignRow[]>`
      select * from crm_campaigns where id = ${id} for update
    `;
    if (!cur) throw new HttpError(404, 'CAMPAIGN_NOT_FOUND', 'essa campanha não existe mais');
    if (cur.status === 'won' || cur.status === 'stopped') {
      throw new HttpError(409, 'CAMPAIGN_ENDED', 'essa campanha já foi encerrada');
    }
    const [active] = await tx<{ n: number }[]>`
      select count(*)::int as n from crm_campaigns where status = 'active' and id <> ${id}
    `;
    if ((active?.n ?? 0) >= MAX_ACTIVE_CAMPAIGNS) {
      throw new HttpError(
        409,
        'CAMPAIGN_LIMIT',
        `já existem ${MAX_ACTIVE_CAMPAIGNS} campanhas ativas — pause ou encerre uma antes`,
      );
    }

    const addCents =
      input.extraBudgetUsd && Number.isFinite(input.extraBudgetUsd) && input.extraBudgetUsd > 0
        ? Math.round(input.extraBudgetUsd * 100)
        : 0;
    const nextBudget = Math.min(100_000, cur.budget_cents + addCents);
    if (cur.spent_cents >= nextBudget) {
      throw new HttpError(
        422,
        'CAMPAIGN_BUDGET_EXHAUSTED',
        'orçamento esgotado — adicione orçamento para retomar a campanha',
      );
    }

    const baseExpiry = new Date(cur.expires_at);
    const now = Date.now();
    const extraDays = input.extendDays ? clampInt(input.extendDays, 0, 1, 30) : 0;
    let nextExpiry = baseExpiry;
    if (extraDays > 0) {
      nextExpiry = new Date(Math.max(baseExpiry.getTime(), now) + extraDays * 86_400_000);
    } else if (baseExpiry.getTime() <= now) {
      // Auto-extend by 3 days when explicitly resumed past expiry
      nextExpiry = new Date(now + 3 * 86_400_000);
    }

    const [updated] = await tx<CampaignRow[]>`
      update crm_campaigns
      set status = 'active', stop_reason = null, ended_at = null,
          budget_cents = ${nextBudget}, expires_at = ${nextExpiry}, updated_at = now()
      where id = ${id}
      returning *
    `;

    const reason =
      addCents > 0 ? `retomada com +US$ ${(addCents / 100).toFixed(2)}` : `retomada por ${by}`;

    await recordStaffEventTx(tx, 'campaign.updated', {
      campaignId: updated!.id,
      title: updated!.title,
      status: 'active',
      goalKind: updated!.goal_kind,
      goalTarget: updated!.goal_target,
      goalProgress: updated!.goal_progress,
      spentCents: updated!.spent_cents,
      budgetCents: updated!.budget_cents,
      hunts: updated!.hunts_launched,
      leads: updated!.leads_enrolled,
      reason,
      by,
    });

    const d = await requestCampaignTx(tx, {
      campaignId: id,
      kind: 'campaign.resumed',
      source: `staff:${by}`,
      dedupeKey: `crm:campaign:resume:${id}:${input.idemKey}`,
      payload: { by, reason } as JsonObject,
    });
    return { status: 200, body: { campaign: updated!, mailboxId: d.mailboxId } };
  });

  if (!res.replayed && res.body.mailboxId) emitControlEvent('run.update', res.body.mailboxId);
  return { ...res.body, replayed: res.replayed };
}

/** Permanently stops a campaign and drops pending ticks. */
export async function stopCampaign(
  sql: Sql,
  input: { campaignId: string; reason?: string | null; by: string; idemKey: string },
): Promise<{ campaign: CampaignRow; replayed: boolean }> {
  const id = assertUuid(input.campaignId);
  const by = input.by.trim().slice(0, 120) || 'equipe';
  const reason = input.reason?.trim().slice(0, 400) || `encerrada por ${by}`;

  const res = await claimControl(sql, input.idemKey, async (tx) => {
    const [cur] = await tx<CampaignRow[]>`
      select * from crm_campaigns where id = ${id} for update
    `;
    if (!cur) throw new HttpError(404, 'CAMPAIGN_NOT_FOUND', 'essa campanha não existe mais');
    if (cur.status === 'won' || cur.status === 'stopped') {
      return { status: 200, body: { campaign: cur } };
    }
    await dropCampaignTicksTx(tx, id);
    const [updated] = await tx<CampaignRow[]>`
      update crm_campaigns
      set status = 'stopped', stop_reason = ${reason}, ended_at = now(), next_tick_at = null, updated_at = now()
      where id = ${id}
      returning *
    `;
    await recordStaffEventTx(tx, 'campaign.ended', {
      campaignId: updated!.id,
      title: updated!.title,
      status: 'stopped',
      goalKind: updated!.goal_kind,
      goalTarget: updated!.goal_target,
      goalProgress: updated!.goal_progress,
      spentCents: updated!.spent_cents,
      budgetCents: updated!.budget_cents,
      hunts: updated!.hunts_launched,
      leads: updated!.leads_enrolled,
      reason,
      by,
    });
    return { status: 200, body: { campaign: updated! } };
  });
  return { ...res.body, replayed: res.replayed };
}

/** Adds budget to a campaign; automatically resumes if it was exhausted or paused on budget. */
export async function bumpCampaignBudget(
  sql: Sql,
  input: { campaignId: string; addUsd: number; by: string; idemKey: string },
): Promise<{
  campaign: CampaignRow;
  resumed: boolean;
  mailboxId: string | null;
  replayed: boolean;
}> {
  const id = assertUuid(input.campaignId);
  const by = input.by.trim().slice(0, 120) || 'equipe';
  if (!Number.isFinite(input.addUsd) || input.addUsd < 1 || input.addUsd > 200) {
    throw new HttpError(422, 'BAD_REQUEST', 'valor adicional deve estar entre US$ 1 e US$ 200');
  }
  const addCents = Math.round(input.addUsd * 100);

  const res = await claimControl(sql, input.idemKey, async (tx) => {
    const [cur] = await tx<CampaignRow[]>`
      select * from crm_campaigns where id = ${id} for update
    `;
    if (!cur) throw new HttpError(404, 'CAMPAIGN_NOT_FOUND', 'essa campanha não existe mais');
    if (cur.status === 'won' || cur.status === 'stopped') {
      throw new HttpError(409, 'CAMPAIGN_ENDED', 'essa campanha já foi encerrada');
    }
    const nextBudget = Math.min(100_000, cur.budget_cents + addCents);
    const wantsResume = cur.status === 'exhausted' || cur.status === 'paused';
    let shouldResume = wantsResume && cur.spent_cents < nextBudget;
    if (shouldResume) {
      const [active] = await tx<{ n: number }[]>`
        select count(*)::int as n from crm_campaigns where status = 'active' and id <> ${id}
      `;
      if ((active?.n ?? 0) >= MAX_ACTIVE_CAMPAIGNS) shouldResume = false;
    }
    const nextExpiry =
      shouldResume && new Date(cur.expires_at).getTime() <= Date.now()
        ? new Date(Date.now() + 3 * 86_400_000)
        : cur.expires_at;

    const [updated] = await tx<CampaignRow[]>`
      update crm_campaigns
      set budget_cents = ${nextBudget},
          status = ${shouldResume ? 'active' : cur.status},
          stop_reason = ${shouldResume ? null : cur.stop_reason},
          ended_at = ${shouldResume ? null : cur.ended_at},
          expires_at = ${nextExpiry},
          updated_at = now()
      where id = ${id}
      returning *
    `;

    const reason = `+US$ ${(addCents / 100).toFixed(2)} (novo teto US$ ${(nextBudget / 100).toFixed(2)})${shouldResume ? ' — retomada' : ''}`;
    await recordStaffEventTx(tx, 'campaign.updated', {
      campaignId: updated!.id,
      title: updated!.title,
      status: updated!.status === 'active' ? 'active' : 'paused',
      goalKind: updated!.goal_kind,
      goalTarget: updated!.goal_target,
      goalProgress: updated!.goal_progress,
      spentCents: updated!.spent_cents,
      budgetCents: updated!.budget_cents,
      hunts: updated!.hunts_launched,
      leads: updated!.leads_enrolled,
      reason,
      by,
    });

    let mailboxId: string | null = null;
    if (updated!.status === 'active') {
      const d = await requestCampaignTx(tx, {
        campaignId: id,
        kind: shouldResume ? 'campaign.resumed' : 'staff.request',
        source: `staff:${by}`,
        dedupeKey: `crm:campaign:bump:${id}:${input.idemKey}`,
        payload: {
          by,
          guidance: `Orçamento ampliado em +US$ ${(addCents / 100).toFixed(2)}.`,
        } as JsonObject,
      });
      mailboxId = d.mailboxId;
    }
    return { status: 200, body: { campaign: updated!, resumed: shouldResume, mailboxId } };
  });

  if (!res.replayed && res.body.mailboxId) emitControlEvent('run.update', res.body.mailboxId);
  return { ...res.body, replayed: res.replayed };
}

/** Sends live steering/coaching guidance to a campaign director and wakes it immediately. */
export async function guideCampaign(
  sql: Sql,
  input: { campaignId: string; guidance: string; by: string; idemKey: string },
): Promise<{ campaign: CampaignRow; mailboxId: string | null; replayed: boolean }> {
  const id = assertUuid(input.campaignId);
  const by = input.by.trim().slice(0, 120) || 'equipe';
  const guidance = input.guidance.trim().slice(0, 1500);
  if (!guidance) throw new HttpError(422, 'BAD_REQUEST', 'orientação vazia');

  const res = await claimControl(sql, input.idemKey, async (tx) => {
    const [cur] = await tx<CampaignRow[]>`
      select * from crm_campaigns where id = ${id} for update
    `;
    if (!cur) throw new HttpError(404, 'CAMPAIGN_NOT_FOUND', 'essa campanha não existe mais');
    if (cur.status === 'won' || cur.status === 'stopped') {
      throw new HttpError(409, 'CAMPAIGN_ENDED', 'essa campanha já foi encerrada');
    }
    if (cur.status === 'exhausted') {
      throw new HttpError(
        409,
        'CAMPAIGN_BUDGET_EXHAUSTED',
        'essa campanha atingiu o limite — adicione orçamento ou retome antes de orientar',
      );
    }

    let autoResume = false;
    if (
      cur.status === 'paused' &&
      cur.spent_cents < cur.budget_cents &&
      new Date(cur.expires_at).getTime() > Date.now()
    ) {
      const [active] = await tx<{ n: number }[]>`
        select count(*)::int as n from crm_campaigns where status = 'active' and id <> ${id}
      `;
      if ((active?.n ?? 0) < MAX_ACTIVE_CAMPAIGNS) autoResume = true;
    }

    const noteLine = `[orientação de ${by}]: ${guidance}`;
    const nextPlaybook = cur.playbook
      ? `${cur.playbook}\n${noteLine}`.slice(-4000)
      : noteLine.slice(0, 4000);

    const [updated] = await tx<CampaignRow[]>`
      update crm_campaigns
      set playbook = ${nextPlaybook},
          status = ${autoResume ? 'active' : cur.status},
          stop_reason = ${autoResume ? null : cur.stop_reason},
          updated_at = now()
      where id = ${id}
      returning *
    `;

    if (autoResume) {
      await recordStaffEventTx(tx, 'campaign.updated', {
        campaignId: updated!.id,
        title: updated!.title,
        status: 'active',
        goalKind: updated!.goal_kind,
        goalTarget: updated!.goal_target,
        goalProgress: updated!.goal_progress,
        spentCents: updated!.spent_cents,
        budgetCents: updated!.budget_cents,
        hunts: updated!.hunts_launched,
        leads: updated!.leads_enrolled,
        reason: `orientação de ${by} — retomada`,
        by,
      });
    }

    let mailboxId: string | null = null;
    if (updated!.status === 'active') {
      const d = await requestCampaignTx(tx, {
        campaignId: id,
        kind: 'staff.request',
        source: `staff:${by}`,
        dedupeKey: `crm:campaign:guide:${id}:${input.idemKey}`,
        payload: { by, guidance } as JsonObject,
      });
      mailboxId = d.mailboxId;
    }
    return { status: 200, body: { campaign: updated!, mailboxId } };
  });

  if (!res.replayed && res.body.mailboxId) emitControlEvent('run.update', res.body.mailboxId);
  return { ...res.body, replayed: res.replayed };
}

/** Enrolls a lead in a campaign (idempotent) and updates the enrolled count. */
export async function enrollCampaignLeadTx(
  tx: Sql,
  input: {
    campaignId: string;
    leadId: string;
    origin: 'discovered' | 'revived' | 'matched';
    huntTurnId?: string | null;
    note?: string | null;
  },
): Promise<boolean> {
  if (!UUID_RE.test(input.campaignId) || !UUID_RE.test(input.leadId)) return false;
  const inserted = await tx<{ lead_id: string }[]>`
    insert into crm_campaign_leads (campaign_id, lead_id, origin, hunt_turn_id, note)
    select c.id, l.id, ${input.origin}, ${input.huntTurnId ?? null}::uuid, ${input.note?.slice(0, 400) ?? null}
    from crm_campaigns c, leads l
    where c.id = ${input.campaignId} and l.id = ${input.leadId}
    on conflict (campaign_id, lead_id) do nothing
    returning lead_id
  `;
  if (!inserted.length) return false;
  await tx`
    update crm_campaigns
    set leads_enrolled = (select count(*)::int from crm_campaign_leads where campaign_id = ${input.campaignId}),
        updated_at = now()
    where id = ${input.campaignId}
  `;
  return true;
}

/** Computes the ground-truth live scoreboard for one campaign. */
export async function campaignMetricsTx(
  tx: Sql,
  campaignId: string,
): Promise<CampaignScoreboard | null> {
  const [campaign] = await tx<CampaignRow[]>`
    select * from crm_campaigns where id = ${campaignId}
  `;
  if (!campaign) return null;

  const [rawG, agent, offer, waReady, igReady, emailReady, spendRow, hunts, wipRow, poolRow] =
    await Promise.all([
      getSettingTx<Partial<Guardrails>>(tx, 'guardrails', {}),
      agentSettingTx(tx),
      crmOfferTx(tx),
      whatsappReadyTx(tx),
      instagramReadyTx(tx),
      emailReadyTx(tx),
      tx<{ spent: number }[]>`
      select coalesce(sum(cost_cents), 0)::int as spent
      from crm_turns where campaign_id = ${campaignId}
    `,
      tx<CampaignHuntRow[]>`
      select * from crm_campaign_hunts
      where campaign_id = ${campaignId}
      order by created_at desc limit 15
    `,
      tx<
        {
          enrolled_total: number;
          uncontacted: number;
          awaiting_reply: number;
          active_conversations: number;
          cold_or_exhausted: number;
          pending_drafts: number;
          open_handoffs: number;
          conversions: number;
        }[]
      >`
      with enrolled as (
        select cl.lead_id, cl.converted_at,
               l.state, l.archived_at, l.unsubscribed_at, l.agent_paused_at, l.tenant_id,
               (select count(*)::int from lead_messages m join lead_threads t on t.id = m.thread_id
                where t.lead_id = cl.lead_id and t.channel <> 'manual' and m.direction = 'out'
                  and m.status in ('queued', 'sending', 'sent', 'delivered')) as out_count,
               (select max(m.created_at) from lead_messages m join lead_threads t on t.id = m.thread_id
                where t.lead_id = cl.lead_id and t.channel <> 'manual' and m.direction = 'out'
                  and m.status in ('queued', 'sending', 'sent', 'delivered')) as last_out_at,
               (select count(*)::int from lead_messages m join lead_threads t on t.id = m.thread_id
                where t.lead_id = cl.lead_id and m.direction = 'in'
                  and not m.historical and not m.auto_reply
                  and m.created_at >= cl.enrolled_at) as in_count,
               (select max(m.created_at) from lead_messages m join lead_threads t on t.id = m.thread_id
                where t.lead_id = cl.lead_id and m.direction = 'in'
                  and not m.historical and not m.auto_reply
                  and m.created_at >= cl.enrolled_at) as last_in_at,
               (select count(*)::int from lead_messages m join lead_threads t on t.id = m.thread_id
                where t.lead_id = cl.lead_id and m.status = 'draft') as draft_count,
               (select count(*)::int from lead_tasks tk
                where tk.lead_id = cl.lead_id and tk.done_at is null and tk.title like '[humano]%') as handoff_count
        from crm_campaign_leads cl
        join leads l on l.id = cl.lead_id
        where cl.campaign_id = ${campaignId}
      )
      select
        count(*)::int as enrolled_total,
        count(*) filter (
          where converted_at is null and tenant_id is null and archived_at is null
            and unsubscribed_at is null and agent_paused_at is null
            and out_count = 0 and in_count = 0
        )::int as uncontacted,
        count(*) filter (
          where converted_at is null and tenant_id is null and archived_at is null
            and unsubscribed_at is null and agent_paused_at is null
            and out_count > 0 and in_count = 0
            and last_out_at > now() - interval '72 hours'
        )::int as awaiting_reply,
        count(*) filter (
          where converted_at is null and tenant_id is null and archived_at is null
            and unsubscribed_at is null
            and in_count > 0 and last_in_at > now() - interval '7 days'
        )::int as active_conversations,
        count(*) filter (
          where converted_at is null and tenant_id is null and (
            archived_at is not null or unsubscribed_at is not null
            or (out_count > 0 and in_count = 0 and (last_out_at is null or last_out_at <= now() - interval '72 hours'))
          )
        )::int as cold_or_exhausted,
        coalesce(sum(draft_count), 0)::int as pending_drafts,
        coalesce(sum(handoff_count), 0)::int as open_handoffs,
        count(*) filter (where converted_at is not null)::int as conversions
      from enrolled
    `,
      tx<{ n: number }[]>`
      select count(*)::int as n
      from leads l
      where l.state = 'lead'
        and l.archived_at is null and l.unsubscribed_at is null
        and l.agent_paused_at is null and l.tenant_id is null
        and l.agent_mode <> 'off'
        and not exists (
          select 1 from crm_campaign_leads cl
          where cl.campaign_id = ${campaignId} and cl.lead_id = l.id
        )
        and not exists (
          select 1 from lead_messages m join lead_threads t on t.id = m.thread_id
          where t.lead_id = l.id and m.direction in ('out', 'in')
        )
        and (
          (l.whatsapp is not null and l.whatsapp <> '')
          or (l.instagram is not null and l.instagram <> '')
          or (l.email is not null and l.email <> '' and l.email_bounced_at is null)
        )
    `,
    ]);

  const g: Guardrails = { ...DEFAULT_GUARDRAILS, ...rawG };
  const waBudget = waReady
    ? await whatsappColdBudgetTx(tx, g)
    : { cap: g.whatsappColdPerDay, used: 0, remaining: 0, nextSlotAt: null };
  const igBudget =
    igReady && g.instagramColdDmsPerDay > 0
      ? await instagramColdBudgetTx(tx, g)
      : { remaining: 0, nextSlotAt: null };
  const { discoveryUnavailable } = await import('./channels/discovery.ts');
  const researchReady =
    !(await discoveryUnavailable(tx, false)) || Boolean(process.env.MONID_API_KEY);
  const now = new Date();
  const nextSendWindowAt = await sendWindowOpenAtTx(tx, g, now);
  const inQuietHours = nextSendWindowAt.getTime() > now.getTime();

  const spentCents = Math.max(campaign.spent_cents, spendRow[0]?.spent ?? 0);
  const remainingBudgetCents = Math.max(0, campaign.budget_cents - spentCents);
  const hoursRemaining = Math.max(
    0,
    Math.round(((new Date(campaign.expires_at).getTime() - now.getTime()) / 3_600_000) * 10) / 10,
  );
  const dayAgo = now.getTime() - 86_400_000;
  const huntsLast24h = hunts.filter((h) => new Date(h.created_at).getTime() >= dayAgo).length;
  const huntsQueued = hunts.filter((h) => h.status === 'queued').length;

  const w = wipRow[0] ?? {
    enrolled_total: 0,
    uncontacted: 0,
    awaiting_reply: 0,
    active_conversations: 0,
    cold_or_exhausted: 0,
    pending_drafts: 0,
    open_handoffs: 0,
    conversions: 0,
  };

  return {
    campaign,
    spentCents,
    remainingBudgetCents,
    hoursRemaining,
    huntsTotal: campaign.hunts_launched,
    huntsLast24h,
    huntsQueued,
    recentHunts: hunts,
    wip: {
      enrolledTotal: w.enrolled_total,
      uncontacted: w.uncontacted,
      awaitingReply: w.awaiting_reply,
      activeConversations: w.active_conversations,
      coldOrExhausted: w.cold_or_exhausted,
      pendingDrafts: w.pending_drafts,
      openHandoffs: w.open_handoffs,
      activeWip: w.uncontacted + w.awaiting_reply + w.active_conversations,
      conversions: w.conversions,
    },
    untouchedCrmPool: poolRow[0]?.n ?? 0,
    health: {
      autonomyLevel: agent.level,
      signupOpen: offer.signupOpen,
      whatsappReady: waReady,
      instagramReady: igReady && g.instagramColdDmsPerDay > 0,
      emailReady,
      researchReady,
      whatsappColdRemaining: waBudget.remaining,
      whatsappColdNextSlotAt: waBudget.nextSlotAt,
      instagramColdRemaining: igBudget.remaining,
      instagramColdNextSlotAt: igBudget.nextSlotAt,
      inQuietHours,
      nextSendWindowAt,
    },
  };
}

/**
 * Event hook called inside the committing transaction whenever a lead signs up (`linkCrmSignupTx`),
 * books a meeting (`bookMeetingTx`), or sends a verified human reply (`crmTurnEnded`).
 * Immediately marks matching active campaigns won (stopping timers and pinging Telegram) or
 * notifies the Campaign Director of progress toward a multi-lead goal.
 */
export async function onCampaignConversionTx(
  tx: Sql,
  input: {
    kind: CampaignGoalKind;
    leadId: string;
    leadName?: string | null;
    businessName?: string | null;
    detail?: string | null;
  },
): Promise<{ wonIds: string[]; progressedIds: string[] }> {
  const active = await tx<CampaignRow[]>`
    select * from crm_campaigns
    where status = 'active' and goal_kind = ${input.kind}
    order by created_at asc
    for update
  `;
  if (!active.length) return { wonIds: [], progressedIds: [] };

  let leadName = input.leadName?.trim() || null;
  let businessName = input.businessName?.trim() || null;
  if (!leadName) {
    const [lead] = await tx<{ name: string; business_name: string | null }[]>`
      select name, business_name from leads where id = ${input.leadId}
    `;
    leadName = lead?.name ?? 'Lead';
    businessName = lead?.business_name ?? null;
  }

  const wonIds: string[] = [];
  const progressedIds: string[] = [];

  for (const c of active) {
    if (c.goal_scope === 'campaign_only') {
      const [member] = await tx<{ converted_at: Date | null }[]>`
        select converted_at from crm_campaign_leads
        where campaign_id = ${c.id} and lead_id = ${input.leadId}
      `;
      if (!member || member.converted_at) continue;
      await tx`
        update crm_campaign_leads set converted_at = now()
        where campaign_id = ${c.id} and lead_id = ${input.leadId} and converted_at is null
      `;
    } else {
      const [existing] = await tx<{ converted_at: Date | null }[]>`
        select converted_at from crm_campaign_leads
        where campaign_id = ${c.id} and lead_id = ${input.leadId}
      `;
      if (existing?.converted_at) continue;
      await tx`
        insert into crm_campaign_leads (campaign_id, lead_id, origin, converted_at)
        values (${c.id}, ${input.leadId}, 'matched', now())
        on conflict (campaign_id, lead_id) do update
          set converted_at = coalesce(crm_campaign_leads.converted_at, now())
      `;
    }

    const [counts] = await tx<{ progress: number; enrolled: number }[]>`
      select
        count(*) filter (where converted_at is not null)::int as progress,
        count(*)::int as enrolled
      from crm_campaign_leads
      where campaign_id = ${c.id}
    `;
    const progress = counts?.progress ?? c.goal_progress + 1;
    const enrolled = counts?.enrolled ?? c.leads_enrolled;

    if (progress >= c.goal_target) {
      const reason = `meta atingida: ${leadName}${businessName ? ` (${businessName})` : ''}`.slice(
        0,
        400,
      );
      await dropCampaignTicksTx(tx, c.id);
      await tx`
        update crm_campaigns
        set status = 'won',
            goal_progress = ${progress},
            leads_enrolled = ${enrolled},
            stop_reason = ${reason},
            won_at = now(),
            ended_at = now(),
            next_tick_at = null,
            updated_at = now()
        where id = ${c.id}
      `;
      await recordStaffEventTx(
        tx,
        'campaign.won',
        {
          campaignId: c.id,
          title: c.title,
          goalKind: c.goal_kind,
          goalTarget: c.goal_target,
          goalProgress: progress,
          spentCents: c.spent_cents,
          budgetCents: c.budget_cents,
          hunts: c.hunts_launched,
          leads: enrolled,
          winnerLeadId: input.leadId,
          winnerName: leadName,
          winnerBusiness: businessName,
          detail: input.detail ?? null,
        },
        { dedupeKey: `campaign.won:${c.id}` },
      );
      wonIds.push(c.id);
    } else {
      await tx`
        update crm_campaigns
        set goal_progress = ${progress},
            leads_enrolled = ${enrolled},
            updated_at = now()
        where id = ${c.id}
      `;
      await recordStaffEventTx(tx, 'campaign.progress', {
        campaignId: c.id,
        title: c.title,
        goalKind: c.goal_kind,
        goalTarget: c.goal_target,
        goalProgress: progress,
        spentCents: c.spent_cents,
        budgetCents: c.budget_cents,
        hunts: c.hunts_launched,
        leads: enrolled,
        activeWip: 0,
        replies: 0,
        summary: `🎯 ${progress}/${c.goal_target} ${goalKindLabel(c.goal_kind, c.goal_target)} — ${leadName}${businessName ? ` (${businessName})` : ''} converteu!`,
        urgent: true,
      });
      await requestCampaignTx(tx, {
        campaignId: c.id,
        kind: 'campaign.progress',
        source: `conversion:${input.kind}`,
        dedupeKey: `crm:campaign:progress:${c.id}:${input.leadId}:${input.kind}`,
        payload: {
          leadId: input.leadId,
          leadName,
          progress,
          target: c.goal_target,
        } as JsonObject,
      });
      progressedIds.push(c.id);
    }
  }

  if (wonIds.length || progressedIds.length) {
    afterCommit(tx, () => {
      for (const id of [...wonIds, ...progressedIds]) emitControlEvent('run.update', id);
    });
  }
  return { wonIds, progressedIds };
}

/** Syncs a campaign's cumulative spend from `crm_turns` and enforces its hard budget cap. */
export async function syncCampaignSpendTx(
  tx: Sql,
  campaignId: string,
): Promise<{ spentCents: number; exhausted: boolean }> {
  const [c] = await tx<CampaignRow[]>`
    select * from crm_campaigns where id = ${campaignId} for update
  `;
  if (!c) return { spentCents: 0, exhausted: false };

  const [sum] = await tx<{ spent: number }[]>`
    select coalesce(sum(cost_cents), 0)::int as spent
    from crm_turns where campaign_id = ${campaignId}
  `;
  const spent = sum?.spent ?? 0;

  if (c.status === 'active' && spent >= c.budget_cents) {
    const reason = `orçamento de US$ ${(c.budget_cents / 100).toFixed(2)} atingido`;
    await dropCampaignTicksTx(tx, campaignId);
    await tx`
      update crm_campaigns
      set spent_cents = ${spent},
          status = 'exhausted',
          stop_reason = ${reason},
          ended_at = now(),
          next_tick_at = null,
          updated_at = now()
      where id = ${campaignId}
    `;
    await recordStaffEventTx(
      tx,
      'campaign.ended',
      {
        campaignId: c.id,
        title: c.title,
        status: 'exhausted',
        goalKind: c.goal_kind,
        goalTarget: c.goal_target,
        goalProgress: c.goal_progress,
        spentCents: spent,
        budgetCents: c.budget_cents,
        hunts: c.hunts_launched,
        leads: c.leads_enrolled,
        reason,
        by: null,
      },
      { dedupeKey: `campaign.exhausted:budget:${c.id}:${c.budget_cents}` },
    );
    return { spentCents: spent, exhausted: true };
  }

  if (spent !== c.spent_cents) {
    await tx`
      update crm_campaigns set spent_cents = ${spent}, updated_at = now()
      where id = ${campaignId}
    `;
  }
  return { spentCents: spent, exhausted: false };
}

/** Updates a campaign hunt row when its `crm-discovery` turn finishes and wakes the director. */
export async function onCampaignHuntFinishedTx(
  tx: Sql,
  input: {
    huntSubjectId: string;
    turnId: string;
    status: 'done' | 'failed';
    leadsCreated: number;
    costCents: number;
  },
): Promise<string | null> {
  if (!UUID_RE.test(input.huntSubjectId)) return null;
  const [hunt] = await tx<CampaignHuntRow[]>`
    select * from crm_campaign_hunts where hunt_subject_id = ${input.huntSubjectId} for update
  `;
  if (!hunt) return null;

  await tx`
    update crm_campaign_hunts
    set status = ${input.status},
        turn_id = ${input.turnId}::uuid,
        leads_created = ${input.leadsCreated},
        cost_cents = ${input.costCents},
        finished_at = now()
    where id = ${hunt.id}
  `;

  const { exhausted } = await syncCampaignSpendTx(tx, hunt.campaign_id);
  if (exhausted) return hunt.campaign_id;

  const [c] = await tx<{ status: CampaignStatus; expires_at: Date }[]>`
    select status, expires_at from crm_campaigns where id = ${hunt.campaign_id}
  `;
  if (!c || c.status !== 'active' || new Date(c.expires_at).getTime() <= Date.now()) {
    return hunt.campaign_id;
  }

  await requestCampaignTx(tx, {
    campaignId: hunt.campaign_id,
    kind: 'campaign.hunt_done',
    source: 'discovery',
    dedupeKey: `crm:campaign:hunt_done:${hunt.id}:${input.turnId}`,
    payload: {
      huntId: hunt.id,
      query: hunt.query,
      status: input.status,
      leadsCreated: input.leadsCreated,
      costCents: input.costCents,
    } as JsonObject,
  });
  return hunt.campaign_id;
}

/**
 * Safety net called after every `crm-campaign` turn: guarantees an active campaign NEVER ends up
 * orphaned with neither a future heartbeat timer nor an in-flight hunt waiting to call back.
 */
export async function ensureActiveCampaignHeartbeatTx(
  tx: Sql,
  campaignId: string,
  turnId: string,
): Promise<void> {
  if (!UUID_RE.test(campaignId)) return;
  const [c] = await tx<CampaignRow[]>`
    select * from crm_campaigns where id = ${campaignId} for update
  `;
  if (!c || c.status !== 'active') return;

  await tx`
    update crm_campaigns set last_tick_at = now(), updated_at = now()
    where id = ${campaignId}
  `;

  const [pending] = await tx<{ has_mail: boolean; has_hunt: boolean }[]>`
    select
      exists (
        select 1 from agent_mailbox m join agent_actors a on a.id = m.actor_id
        where a.tenant_id = ${PLATFORM_TENANT_ID}
          and a.agent_id = ${CRM_CAMPAIGN_ID}
          and a.subject_kind = ${CAMPAIGN_SUBJECT}
          and a.subject_id = ${campaignId}
          and m.consumed_by_turn is null
          and m.kind not like 'runtime.%'
      ) as has_mail,
      exists (
        select 1 from crm_campaign_hunts
        where campaign_id = ${campaignId} and status = 'queued'
      ) as has_hunt
  `;
  if (pending?.has_mail || pending?.has_hunt) return;

  const at = new Date(Date.now() + c.check_interval_min * 60_000);
  await scheduleCampaignTickTx(tx, {
    campaignId,
    at,
    reason: 'verificação periódica automática da campanha',
    source: 'campaign:heartbeat',
    dedupeSuffix: `auto:${turnId}`,
  });
}

/** Finds the active campaign linked to a lead (if any) so lead turn costs roll into campaign spend. */
export async function activeCampaignForLeadTx(tx: Sql, leadId: string): Promise<string | null> {
  const [row] = await tx<{ campaign_id: string }[]>`
    select cl.campaign_id
    from crm_campaign_leads cl
    join crm_campaigns c on c.id = cl.campaign_id
    where cl.lead_id = ${leadId} and c.status = 'active'
    order by cl.enrolled_at desc
    limit 1
  `;
  return row?.campaign_id ?? null;
}

export interface CampaignSummary {
  id: string;
  title: string;
  objective: string;
  goalKind: CampaignGoalKind;
  goalTarget: number;
  goalProgress: number;
  goalScope: CampaignScope;
  status: CampaignStatus;
  stopReason: string | null;
  focusSegment: string | null;
  focusCity: string | null;
  playbook: string;
  budgetCents: number;
  spentCents: number;
  maxDays: number;
  expiresAt: string;
  maxHuntsPerDay: number;
  targetWip: number;
  checkIntervalMin: number;
  allowExistingLeads: boolean;
  createdBy: string;
  huntsLaunched: number;
  leadsEnrolled: number;
  lastTickAt: string | null;
  nextTickAt: string | null;
  wonAt: string | null;
  endedAt: string | null;
  createdAt: string;
  wip?: CampaignScoreboard['wip'];
}

export function campaignJson(r: CampaignRow, wip?: CampaignScoreboard['wip']): CampaignSummary {
  return {
    id: r.id,
    title: r.title,
    objective: r.objective,
    goalKind: r.goal_kind,
    goalTarget: r.goal_target,
    goalProgress: r.goal_progress,
    goalScope: r.goal_scope,
    status: r.status,
    stopReason: r.stop_reason,
    focusSegment: r.focus_segment,
    focusCity: r.focus_city,
    playbook: r.playbook,
    budgetCents: r.budget_cents,
    spentCents: r.spent_cents,
    maxDays: r.max_days,
    expiresAt: new Date(r.expires_at).toISOString(),
    maxHuntsPerDay: r.max_hunts_per_day,
    targetWip: r.target_wip,
    checkIntervalMin: r.check_interval_min,
    allowExistingLeads: r.allow_existing_leads,
    createdBy: r.created_by,
    huntsLaunched: r.hunts_launched,
    leadsEnrolled: r.leads_enrolled,
    lastTickAt: r.last_tick_at ? new Date(r.last_tick_at).toISOString() : null,
    nextTickAt: r.next_tick_at ? new Date(r.next_tick_at).toISOString() : null,
    wonAt: r.won_at ? new Date(r.won_at).toISOString() : null,
    endedAt: r.ended_at ? new Date(r.ended_at).toISOString() : null,
    createdAt: new Date(r.created_at).toISOString(),
    ...(wip ? { wip } : {}),
  };
}

export async function listCampaigns(
  sql: Sql,
  opts: { status?: CampaignStatus | 'open'; limit?: number } = {},
): Promise<CampaignSummary[]> {
  const limit = Math.min(Math.max(opts.limit ?? 15, 1), 50);
  return controlTx(sql, async (tx) => {
    const rows = await tx<CampaignRow[]>`
      select * from crm_campaigns
      where ${
        opts.status === 'open'
          ? tx`status in ('active', 'paused')`
          : opts.status
            ? tx`status = ${opts.status}`
            : tx`true`
      }
      order by
        case status when 'active' then 0 when 'paused' then 1 else 2 end,
        created_at desc
      limit ${limit}
    `;
    const out: CampaignSummary[] = [];
    for (const r of rows) {
      if (r.status === 'active' || r.status === 'paused') {
        const sc = await campaignMetricsTx(tx, r.id);
        out.push(campaignJson({ ...r, spent_cents: sc?.spentCents ?? r.spent_cents }, sc?.wip));
      } else {
        out.push(campaignJson(r));
      }
    }
    return out;
  });
}

export async function getCampaignDetail(
  sql: Sql,
  campaignId: string,
): Promise<{
  campaign: CampaignSummary;
  scoreboard: Omit<CampaignScoreboard, 'campaign'>;
  hunts: {
    id: string;
    query: string;
    segment: string | null;
    city: string | null;
    target: number | null;
    status: string;
    leadsCreated: number;
    costCents: number;
    createdAt: string;
    finishedAt: string | null;
  }[];
  leads: {
    id: string;
    name: string;
    businessName: string | null;
    city: string | null;
    segment: string | null;
    state: string;
    origin: string;
    enrolledAt: string;
    convertedAt: string | null;
  }[];
  turns: {
    id: string;
    kind: string;
    status: string;
    source: string;
    leadId: string | null;
    leadName: string | null;
    steps: number;
    leadsCreated: number;
    costCents: number;
    outcome: string | null;
    error: string | null;
    startedAt: string;
    finishedAt: string | null;
  }[];
} | null> {
  const id = assertUuid(campaignId);
  return controlTx(sql, async (tx) => {
    const sc = await campaignMetricsTx(tx, id);
    if (!sc) return null;
    const [leads, turns] = await Promise.all([
      tx<
        {
          id: string;
          name: string;
          business_name: string | null;
          city: string | null;
          segment: string | null;
          state: string;
          origin: string;
          enrolled_at: Date;
          converted_at: Date | null;
        }[]
      >`
        select l.id, l.name, l.business_name, l.city, l.segment, l.state,
               cl.origin, cl.enrolled_at, cl.converted_at
        from crm_campaign_leads cl
        join leads l on l.id = cl.lead_id
        where cl.campaign_id = ${id}
        order by cl.converted_at desc nulls last, cl.enrolled_at desc
        limit 50
      `,
      tx<
        {
          turn_id: string;
          kind: string;
          status: string;
          source: string;
          lead_id: string | null;
          lead_name: string | null;
          steps: number;
          leads_created: number;
          cost_cents: number;
          outcome: string | null;
          error: string | null;
          started_at: Date;
          finished_at: Date | null;
        }[]
      >`
        select t.turn_id, t.kind, t.status, t.source, t.lead_id, l.name as lead_name,
               t.steps, t.leads_created, t.cost_cents, t.outcome, t.error, t.started_at, t.finished_at
        from crm_turns t
        left join leads l on l.id = t.lead_id
        where t.campaign_id = ${id}
        order by coalesce(t.finished_at, t.started_at) desc
        limit 25
      `,
    ]);
    const { campaign, ...rest } = sc;
    return {
      campaign: campaignJson({ ...campaign, spent_cents: sc.spentCents }, sc.wip),
      scoreboard: rest,
      hunts: sc.recentHunts.map((h) => ({
        id: h.id,
        query: h.query,
        segment: h.segment,
        city: h.city,
        target: h.target,
        status: h.status,
        leadsCreated: h.leads_created,
        costCents: h.cost_cents,
        createdAt: new Date(h.created_at).toISOString(),
        finishedAt: h.finished_at ? new Date(h.finished_at).toISOString() : null,
      })),
      leads: leads.map((l) => ({
        id: l.id,
        name: l.name,
        businessName: l.business_name,
        city: l.city,
        segment: l.segment,
        state: l.state,
        origin: l.origin,
        enrolledAt: new Date(l.enrolled_at).toISOString(),
        convertedAt: l.converted_at ? new Date(l.converted_at).toISOString() : null,
      })),
      turns: turns.map((t) => ({
        id: t.turn_id,
        kind: t.kind,
        status: t.status,
        source: t.source,
        leadId: t.lead_id,
        leadName: t.lead_name,
        steps: t.steps,
        leadsCreated: t.leads_created,
        costCents: t.cost_cents,
        outcome: t.outcome,
        error: t.error,
        startedAt: new Date(t.started_at).toISOString(),
        finishedAt: t.finished_at ? new Date(t.finished_at).toISOString() : null,
      })),
    };
  });
}

/** Creates a hunt record and dispatches a `crm-discovery` actor run on behalf of an active campaign. */
export async function launchCampaignHuntTx(
  tx: Sql,
  input: {
    campaignId: string;
    query: string;
    segment?: string | null;
    city?: string | null;
    target?: number | null;
    angle?: string | null;
    turnId: string;
  },
): Promise<
  | { ok: true; huntId: string; huntSubjectId: string; mailboxId: string | null }
  | { ok: false; code: string; reason: string }
> {
  const [c] = await tx<CampaignRow[]>`
    select * from crm_campaigns where id = ${input.campaignId} for update
  `;
  if (!c) return { ok: false, code: 'NOT_FOUND', reason: 'campanha não encontrada' };
  if (c.status !== 'active')
    return { ok: false, code: 'NOT_ACTIVE', reason: `campanha está ${c.status}` };
  if (new Date(c.expires_at).getTime() <= Date.now())
    return { ok: false, code: 'EXPIRED', reason: 'prazo da campanha encerrado' };
  const [spentRow] = await tx<{ spent: number }[]>`
    select coalesce(sum(cost_cents), 0)::int as spent from crm_turns where campaign_id = ${c.id}
  `;
  const spent = Math.max(c.spent_cents, spentRow?.spent ?? 0);
  if (spent >= c.budget_cents)
    return { ok: false, code: 'BUDGET_EXHAUSTED', reason: 'orçamento da campanha esgotado' };

  const [inFlight] = await tx<{ id: string; query: string }[]>`
    select id, query from crm_campaign_hunts
    where campaign_id = ${c.id} and status = 'queued'
    limit 1
  `;
  if (inFlight) {
    return {
      ok: false,
      code: 'HUNT_IN_FLIGHT',
      reason: `já existe uma busca rodando ("${inFlight.query}") — aguarde ela terminar`,
    };
  }

  const [recent] = await tx<{ n: number }[]>`
    select count(*)::int as n from crm_campaign_hunts
    where campaign_id = ${c.id} and created_at > now() - interval '1 day'
  `;
  if ((recent?.n ?? 0) >= c.max_hunts_per_day) {
    return {
      ok: false,
      code: 'DAILY_HUNT_CAP',
      reason: `limite diário de ${c.max_hunts_per_day} buscas nas últimas 24h atingido — aguarde antes de caçar mais`,
    };
  }

  const query = input.query.trim().slice(0, 500);
  const segment = input.segment?.trim().slice(0, 120) || null;
  const city = input.city?.trim().slice(0, 120) || null;
  const target = clampInt(input.target ?? undefined, 10, 1, 20);
  const angle = input.angle?.trim().slice(0, 400) || null;

  const [dup] = await tx<{ query: string }[]>`
    select query from crm_campaign_hunts
    where campaign_id = ${c.id}
      and lower(query) = ${query.toLowerCase()}
      and lower(coalesce(city, '')) = ${(city ?? '').toLowerCase()}
    limit 1
  `;
  if (dup) {
    return {
      ok: false,
      code: 'DUPLICATE_QUERY',
      reason: `essa busca já foi feita nesta campanha ("${dup.query}") — escolha outro nicho, cidade ou ângulo`,
    };
  }

  const { discoveryUnavailable } = await import('./channels/discovery.ts');
  const researchReady =
    !(await discoveryUnavailable(tx, false)) || Boolean(process.env.MONID_API_KEY);
  if (!researchReady) {
    return {
      ok: false,
      code: 'NO_RESEARCH',
      reason: 'nenhuma ferramenta de pesquisa configurada — pause ou trabalhe leads existentes',
    };
  }

  const huntSubjectId = randomUUID();
  const [hunt] = await tx<{ id: string }[]>`
    insert into crm_campaign_hunts (campaign_id, hunt_subject_id, query, segment, city, target, status)
    values (${c.id}, ${huntSubjectId}, ${query}, ${segment}, ${city}, ${target}, 'queued')
    returning id
  `;
  await tx`
    update crm_campaigns set hunts_launched = hunts_launched + 1, updated_at = now()
    where id = ${c.id}
  `;

  const { CRM_DISCOVERY_ID, HUNT_SUBJECT, requestBoardTx } = await import('./dispatch.ts');
  const d = await requestBoardTx(tx, {
    agent: CRM_DISCOVERY_ID,
    subject: { kind: HUNT_SUBJECT, id: huntSubjectId },
    kind: 'staff.request',
    source: `campaign:${c.id}`,
    dedupeKey: `crm:campaign:hunt:${hunt!.id}`,
    payload: {
      kind: 'discovery',
      query,
      ...(segment ? { segment } : {}),
      ...(city ? { city } : {}),
      target,
      campaignId: c.id,
      ...(angle ? { campaignAngle: angle } : {}),
      by: `campanha:${c.title}`.slice(0, 120),
    } as JsonObject,
  });

  afterCommit(tx, () => {
    if (d.mailboxId) emitControlEvent('run.update', d.mailboxId);
  });

  return { ok: true, huntId: hunt!.id, huntSubjectId, mailboxId: d.mailboxId };
}
