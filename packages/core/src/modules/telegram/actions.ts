import { HttpError } from '../../platform/http.ts';
import { log } from '../../platform/log.ts';
import {
  AGENT_JOBS,
  AUTONOMY_LEVELS,
  agentSettingTx,
  type AgentJob,
  type AutonomyLevel,
} from '../../crm/policy.ts';
import { completeTask } from '../activities.ts';
import { deleteMemoryItem } from '../agent-memory.ts';
import { claimControl, controlTx } from '../control.ts';
import { emitControlEvent } from '../control-events.ts';
import { ackIncident } from '../fleet/incidents.ts';
import { updateLeadTx } from '../leads.ts';
import { STAFF_CATEGORIES, recordStaffEventTx } from '../staff-events.ts';
import { approveMessage, rejectMessage } from '../threads.ts';
import {
  agenteView,
  applyMute,
  campanhaView,
  frotaView,
  memoriaView,
  muteDurationPicker,
  pendingView,
  renderLeadCard,
  renderStoreCard,
  type CommandCtx,
} from './commands.ts';
import { editCard, sendCard, syncAnchorCards } from './deliver.ts';
import { b, esc, label } from './format.ts';
import {
  decideProposal,
  renderProposalBlock,
  savePrompt,
  setLeadAgentState,
  triggerBoardRun,
  updateAgentConfig,
  type PromptKind,
} from './manager-ops.ts';
import { TelegramError, type TelegramClient } from './rest.ts';

// Inline keyboard button handlers (ADR 0047). Every mutating action runs through the same CRM
// function and `claimControl` idempotency keyed by `telegram:<callbackQueryId>`, answers the
// callback query toast right away, and syncs anchored cards across every linked teammate's DM.

const alog = log.child({ mod: 'telegram' });

const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
const ACTION_RE = new RegExp(`^(d|dp|h|i|if):([artdwgm]):(${UUID})$`);
const PICK_RE = new RegExp(`^([ls]):(${UUID})$`);
const GUIDE_LEAD_RE = new RegExp(`^g:l:(${UUID})$`);
const LEAD_PAUSE_RE = new RegExp(`^lp:([pr]):(${UUID})$`);
const LEAD_MODE_RE = new RegExp(`^lm:([da]):(${UUID})$`);
const AGENT_LEVEL_RE = /^al:(off|copilot|supervised|autopilot)$/;
const AGENT_JOB_RE = /^aj:(reply|outreach|discovery|strategist)$/;
const AGENT_BTN_RE = /^ag:([tmbsc])$/;
const CAMPAIGN_BTN_RE = new RegExp(`^cp(v?):([prsbg]):(${UUID})$`);
const MEM_DEL_RE = new RegExp(`^md:(${UUID})$`);
const PROPOSAL_RE = new RegExp(`^p:([yn]):(${UUID})$`);
const MUTE_CAT_RE = /^mc:([a-z]+)$/;
const MUTE_APPLY_RE = /^m:([a-z]+):(\d{1,4})$/;

const REASONS: Record<string, string> = {
  MESSAGE_NOT_FOUND: 'esse rascunho não existe mais (já foi resolvido?)',
  LEAD_COST_CAP: 'o lead está no teto de custo — libere no CRM antes de enviar',
  IG_COLD_CAP: 'o limite diário de DMs frias do Instagram foi atingido',
  TASK_NOT_FOUND: 'essa tarefa não existe mais',
  LEAD_NOT_FOUND: 'esse lead não existe mais',
  INCIDENT_NOT_FOUND: 'esse incidente não existe mais',
  PROPOSAL_NOT_FOUND: 'essa proposta não existe mais',
  MEMORY_NOT_FOUND: 'essa regra já foi removida',
  CAMPAIGN_NOT_FOUND: 'essa campanha não existe mais',
  CAMPAIGN_ENDED: 'essa campanha já foi encerrada',
  CAMPAIGN_LIMIT: 'já existem muitas campanhas ativas — pause ou encerre uma antes',
  CAMPAIGN_BUDGET_EXHAUSTED: 'orçamento esgotado — toque em ➕ +US$10 para retomar',
};

