import type { Sql } from '../../../platform/db.ts';
import { controlTx } from '../../../modules/control.ts';
import {
  DEFAULT_GUARDRAILS,
  getSettingTx,
  type Guardrails,
} from '../../../modules/integrations.ts';
import { staffConfigTx } from '../../../modules/staff.ts';
import {
  agentSettingTx,
  AGENT_JOBS,
  type AgentJob,
  type AutonomyLevel,
} from '../../../crm/policy.ts';
import { label, usd } from '../../../modules/telegram/format.ts';

export interface ManagerWorkspace {
  timezone: string;
  level: AutonomyLevel;
  jobs: Record<AgentJob, boolean>;
  weeklyDiscoveryUsd: number;
  instructionsPreview: string;
  pinnedRulesCount: number;
  activeBriefsCount: number;
}

export interface ManagerLive {
  staffName: string;
  chatId: string;
  openDrafts: number;
  openHandoffs: number;
  pausedLeads: number;
  runsToday: number;
  failedToday: number;
  spendTodayCents: number;
  leadsToday: number;
  repliesToday: number;
}

/** Static-ish workspace snapshot loaded once per turn. */
export async function managerWorkspaceTx(tx: Sql): Promise<ManagerWorkspace> {
  return controlTx(tx, async (c) => {
    const [agent, g, pinned, briefs] = await Promise.all([
      agentSettingTx(c),
      getSettingTx<Partial<Guardrails>>(c, 'guardrails', {}),
      c<{ n: number }[]>`
        select count(*)::int as n from agent_memory_items where pinned
      `.catch(() => [{ n: 0 }]),
      c<{ n: number }[]>`
        select count(*)::int as n from discovery_briefs where enabled
      `.catch(() => [{ n: 0 }]),
    ]);
    return {
      timezone: g.timezone ?? DEFAULT_GUARDRAILS.timezone,
      level: agent.level,
      jobs: agent.jobs,
      weeklyDiscoveryUsd: agent.weeklyDiscoveryUsd,
      instructionsPreview: agent.instructions.slice(0, 1200),
      pinnedRulesCount: pinned[0]?.n ?? 0,
      activeBriefsCount: briefs[0]?.n ?? 0,
    };
  });
}

/** Live counters & staff identity loaded per turn. */
export async function managerLiveTx(tx: Sql, chatId: string): Promise<ManagerLive> {
  return controlTx(tx, async (c) => {
    const [staff, g] = await Promise.all([
      staffConfigTx(c),
      getSettingTx<Partial<Guardrails>>(c, 'guardrails', {}),
    ]);
    const member = staff.members.find((m) => m.telegram === chatId);
    const staffName = member?.name?.trim() || member?.email || 'equipe';
    const tz = g.timezone ?? DEFAULT_GUARDRAILS.timezone;
    const start = c`(date_trunc('day', now() at time zone ${tz}) at time zone ${tz})`;

    const [drafts, handoffs, paused, runs, leads, replies] = await Promise.all([
      c<{ n: number }[]>`select count(*)::int as n from lead_messages where status = 'draft'`,
      c<
        { n: number }[]
      >`select count(*)::int as n from lead_tasks where done_at is null and title like '[humano]%'`,
      c<
        { n: number }[]
      >`select count(*)::int as n from leads where agent_paused_at is not null and archived_at is null`,
      c<{ total: number; failed: number; cost: number }[]>`
        select count(*)::int as total,
               count(*) filter (where status = 'failed')::int as failed,
               coalesce(sum(cost_cents), 0)::int as cost
        from crm_turns where started_at >= ${start}
      `,
      c<{ n: number }[]>`select count(*)::int as n from leads where created_at >= ${start}`,
      c<
        { n: number }[]
      >`select count(*)::int as n from lead_messages where direction = 'in' and created_at >= ${start}`,
    ]);

    return {
      staffName,
      chatId,
      openDrafts: drafts[0]?.n ?? 0,
      openHandoffs: handoffs[0]?.n ?? 0,
      pausedLeads: paused[0]?.n ?? 0,
      runsToday: runs[0]?.total ?? 0,
      failedToday: runs[0]?.failed ?? 0,
      spendTodayCents: runs[0]?.cost ?? 0,
      leadsToday: leads[0]?.n ?? 0,
      repliesToday: replies[0]?.n ?? 0,
    };
  });
}

export function workspacePrompt(w: ManagerWorkspace): string {
  const onJobs = AGENT_JOBS.filter((j) => w.jobs[j]).map((j) => label('agentJob', j));
  const offJobs = AGENT_JOBS.filter((j) => !w.jobs[j]).map((j) => label('agentJob', j));
  return [
    'ESTADO DO AGENTE DE VENDAS:',
    `- Autonomia: ${label('autonomy', w.level)} (${w.level})`,
    `- Rotinas ligadas: ${onJobs.length ? onJobs.join(', ') : 'nenhuma'}${offJobs.length ? ` | desligadas: ${offJobs.join(', ')}` : ''}`,
    `- Regras fixadas na memória: ${w.pinnedRulesCount} | briefs de descoberta ativos: ${w.activeBriefsCount}`,
    w.instructionsPreview ? `- Instruções atuais (trecho):\n${w.instructionsPreview}` : '',
  ]
    .filter(Boolean)
    .join('\n');
}

export function livePrompt(l: ManagerLive): string {
  return [
    `HOJE AGORA (falando com ${l.staffName}):`,
    `rascunhos esperando=${l.openDrafts}, handoffs abertos=${l.openHandoffs}, leads pausados=${l.pausedLeads}, ` +
      `leads hoje=${l.leadsToday}, respostas hoje=${l.repliesToday}, ` +
      `runs hoje=${l.runsToday}${l.failedToday ? ` (${l.failedToday} falharam)` : ''}, gasto hoje=${usd(l.spendTodayCents)}.`,
  ].join(' ');
}
