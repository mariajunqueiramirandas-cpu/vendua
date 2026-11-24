import type { JsonObject } from '@vendua/agent-runtime';
import type { Sql } from '../../../platform/db.ts';
import { PLATFORM_TENANT_ID } from '../../../platform/tenancy.ts';
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
import { CRM_DISCOVERY_ID, CRM_STRATEGIST_ID } from '../../../crm/jobs.ts';
import { label, ts, usd } from '../../../modules/telegram/format.ts';

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
  /** this chat's recent 1-tap cards: the model never sees the taps, only its own "confirme" */
  cards: { at: string; title: string; state: string }[];
  /** discovery/strategist work queued, running, or just finished (crm_turns has finished only) */
  boardRuns: { kind: string; state: string; detail: string | null }[];
}

/** Static-ish workspace snapshot loaded once per turn. */
export async function managerWorkspaceTx(tx: Sql): Promise<ManagerWorkspace> {
  return controlTx(tx, async (c) => {
    const [agent, g, pinned, briefs] = await Promise.all([
      agentSettingTx(c),
      getSettingTx<Partial<Guardrails>>(c, 'guardrails', {}),
      c<{ n: number }[]>`
        select count(*)::int as n from agent_memory_items where pinned
      `,
      c<{ n: number }[]>`
        select count(*)::int as n from discovery_briefs where enabled
      `,
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

    const hm = (d: Date) => ts(d, 't', tz);
    const [drafts, handoffs, paused, runs, leads, replies, cards, pending, finished] =
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