export function refusal(e: unknown): string {
  if (e instanceof HttpError) return REASONS[e.code] ?? e.message;
  return 'algo deu errado — tente pelo CRM';
}

export interface CallbackClick {
  callbackId: string;
  data: string;
  chatId: string;
  messageId: string | null;
}

async function answerToast(
  client: TelegramClient,
  callbackId: string,
  text?: string,
  alert = false,
): Promise<void> {
  await client
    .call('answerCallbackQuery', {
      callback_query_id: callbackId,
      ...(text ? { text: text.slice(0, 190) } : {}),
      ...(alert ? { show_alert: true } : {}),
    })
    .catch((e) => {
      if (!(e instanceof TelegramError)) return;
      alog.debug({ err: e.description }, 'answerCallbackQuery failed');
    });
}

async function editThis(
  client: TelegramClient,
  click: CallbackClick,
  msg: Awaited<ReturnType<typeof pendingView>>,
): Promise<void> {
  if (!click.messageId) return;
  await editCard(client, click.chatId, click.messageId, msg).catch((e) => {
    if (e instanceof TelegramError && (e.notModified || e.messageGone)) return;
    alog.warn({ err: e }, 'telegram callback edit failed');
  });
}

async function openPrompt(
  c: CommandCtx,
  click: CallbackClick,
  client: TelegramClient,
  opts: { kind: PromptKind; targetId: string | null; promptText: string; placeholder: string },
): Promise<void> {
  await answerToast(client, click.callbackId);
  const promptMsgId = await sendCard(
    client,
    click.chatId,
    { text: opts.promptText, forceReply: opts.placeholder },
    { replyTo: click.messageId },
  );
  await savePrompt(c.sql, {
    chatId: click.chatId,
    messageId: promptMsgId,
    kind: opts.kind,
    targetId: opts.targetId,
  });
}

