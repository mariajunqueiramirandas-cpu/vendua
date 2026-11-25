import {
  block,
  defineAgent,
  defineStatechart,
  pass,
  type ChatMessage,
  type Json,
  type JsonObject,
  type OutputGuard,
} from '@vendua/agent-runtime';
import type { Sql } from '../../../platform/db.ts';
import { CAMPAIGN_SUBJECT, CRM_CAMPAIGN_ID } from '../../../crm/jobs.ts';
import { workspaceTx, type Workspace } from '../crm/context.ts';
import { applyCrm, EMPTY_TURN, turn, turnOf } from '../crm/shared.ts';
import { campaignSubjectTx, type CampaignSubject } from './context.ts';
import { CAMPAIGN_TOOLS } from './tools.ts';

// Autonomous Campaign Director (ADR 0030): one persistent actor per goal-driven sales campaign.
// It never messages leads directly; it paces pipeline WIP over hours/days by orchestrating
// `crm-discovery` hunts and `crm-agent` outreach/coaching until the goal lands or a hard cap hits.

const DIRECTOR_RULES = `Você é o Diretor de Campanha autônomo de vendas da Venduá.
Sua missão é conduzir a campanha até bater a meta (ex.: conseguir 1 cadastro real de loja), pensando em dias e não em minutos, protegendo a reputação dos canais (WhatsApp/Instagram) e o orçamento.

Você NÃO fala direto com leads — você dirige o funil usando as ferramentas abaixo:
- \`list_campaign_leads\`: vê leads da campanha por estágio (replied, awaiting, uncontacted, cold) ou o pool intocado do CRM (untouched_pool).
- \`activate_existing_leads\`: ativa leads intocados que já existem no CRM (custo zero de descoberta!).
- \`launch_hunt\`: dispara uma nova caçada (\`crm-discovery\`) com query, cidade, segmento, meta (target) e ângulo de abordagem (\`angle\`).
- \`coach_lead\`: dá uma orientação tática específica para o agente de vendas num lead desta campanha.
- \`update_playbook\`: salva sua memória estratégica (nichos/cidades já testados, sinais de resposta, hipótese atual e próximo pivô).
- \`report_progress\`: atualiza o cartão vivo da campanha no Telegram para o fundador (só quando houver marco relevante ou mudança de estratégia).
- \`schedule_next_check\`: agenda a próxima checagem (30–1440 min; respeita horário silencioso automaticamente).
- \`pause_campaign\`: pausa e chama a equipe no Telegram se bater num bloqueio humano real.

## Disciplina de operação (OBRIGATÓRIO)
1. **Respeite o WIP (não seja impaciente)**:
   - Lojistas levam horas ou dias para responder no WhatsApp e cadastrar. Nunca dispare buscas seguidas só porque ninguém cadastrou em 30 minutos.
   - Se já existe busca rodando (\`huntsQueued > 0\`), NÃO lance outra; verifique leads que responderam se útil e encerre.
   - Se \`activeWip >= target_wip\`, o funil já está cheio! NÃO cace novos leads agora: avalie se algum lead quente precisa de \`coach_lead\`, atualize o playbook se mudou algo, e use \`schedule_next_check\` (ex.: 180–360 min).
   - Se \`activeWip < target_wip\`:
     • Primeiro olhe se \`untouchedCrmPool > 0\` (e reativação permitida): ativar bons leads existentes no CRM é grátis e rápido!
     • Se precisar de sangue novo e houver cota fria nos canais + orçamento + cota de buscas 24h, chame \`launch_hunt\` com query específica (nicho + cidade, ex.: "docerias artesanais Campinas", "confeitarias sob encomenda Curitiba", "marmitaria fitness Belo Horizonte", "hamburgueria artesanal delivery Goiânia", "pizzaria delivery Sorocaba", "açaí delivery Uberlândia").
2. **Aprenda e pivote com base nos sinais**:
   - Nunca repita uma busca+cidade que já está em BUSCAS JÁ FEITAS.
   - Se uma busca voltou 0 leads ou uma leva esfriou sem respostas, mude o nicho, a cidade ou o ângulo da abordagem e registre no \`update_playbook\`.
   - Se um nicho/ângulo gerou respostas reais, aprofunde em cidades vizinhas ou nichos irmãos.
3. **Proteja canais e orçamento**:
   - Se a cota diária fria do WhatsApp e do Instagram estiverem zeradas, NÃO cace leads agora — agende \`schedule_next_check\` para quando os slots abrirem (360–720 min).
   - Se a autonomia não for \`autopilot\` e houver muitos rascunhos acumulados (\`pendingDrafts >= 8\`), NÃO continue empilhando rascunhos: use \`pause_campaign\` avisando a equipe que há rascunhos aguardando aprovação (ou sugerindo ligar o piloto automático).
4. **Sempre feche o turno com próximo passo**:
   - Todo turno ativo deve terminar tendo chamado \`launch_hunt\` (que acorda você ao concluir), \`schedule_next_check\` ou \`pause_campaign\`.
   - Mantenha sua nota final curta e objetiva em português (vai apenas para o log interno).`;

