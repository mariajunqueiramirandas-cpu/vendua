import type { Sql } from '../../../platform/db.ts';
import { controlTx } from '../../../modules/control.ts';
import { hasMemoryTablesTx, memoryFeedForRunTx } from '../../../modules/agent-memory.ts';
import { segmentStats } from '../../../modules/leads.ts';
import { recordStaffEventTx } from '../../../modules/staff-events.ts';
import {
  campaignMetricsTx,
  dropCampaignTicksTx,
  goalKindLabel,
  scheduleCampaignTickTx,
  syncCampaignSpendTx,
} from '../../../crm/campaigns.ts';
import type { TurnInfo } from '../crm/shared.ts';

export interface CampaignSubject {
  text: string;
  parked: string | null;
}

const fmtUsd = (cents: number) => `US$${(cents / 100).toFixed(2)}`;

async function autoPauseTx(
  tx: Sql,
  campaignId: string,
  title: string,
  meta: {
    goalKind: 'signup' | 'meeting' | 'reply';
    goalTarget: number;
    goalProgress: number;
    spentCents: number;
    budgetCents: number;
    hunts: number;
    leads: number;
  },
  reason: string,
): Promise<void> {
  await dropCampaignTicksTx(tx, campaignId);
  await tx`
    update crm_campaigns
    set status = 'paused', stop_reason = ${reason.slice(0, 400)}, next_tick_at = null, updated_at = now()
    where id = ${campaignId} and status = 'active'
  `;
  await recordStaffEventTx(
    tx,
    'campaign.updated',
    {
      campaignId,
      title,
      status: 'paused',
      ...meta,
      reason,
      by: null,
    },
    {
      dedupeKey: `campaign.autopause:${campaignId}:${reason.slice(0, 80)}:${Math.floor(Date.now() / 3_600_000)}`,
    },
  );
}

/**
 * Loads the Campaign Director's live scoreboard and enforces deterministic hard stop/pause gates
 * BEFORE any model call: won, budget exhausted, expired, workspace off, signup closed, all send
 * channels down, or quiet-hours heartbeat deferral.
 */
