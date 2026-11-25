import type { JsonObject } from '@vendua/agent-runtime';
import type { Sql } from '../../../platform/db.ts';
import { PLATFORM_TENANT_ID } from '../../../platform/tenancy.ts';
import { controlTx } from '../../../modules/control.ts';
import {
  DEFAULT_GUARDRAILS,
  getSettingTx,
  type Guardrails,
} from '../../../modules/integrations.ts';
import { publicPlans } from '../../../modules/billing/plans.ts';
import { staffConfigTx } from '../../../modules/staff.ts';
import {
  agentSettingTx,
  AGENT_JOBS,
  type AgentJob,
  type AutonomyLevel,
} from '../../../crm/policy.ts';
import { CRM_DISCOVERY_ID, CRM_STRATEGIST_ID } from '../../../crm/jobs.ts';
import { brl, label, ts, usd } from '../../../modules/telegram/format.ts';

export interface ManagerWorkspace {
  timezone: string;
  level: AutonomyLevel;
  jobs: Record<AgentJob, boolean>;
  weeklyDiscoveryUsd: number;
  instructionsPreview: string;
  pinnedRulesCount: number;
  activeBriefsCount: number;
  /** one line per public plan, formatted here: the model quotes it, it never computes a price */
  plans: string[];
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
  /** this chat's recent 1-tap cards: the model never sees the taps, only its own "confirme" */
  cards: { at: string; title: string; state: string }[];
  /** discovery/strategist work queued, running, or just finished (crm_turns has finished only) */
  boardRuns: { kind: string; state: string; detail: string | null }[];
  /** active or paused autonomous campaigns */
  campaigns: {
    id: string;
    title: string;
    status: string;
    goal: string;
    spentUsd: string;
    budgetUsd: string;
    hunts: number;
    leads: number;
    stopReason: string | null;
  }[];
}