export async function runCallback(
  c: CommandCtx,
  click: CallbackClick,
  client: TelegramClient,
): Promise<void> {
  const key = `telegram:${click.callbackId}`;
  const by = c.staffName;
  const clicked = click.messageId
    ? { chatId: click.chatId, messageId: click.messageId }
    : undefined;

  try {
    // ── picker: open lead or store card ─────────────────────────────────────
    const pick = PICK_RE.exec(click.data);
    if (pick) {
      const [, kind, id] = pick as unknown as [string, 'l' | 's', string];
      const card = kind === 'l' ? await renderLeadCard(c, id) : await renderStoreCard(c, id);
      if (!card) {
        await answerToast(client, click.callbackId, 'não encontrado', true);
        return;
      }
      await answerToast(client, click.callbackId);
      await editThis(client, click, card);
      return;
    }

    // ── 1-tap Confirm/Cancel for AI sales manager proposals ─────────────────
    const prop = PROPOSAL_RE.exec(click.data);
    if (prop) {
      const [, yn, propId] = prop as unknown as [string, 'y' | 'n', string];
      const out = await decideProposal(c.sql, {
        proposalId: propId,
        confirm: yn === 'y',
        by,
        idemKey: key,
      });
      await answerToast(client, click.callbackId, out.toast, out.proposal.status === 'failed');
      await editThis(client, click, { text: renderProposalBlock(out.proposal) });
      if (out.syncedAnchor) {
        await syncAnchorCards(c.sql, c.ctx, client, out.syncedAnchor);
      }
      return;
    }

    // ── sales-agent control panel (/agente & /memoria) ──────────────────────
    const al = AGENT_LEVEL_RE.exec(click.data);
    if (al) {
      const level = al[1] as AutonomyLevel;
      if (!AUTONOMY_LEVELS.includes(level)) return;
      await updateAgentConfig(c.sql, { level, idemKey: key });
      await answerToast(client, click.callbackId, `autonomia: ${label('autonomy', level)}`);
      await editThis(client, click, await agenteView(c));
      return;
    }

    const aj = AGENT_JOB_RE.exec(click.data);
    if (aj) {
      const job = aj[1] as AgentJob;
      if (!AGENT_JOBS.includes(job)) return;
      const cur = await controlTx(c.sql, agentSettingTx);
      const nextOn = !cur.jobs[job];
      await updateAgentConfig(c.sql, { jobs: { [job]: nextOn }, idemKey: key });
      await answerToast(
        client,
        click.callbackId,
        `${label('agentJob', job)}: ${nextOn ? 'ligado' : 'desligado'}`,
      );
      await editThis(client, click, await agenteView(c));
      return;
    }

    const ag = AGENT_BTN_RE.exec(click.data);
    if (ag) {
      const op = ag[1]!;
      if (op === 't') {
        await openPrompt(c, click, client, {
          kind: 'teach_rule',
          targetId: null,
          promptText: `🧠 ${b('qual regra você quer ensinar ao agente?')}\nresponda em texto ou áudio (use ${esc('#segmento')} no começo se for só para um nicho).`,
          placeholder: 'ex.: nunca oferecer mais de 14 dias grátis…',
        });
        return;
      }
      if (op === 'm') {
        await answerToast(client, click.callbackId);
        await editThis(client, click, await memoriaView(c));
        return;
      }
      if (op === 'b') {
        await answerToast(client, click.callbackId);
        await editThis(client, click, await agenteView(c));
        return;
      }
      if (op === 'c') {
        await answerToast(client, click.callbackId);
        await editThis(client, click, await campanhaView(c));
        return;
      }
      if (op === 's') {
        await triggerBoardRun(c.sql, { kind: 'strategist', by, idemKey: key });
        await answerToast(client, click.callbackId, '🔎 revisão do estrategista iniciada');
        return;
      }
    }

    const cp = CAMPAIGN_BTN_RE.exec(click.data);
    if (cp) {
      const [, fromView, op, campaignId] = cp as unknown as [string, string, string, string];
      if (op === 'g') {
        await openPrompt(c, click, client, {
          kind: 'campaign_guide',
          targetId: campaignId,
          promptText: `🚀 ${b('como você quer direcionar esta campanha?')}\nresponda em texto ou áudio — o diretor ajusta o playbook e age agora.`,
          placeholder: 'ex.: foca em hamburguerias de BH e testa outro ângulo…',
        });
        return;
      }
      const { bumpCampaignBudget, pauseCampaign, resumeCampaign, stopCampaign } =
        await import('../../crm/campaigns.ts');
      let toast = 'feito';
      if (op === 'p') {
        await pauseCampaign(c.sql, { campaignId, by, idemKey: key });
        toast = '⏸ campanha pausada';
      } else if (op === 'r') {
        await resumeCampaign(c.sql, { campaignId, by, idemKey: key });
        toast = '▶️ campanha retomada';
      } else if (op === 'b') {
        await bumpCampaignBudget(c.sql, { campaignId, addUsd: 10, by, idemKey: key });
        toast = '➕ +US$10 adicionados';
      } else if (op === 's') {
        await stopCampaign(c.sql, { campaignId, by, idemKey: key });
        toast = '🛑 campanha encerrada';
      }
      await answerToast(client, click.callbackId, toast);
      if (fromView) await editThis(client, click, await campanhaView(c));
      await syncAnchorCards(
        c.sql,
        c.ctx,
        client,
        `campaign:${campaignId}`,
        fromView ? undefined : clicked,
      );
      return;
    }

    const md = MEM_DEL_RE.exec(click.data);
    if (md) {
      await deleteMemoryItem(c.sql, md[1]!, key);
      await answerToast(client, click.callbackId, '🗑 regra removida');
      await editThis(client, click, await memoriaView(c));
      return;
    }

    // ── per-lead controls (/lead card & lead alerts) ────────────────────────
    const gl = GUIDE_LEAD_RE.exec(click.data);
    if (gl) {
      await openPrompt(c, click, client, {
        kind: 'lead_guide',
        targetId: gl[1]!,
        promptText: `🤖 ${b('como você quer orientar o agente neste lead?')}\nresponda em texto ou áudio — o agente recebe a instrução e age agora.`,
        placeholder: 'ex.: manda follow-up perguntando se testou…',
      });
      return;
    }

    const lp = LEAD_PAUSE_RE.exec(click.data);
    if (lp) {
      const paused = lp[1] === 'p';
      const leadId = lp[2]!;
      await setLeadAgentState(c.sql, { leadId, paused, idemKey: key });
      await answerToast(
        client,
        click.callbackId,
        paused ? '⏸ agente pausado neste lead' : '▶️ agente retomado neste lead',
      );
      const refreshed = await renderLeadCard(c, leadId);
      if (refreshed) await editThis(client, click, refreshed);
      return;
    }

    const lm = LEAD_MODE_RE.exec(click.data);
    if (lm) {
      const mode = lm[1] === 'd' ? 'draft' : 'auto';
      const leadId = lm[2]!;
      await setLeadAgentState(c.sql, { leadId, mode, idemKey: key });
      await answerToast(
        client,
        click.callbackId,
        mode === 'draft' ? '📝 só rascunho neste lead' : '⚡ modo automático neste lead',
      );
      const refreshed = await renderLeadCard(c, leadId);
      if (refreshed) await editThis(client, click, refreshed);
      return;
    }

    // ── interactive /silenciar pickers ──────────────────────────────────────
    const mc = MUTE_CAT_RE.exec(click.data);
    if (mc) {
      const cat = mc[1]!;
      if (cat !== 'todas' && !(STAFF_CATEGORIES as readonly string[]).includes(cat)) {
        await answerToast(client, click.callbackId, 'categoria inválida', true);
        return;
      }
      await answerToast(client, click.callbackId);
      await editThis(client, click, muteDurationPicker(cat));
      return;
    }

    const ma = MUTE_APPLY_RE.exec(click.data);
    if (ma) {
      const cat = ma[1]!;
      const minutes = Number(ma[2]);
      const res = await applyMute(c, cat, minutes);
      await answerToast(client, click.callbackId, minutes ? '🔕 silenciado' : '🔔 reativado');
      await editThis(client, click, res);
      return;
    }

    // ── anchored card actions (draft, handoff, incident) ────────────────────
    const m = ACTION_RE.exec(click.data);
    if (!m) {
      await answerToast(
        client,
        click.callbackId,
        'esse botão é de uma versão antiga — use o CRM',
        true,
      );
      return;
    }
    const [, rawFamily, action, id] = m as unknown as [string, string, string, string];
    const fromPending = rawFamily === 'dp';
    const fromFrota = rawFamily === 'if';
    const family = rawFamily[0]!; // 'd' | 'h' | 'i'

    if (family === 'd' && action === 'w') {
      await openPrompt(c, click, client, {
        kind: 'draft_rewrite',
        targetId: id,
        promptText: `✏️ ${b('o que você quer mudar neste rascunho?')}\nresponda em texto ou áudio — o agente reescreve e manda o novo aqui para aprovar.`,
        placeholder: 'ex.: deixa mais curto e oferece 14 dias grátis…',
      });
      return;
    }

    if (family === 'h' && action === 'g') {
      await openPrompt(c, click, client, {
        kind: 'handoff_guide',
        targetId: id,
        promptText: `💬 ${b('responda para o agente de vendas')}\nmande em texto ou áudio como responder ao cliente — o handoff fecha, o lead despausa e o agente assume daqui.`,
        placeholder: 'ex.: diz que não integramos com iFood mas…',
      });
      return;
    }

    if (family === 'h' && action === 'm') {
      await openPrompt(c, click, client, {
        kind: 'handoff_direct',
        targetId: id,
        promptText: `✉️ ${b('escreva a mensagem que vai direto para o cliente')}\nresponda em texto ou áudio — sai exatamente como você mandar (o agente fica pausado neste lead).`,
        placeholder: 'mensagem direta para o lead…',
      });
      return;
    }

    if (family === 'd' && action === 'a') {
      const res = await approveMessage(c.sql, id, by, key);
      if (res.status !== 200) {
        const err = (res.body as unknown as { error?: { code?: string; message?: string } }).error;
        await answerToast(
          client,
          click.callbackId,
          REASONS[err?.code ?? ''] ?? err?.message ?? 'o CRM recusou a aprovação',
          true,
        );
        return;
      }
      const { dispatchMessage } = await import('../../crm/send.ts');
      void dispatchMessage(c.sql, res.body.message.id).catch((e) =>
        alog.error({ err: e, message: id }, 'telegram-approved send failed'),
      );
      await answerToast(client, click.callbackId, '✅ aprovado — enviando');
      if (fromPending) await editThis(client, click, await pendingView(c));
      await syncAnchorCards(c.sql, c.ctx, client, `draft:${id}`, fromPending ? undefined : clicked);
      return;
    }

    if (family === 'd' && action === 'r') {
      await rejectMessage(c.sql, id, key, by);
      await answerToast(client, click.callbackId, '✕ rejeitado');
      if (fromPending) await editThis(client, click, await pendingView(c));
      await syncAnchorCards(c.sql, c.ctx, client, `draft:${id}`, fromPending ? undefined : clicked);
      return;
    }

    if (family === 'h' && (action === 't' || action === 'd')) {
      const task = (
        await controlTx(
          c.sql,
          (tx) => tx<{ lead_id: string; done_at: Date | null }[]>`
            select lead_id, done_at from lead_tasks where id = ${id}
          `,
        )
      )[0];
      if (!task) {
        await answerToast(client, click.callbackId, REASONS.TASK_NOT_FOUND!, true);
        return;
      }
      if (!task.done_at) {
        if (action === 't') {
          const res = await claimControl(c.sql, key, async (tx) => {
            const lead = await updateLeadTx(tx, task.lead_id, { owner: by.slice(0, 80) }, 'staff');
            await recordStaffEventTx(
              tx,
              'handoff.taken',
              { taskId: id, leadId: task.lead_id, by },
              { dedupeKey: `handoff.taken:${id}:${click.callbackId}` },
            );
            return { status: 200, body: { lead } };
          });
          if (!res.replayed) emitControlEvent('lead.change', task.lead_id);
        } else {
          await completeTask(c.sql, id, true, key, by);
        }
      }
      await answerToast(client, click.callbackId, action === 't' ? '🙋 assumido' : '✅ resolvido');
      await syncAnchorCards(c.sql, c.ctx, client, `handoff:${id}`, clicked);
      return;
    }

    if (family === 'i' && (action === 'a' || action === 'r')) {
      await ackIncident(c.sql, id, action === 'a' ? { ack: true } : { resolved: true }, by, key);
      await answerToast(
        client,
        click.callbackId,
        action === 'a' ? '👀 reconhecido' : '✅ resolvido',
      );
      if (fromFrota) await editThis(client, click, await frotaView(c));
      await syncAnchorCards(
        c.sql,
        c.ctx,
        client,
        `incident:${id}`,
        fromFrota ? undefined : clicked,
      );
      return;
    }

    await answerToast(client, click.callbackId, 'ação desconhecida', true);
  } catch (e) {
    if (!(e instanceof HttpError))
      alog.error({ err: e, data: click.data }, 'telegram action failed');
    await answerToast(client, click.callbackId, refusal(e), true);
  }
}