export async function campaignSubjectTx(
  tx: Sql,
  campaignId: string,
  t: TurnInfo,
): Promise<CampaignSubject> {
  return controlTx(tx, async (c) => {
    const sc = await campaignMetricsTx(c, campaignId);
    if (!sc) return { text: 'CAMPANHA: não encontrada', parked: 'campanha não encontrada' };

    const camp = sc.campaign;
    const baseMeta = {
      goalKind: camp.goal_kind,
      goalTarget: camp.goal_target,
      goalProgress: camp.goal_progress,
      spentCents: sc.spentCents,
      budgetCents: camp.budget_cents,
      hunts: sc.huntsTotal,
      leads: sc.wip.enrolledTotal,
    };

    if (camp.status !== 'active') {
      return { text: `CAMPANHA ${camp.status}`, parked: `campanha ${camp.status}` };
    }

    if (camp.goal_progress >= camp.goal_target) {
      await dropCampaignTicksTx(c, campaignId);
      await c`
        update crm_campaigns
        set status = 'won', won_at = coalesce(won_at, now()), ended_at = coalesce(ended_at, now()),
            next_tick_at = null, updated_at = now()
        where id = ${campaignId}
      `;
      return { text: 'CAMPANHA: meta já atingida', parked: 'meta atingida' };
    }

    if (sc.spentCents >= camp.budget_cents) {
      await syncCampaignSpendTx(c, campaignId);
      return { text: 'CAMPANHA: orçamento atingido', parked: 'orçamento atingido' };
    }

    if (new Date(camp.expires_at).getTime() <= Date.now()) {
      const reason = `prazo de ${camp.max_days} dia(s) encerrado`;
      await dropCampaignTicksTx(c, campaignId);
      await c`
        update crm_campaigns
        set status = 'exhausted', stop_reason = ${reason}, ended_at = now(), next_tick_at = null, updated_at = now()
        where id = ${campaignId} and status = 'active'
      `;
      await recordStaffEventTx(
        c,
        'campaign.ended',
        {
          campaignId,
          title: camp.title,
          status: 'exhausted',
          ...baseMeta,
          reason,
          by: null,
        },
        {
          dedupeKey: `campaign.exhausted:time:${campaignId}:${new Date(camp.expires_at).getTime()}`,
        },
      );
      return { text: 'CAMPANHA: prazo encerrado', parked: reason };
    }

    if (sc.health.autonomyLevel === 'off') {
      const reason = 'autonomia do agente está desligada — ligue para retomar a campanha';
      await autoPauseTx(c, campaignId, camp.title, baseMeta, reason);
      return { text: `CAMPANHA PAUSADA: ${reason}`, parked: reason };
    }

    if (camp.goal_kind === 'signup' && !sc.health.signupOpen) {
      const reason = 'cadastro online está fechado (abra em Config → Cadastro para retomar)';
      await autoPauseTx(c, campaignId, camp.title, baseMeta, reason);
      return { text: `CAMPANHA PAUSADA: ${reason}`, parked: reason };
    }

    if (!sc.health.whatsappReady && !sc.health.instagramReady && !sc.health.emailReady) {
      const reason = 'nenhum canal de envio conectado (WhatsApp, Instagram e email indisponíveis)';
      await autoPauseTx(c, campaignId, camp.title, baseMeta, reason);
      return { text: `CAMPANHA PAUSADA: ${reason}`, parked: reason };
    }

    // Never waste tokens on a periodic heartbeat during quiet hours: defer straight to send window open.
    if (sc.health.inQuietHours && t.trigger === 'timer.campaign_tick') {
      await scheduleCampaignTickTx(c, {
        campaignId,
        at: sc.health.nextSendWindowAt,
        reason: 'aguardando fim do horário silencioso',
        source: 'campaign:quiet_defer',
        dedupeSuffix: `quiet:${sc.health.nextSendWindowAt.getTime()}`,
      });
      return { text: 'CAMPANHA: horário silencioso', parked: 'horário silencioso' };
    }

    const parts: string[] = [];
    const goalTxt = `${camp.goal_progress}/${camp.goal_target} ${goalKindLabel(camp.goal_kind, camp.goal_target)}`;

    parts.push(
      [
        `MISSÃO DA CAMPANHA:`,
        `- Título: ${camp.title}`,
        `- Objetivo: ${camp.objective}`,
        `- Meta: ${goalTxt} (escopo: ${camp.goal_scope === 'any' ? 'qualquer lead do CRM que converter' : 'somente leads desta campanha'})`,
        `- Foco inicial: segmento=${camp.focus_segment ?? '(aberto — você escolhe os melhores)'} · cidade=${camp.focus_city ?? '(aberto — Brasil)'}`,
        `- Reativar leads existentes do CRM: ${camp.allow_existing_leads ? 'permitido' : 'não (só descoberta nova)'}`,
      ].join('\n'),
    );

    parts.push(
      [
        `PLACAR & GUARDRAILS AGORA:`,
        `- Orçamento: ${fmtUsd(sc.spentCents)} gastos de ${fmtUsd(camp.budget_cents)} (restam ${fmtUsd(sc.remainingBudgetCents)})`,
        `- Tempo restante: ${sc.hoursRemaining}h (expira em ${new Date(camp.expires_at).toISOString()})`,
        `- Buscas (hunts): ${sc.huntsTotal} no total · ${sc.huntsLast24h}/${camp.max_hunts_per_day} nas últimas 24h · rodando agora=${sc.huntsQueued}`,
        `- Pipeline da campanha (WIP alvo=${camp.target_wip}):`,
        `  • total inscritos: ${sc.wip.enrolledTotal}`,
        `  • ativos em curso (activeWip): ${sc.wip.activeWip} (sem contato=${sc.wip.uncontacted}, aguardando resposta ≤72h=${sc.wip.awaitingReply}, em conversa ativa=${sc.wip.activeConversations})`,
        `  • esfriaram/descadastrados: ${sc.wip.coldOrExhausted}`,
        `  • rascunhos esperando aprovação humana: ${sc.wip.pendingDrafts} · handoffs abertos: ${sc.wip.openHandoffs}`,
        `- Pool de leads existentes intocados no CRM (prontos para ativar sem gastar com busca): ${sc.untouchedCrmPool}`,
      ].join('\n'),
    );

    const waCapTxt = !sc.health.whatsappReady
      ? 'indisponível'
      : sc.health.whatsappColdRemaining === null
        ? 'pronto (sem teto diário)'
        : `pronto (${sc.health.whatsappColdRemaining} abordagens frias restantes nas próximas 24h)`;
    const igCapTxt = !sc.health.instagramReady
      ? 'indisponível/desligado'
      : `pronto (${sc.health.instagramColdRemaining} DMs frias restantes nas próximas 24h)`;

    parts.push(
      [
        `SAÚDE DO WORKSPACE:`,
        `- Autonomia: ${sc.health.autonomyLevel}${sc.health.autonomyLevel !== 'autopilot' ? ' (atenção: primeiros contatos/respostas podem virar rascunhos esperando aprovação!)' : ''}`,
        `- Cadastro online aberto: ${sc.health.signupOpen ? 'sim' : 'NÃO'}`,
        `- WhatsApp: ${waCapTxt}`,
        `- Instagram: ${igCapTxt}`,
        `- Email: ${sc.health.emailReady ? 'pronto' : 'indisponível'}`,
        `- Pesquisa/Descoberta: ${sc.health.researchReady ? 'disponível' : 'indisponível'}`,
        `- Horário silencioso agora: ${sc.health.inQuietHours ? `SIM (abre em ${sc.health.nextSendWindowAt.toISOString()})` : 'não'}`,
      ].join('\n'),
    );

    if (sc.recentHunts.length) {
      parts.push(
        `BUSCAS JÁ FEITAS NESTA CAMPANHA (nunca repita exatamente a mesma busca+cidade):\n${sc.recentHunts
          .slice(0, 12)
          .map(
            (h) =>
              `- [${h.status}] "${h.query}"${h.city ? ` · ${h.city}` : ''}${h.segment ? ` · ${h.segment}` : ''} → ${h.leads_created} leads (${fmtUsd(h.cost_cents)})`,
          )
          .join('\n')}`,
      );
    }

    const stats = await segmentStats(c);
    if (stats.length) {
      parts.push(
        `DESEMPENHO HISTÓRICO POR SEGMENTO NO CRM:\n${stats
          .slice(0, 12)
          .map(
            (s) =>
              `- ${s.segment}: ${s.leads} leads, ${s.contacted} contatados, ${s.replied} responderam, ${s.live} lojas ativas`,
          )
          .join('\n')}`,
      );
    }

    if (await hasMemoryTablesTx(c)) {
      const feed = await memoryFeedForRunTx(c, { segment: camp.focus_segment });
      const rules = feed.filter((r) => !r.agentWritten).map((r) => `- ${r.content}`);
      if (rules.length) {
        parts.push(`REGRAS DA EQUIPE:\n${rules.slice(0, 15).join('\n')}`);
      }
    }

    parts.push(
      `PLAYBOOK ATUAL (sua memória estratégica entre turnos):\n${camp.playbook.trim() || '(vazio — registre sua hipótese inicial e o plano em update_playbook)'}`,
    );

    if (t.params.guidance) {
      parts.push(`ORIENTAÇÃO RECENTE DA EQUIPE: ${t.params.guidance}`);
    }

    return { text: parts.join('\n\n'), parked: null };
  });
}