const subjectOf = (j: Json) => j as unknown as CampaignSubject | null;
const workspaceOf = (j: Json) => j as unknown as Workspace | null;

const SETTLE_TOOLS = ['launch_hunt', 'schedule_next_check', 'pause_campaign'];

/** Ensures the director never ends an active turn without either launching a hunt, scheduling a tick, or pausing. */
export const campaignSettled: OutputGuard = {
  id: 'campaign_settled',
  stage: 'output',
  run(_text, { state }) {
    const t = turn(state);
    if (t.nudged) return pass;
    if (SETTLE_TOOLS.some((name) => t.actions.includes(name))) return pass;
    return block(
      'campaign_unsettled',
      'Antes de encerrar o turno, defina o próximo passo da campanha: chame `launch_hunt` (se precisa de novos leads), `schedule_next_check` (se vai aguardar respostas/janelas) ou `pause_campaign` (se há bloqueio humano).',
    );
  },
};

export function campaignInput(m: {
  kind: string;
  source: string;
  payload: Json;
}): ChatMessage | null {
  const p = (m.payload ?? {}) as JsonObject;
  const text = (() => {
    switch (m.kind) {
      case 'campaign.started':
        return 'Campanha iniciada agora. Leia a missão, o placar, o pool existente e a saúde dos canais; defina seu playbook inicial e tome a primeira ação.';
      case 'campaign.resumed':
        return `Campanha retomada${typeof p.reason === 'string' && p.reason ? ` (${p.reason})` : ''}. Reavalie o placar atual e decida o próximo passo.`;
      case 'campaign.hunt_done':
        return `Busca concluída ("${String(p.query ?? '')}"): status=${String(p.status ?? 'done')}, leads novos=${String(p.leadsCreated ?? 0)}. Avalie o WIP atual, atualize o playbook se necessário e decida se aguarda respostas ou pivota.`;
      case 'campaign.progress':
        return `Avanço na meta! ${String(p.leadName ?? 'Um lead')} converteu (${String(p.progress ?? '?')}/${String(p.target ?? '?')}). Veja o que funcionou e continue até fechar a meta.`;
      case 'timer.campaign_tick':
        return `Checagem periódica da campanha${typeof p.reason === 'string' && p.reason ? ` (${p.reason})` : ''}. Avalie o WIP, respostas recentes, buscas anteriores e decida a próxima ação.`;
      case 'staff.request':
        return `Nova orientação da equipe (${String(p.by ?? 'equipe')}): ${String(p.guidance ?? 'reavaliar campanha')}. Adapte o playbook e aja conforme a instrução.`;
      default:
        return null;
    }
  })();
  return text ? { role: 'user', parts: [{ type: 'text', text: text.slice(0, 4000) }] } : null;
}

const TOOL_NAMES = CAMPAIGN_TOOLS.map((t) => t.name);

export const crmCampaign = defineAgent<Sql>({
  id: CRM_CAMPAIGN_ID,
  subject: CAMPAIGN_SUBJECT,
  lane: 'background',
  transport: 'crm-log',
  replies: false,
  ledger: false,
  models: { default: 'strong', maxTokens: 2500, temperature: 0.3 },
  instructions: [
    { id: 'crm-campaign-rules', tier: 'static', priority: 100, text: DIRECTOR_RULES },
    {
      id: 'crm-campaign-pitch',
      tier: 'tenant',
      priority: 95,
      text: (ctx) => {
        const ws = workspaceOf(ctx.tenant);
        if (!ws) return '';
        return [
          'PRODUTO (Venduá):',
          ws.pitch.product ? `- O que é: ${ws.pitch.product}` : '',
          ws.pitch.audience ? `- Público ideal (ICP): ${ws.pitch.audience}` : '',
          ws.pitch.offer ? `- Oferta: ${ws.pitch.offer}` : '',
        ]
          .filter(Boolean)
          .join('\n');
      },
    },
    {
      id: 'crm-campaign-subject',
      tier: 'subject',
      priority: 90,
      text: (ctx) => subjectOf(ctx.subject)?.text ?? '',
    },
  ],
  tools: CAMPAIGN_TOOLS,
  statechart: defineStatechart({
    initial: 'directing',
    states: { directing: { tools: TOOL_NAMES } },
  }),
  guards: { output: [campaignSettled] },
  budgets: { stepsPerTurn: 10, tokensPerTurn: 1_200_000, costPerTurnUsd: 4, tenantDaily: 'crm' },
  finish: (s) => !!subjectOf(s.context.subject)?.parked,
  toInput: campaignInput,
  load: {
    tenant: async ({ tx }) => (await workspaceTx(tx)) as unknown as Json,
    subject: async ({ tx, subject, batch, state }) => {
      const t = batch.length ? turnOf(batch, null) : { ...EMPTY_TURN, ...turn(state) };
      return (await campaignSubjectTx(tx, subject.id, t)) as unknown as Json;
    },
  },
  fold: { initial: { turn: EMPTY_TURN } as unknown as Json, apply: applyCrm },
  compaction: { thresholdTokens: 40_000, keepRecent: 6 },
  maxAttempts: 2,
});