/** Static-ish workspace snapshot loaded once per turn. */
export async function managerWorkspaceTx(tx: Sql): Promise<ManagerWorkspace> {
  return controlTx(tx, async (c) => {
    const [agent, g, pinned, briefs, plans] = await Promise.all([
      agentSettingTx(c),
      getSettingTx<Partial<Guardrails>>(c, 'guardrails', {}),
      c<{ n: number }[]>`
        select count(*)::int as n from agent_memory_items where pinned
      `,
      c<{ n: number }[]>`
        select count(*)::int as n from discovery_briefs where enabled
      `,
      publicPlans(c),
    ]);
    return {
      timezone: g.timezone ?? DEFAULT_GUARDRAILS.timezone,
      level: agent.level,
      jobs: agent.jobs,
      weeklyDiscoveryUsd: agent.weeklyDiscoveryUsd,
      instructionsPreview: agent.instructions.slice(0, 1200),
      pinnedRulesCount: pinned[0]?.n ?? 0,
      activeBriefsCount: briefs[0]?.n ?? 0,
      plans: plans.map(
        (p) =>
          `${p.name} (${p.id}): ${p.priceCents === null ? 'sem preço publicado' : `${brl(p.priceCents)}/mês`}, ` +
          `taxa ${(p.feeBps / 100).toLocaleString('pt-BR')}% por pedido` +
          `${p.trialDays > 0 ? `, ${p.trialDays} dias de teste` : ''}${p.available ? '' : ' (fora de venda)'}`,
      ),
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

    const hm = (d: Date) => ts(d, 't', tz);
    const [drafts, handoffs, paused, runs, leads, replies, cards, pending, finished, campaigns] =
      await Promise.all([
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
        c<
          {
            title: string;
            status: string;
            result: string | null;
            decided_by: string | null;
            created_at: Date;
            decided_at: Date | null;
            expires_at: Date;
          }[]
        >`
        select title, status, result, decided_by, created_at, decided_at, expires_at
        from telegram_proposals
        where chat_id = ${chatId} and created_at > now() - interval '24 hours'
        order by created_at desc limit 8
      `,
        c<{ agent_id: string; payload: JsonObject | null; deliver_at: Date; running: boolean }[]>`
        select a.agent_id, m.payload, m.deliver_at, m.consumed_by_turn is not null as running
        from agent_mailbox m join agent_actors a on a.id = m.actor_id
        where a.tenant_id = ${PLATFORM_TENANT_ID}
          and a.agent_id in (${CRM_DISCOVERY_ID}, ${CRM_STRATEGIST_ID})
          and m.kind not like 'runtime.%'
          and m.deliver_at > now() - interval '1 day'
          and (m.consumed_by_turn is null
            or not exists (select 1 from crm_turns x where x.turn_id = m.consumed_by_turn))
        order by m.deliver_at desc limit 4
      `,
        c<
          {
            kind: string;
            status: string;
            leads_created: number;
            finished_at: Date;
            query: string | null;
          }[]
        >`
        select kind, status, leads_created, finished_at, params->>'query' as query
        from crm_turns
        where kind in ('discovery', 'strategist') and finished_at > now() - interval '12 hours'
        order by finished_at desc limit 3
      `,
        c<
          {
            id: string;
            title: string;
            status: string;
            goal_kind: string;
            goal_progress: number;
            goal_target: number;
            spent_cents: number;
            budget_cents: number;
            hunts_launched: number;
            leads_enrolled: number;
            stop_reason: string | null;
          }[]
        >`
        select id, title, status, goal_kind, goal_progress, goal_target, spent_cents,
               budget_cents, hunts_launched, leads_enrolled, stop_reason
        from crm_campaigns
        where status in ('active', 'paused')
        order by case status when 'active' then 0 else 1 end, created_at desc
        limit 5
      `.catch(() => []),
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
      cards: cards.map((p) => ({
        at: hm(p.created_at),
        title: p.title,
        state: cardState(p, hm),
      })),
      boardRuns: [
        ...pending.map((m) => {
          const query = typeof m.payload?.query === 'string' ? m.payload.query : null;
          return {
            kind: m.agent_id === CRM_DISCOVERY_ID ? 'descoberta' : 'estrategista',
            state: m.running
              ? 'rodando agora'
              : m.deliver_at.getTime() > Date.now()
                ? `agendada para ${hm(m.deliver_at)}`
                : 'na fila',
            detail: query?.slice(0, 120) ?? null,
          };
        }),
        ...finished.map((r) => ({
          kind: r.kind === 'discovery' ? 'descoberta' : 'estrategista',
          state:
            r.status === 'failed'
              ? `falhou às ${hm(r.finished_at)}`
              : `terminou às ${hm(r.finished_at)}${r.kind === 'discovery' ? ` com ${r.leads_created} lead(s) novo(s)` : ''}`,
          detail: r.query?.slice(0, 120) ?? null,
        })),
      ],
      campaigns: campaigns.map((x) => ({
        id: x.id,
        title: x.title,
        status: x.status,
        goal: `${x.goal_progress}/${x.goal_target} ${label('campaignGoal', x.goal_kind)}`,
        spentUsd: usd(x.spent_cents),
        budgetUsd: usd(x.budget_cents),
        hunts: x.hunts_launched,
        leads: x.leads_enrolled,
        stopReason: x.stop_reason,
      })),
    };
  });
}

function cardState(
  p: {
    status: string;
    result: string | null;
    decided_by: string | null;
    decided_at: Date | null;
    expires_at: Date;
  },
  hm: (d: Date) => string,
): string {
  const when = p.decided_at ? ` às ${hm(p.decided_at)}` : '';
  const by = p.decided_by ? ` por ${p.decided_by}` : '';
  switch (p.status) {
    case 'applied':
      return `JÁ CONFIRMADO${by}${when}${p.result ? ` (${p.result})` : ''}`;
    case 'cancelled':
      return `cancelado${by}${when}`;
    case 'failed':
      return `falhou ao aplicar${when}: ${p.result ?? 'erro'}`;
    case 'expired':
      return 'expirou sem resposta';
    default:
      return p.expires_at.getTime() <= Date.now()
        ? 'expirou sem resposta'
        : 'aguardando o botão confirmar';
  }
}

export function workspacePrompt(w: ManagerWorkspace): string {
  const onJobs = AGENT_JOBS.filter((j) => w.jobs[j]).map((j) => label('agentJob', j));
  const offJobs = AGENT_JOBS.filter((j) => !w.jobs[j]).map((j) => label('agentJob', j));
  return [
    'ESTADO DO AGENTE DE VENDAS:',
    `- Autonomia: ${label('autonomy', w.level)} (${w.level})`,
    `- Rotinas ligadas: ${onJobs.length ? onJobs.join(', ') : 'nenhuma'}${offJobs.length ? ` | desligadas: ${offJobs.join(', ')}` : ''}`,
    `- Regras fixadas na memória: ${w.pinnedRulesCount} | briefs de descoberta ativos: ${w.activeBriefsCount}`,
    w.plans.length
      ? `PLANOS VIGENTES (valores reais; cite exatamente estes quando falar de plano ou preço):\n${w.plans.map((l) => `- ${l}`).join('\n')}`
      : '',
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
    l.campaigns.length
      ? `\nMODO CAMPANHA (ativas/pausadas agora):\n${l.campaigns
          .map(
            (c) =>
              `- [${c.status}] "${c.title}" (id=${c.id}): meta ${c.goal} · gasto ${c.spentUsd}/${c.budgetUsd} · buscas=${c.hunts} · leads=${c.leads}${c.stopReason ? ` · motivo: ${c.stopReason}` : ''}`,
          )
          .join('\n')}`
      : '\nMODO CAMPANHA: nenhuma campanha ativa ou pausada agora.',
    l.cards.length
      ? `\nCARTÕES DE CONFIRMAÇÃO DESTA CONVERSA (estado real agora; vale mais que o que você disse antes):\n${l.cards
          .map((c) => `- ${c.at} ${c.title} → ${c.state}`)
          .join('\n')}`
      : '',
    l.boardRuns.length
      ? `\nPROSPECÇÃO / ESTRATEGISTA (inclui o que ainda está rodando):\n${l.boardRuns
          .map((r) => `- ${r.kind}: ${r.state}${r.detail ? ` — "${r.detail}"` : ''}`)
          .join('\n')}`
      : '\nPROSPECÇÃO / ESTRATEGISTA: nada rodando, na fila ou terminado nas últimas 12h.',
  ]
    .filter(Boolean)
    .join(' ');
}
