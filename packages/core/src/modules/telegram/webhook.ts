import { timingSafeEqual } from 'node:crypto';
import type { Sql } from '../../platform/db.ts';
import { HttpError } from '../../platform/http.ts';
import { log } from '../../platform/log.ts';
import { PLATFORM_TENANT_ID } from '../../platform/tenancy.ts';
import { dispatchTx } from '../../agent-host/dispatch.ts';
import {
  CRM_MANAGER_AGENT_ID,
  CRM_MANAGER_SUBJECT,
} from '../../agent-host/agents/crm-manager/shared.ts';
import type { MediaProviders } from '../../vendedor/media.ts';
import { controlTx } from '../control.ts';
import { staffConfigTx } from '../staff.ts';
import { refusal, runCallback } from './actions.ts';
import { consumeLinkToken, runCommand, type CommandCtx } from './commands.ts';
import type { TelegramContext } from './config.ts';
import { sendCard, syncAnchorCards } from './deliver.ts';
import { actionButton, b, clip, esc, i, label, mono, quote, row } from './format.ts';
import {
  consumePrompt,
  directReplyToLead,
  guideHandoff,
  guideLead,
  lookupRepliedCard,
  rewriteDraft,
  teachRule,
} from './manager-ops.ts';
import { TelegramError, type TelegramClient } from './rest.ts';

// Inbound Telegram webhook (ADR 0047): every request carries `x-telegram-bot-api-secret-token`,
// verified in constant time. Private DM chats only; one-tap `/start link_<token>` links a team
// member directly. Linked staff can run commands, tap inline buttons, swipe-reply to cards (or
// ForceReply prompts) with text or voice notes, or chat freely with the `crm-manager` agent.

const wlog = log.child({ mod: 'telegram' });
const MAX_VOICE_BYTES = 10 * 1024 * 1024;

export function verifyWebhookSecret(expected: string, actual: string | undefined): boolean {
  if (!expected || !actual) return false;
  const a = Buffer.from(expected, 'utf8');
  const bBuf = Buffer.from(actual, 'utf8');
  return a.length === bBuf.length && timingSafeEqual(a, bBuf);
}

export interface TelegramUser {
  id: number;
  is_bot?: boolean;
  first_name?: string;
  last_name?: string;
  username?: string;
}

export interface TelegramChat {
  id: number;
  type: 'private' | 'group' | 'supergroup' | 'channel';
}

export interface TelegramAudioRef {
  file_id: string;
  duration?: number;
  mime_type?: string;
  file_size?: number;
}

export interface TelegramUpdate {
  update_id: number;
  message?: {
    message_id: number;
    from?: TelegramUser;
    chat: TelegramChat;
    text?: string;
    caption?: string;
    voice?: TelegramAudioRef;
    audio?: TelegramAudioRef;
    reply_to_message?: {
      message_id: number;
    };
  };
  callback_query?: {
    id: string;
    from: TelegramUser;
    message?: {
      message_id: number;
      chat: TelegramChat;
    };
    data?: string;
  };
}

export async function staffNameForTelegramUser(sql: Sql, userId: string): Promise<string | null> {
  const cfg = await controlTx(sql, staffConfigTx);
  const m = cfg.members.find((x) => x.telegram === userId);
  if (!m) return null;
  return m.name?.trim() || m.email || 'equipe';
}

function parseCommand(text: string): { name: string; arg: string } | null {
  const trimmed = text.trim();
  if (!trimmed.startsWith('/')) return null;
  const m = /^\/([a-z0-9_]+)(?:@[a-z0-9_]+)?(?:\s+([\s\S]*))?$/i.exec(trimmed);
  if (!m) return null;
  return { name: m[1]!.toLowerCase(), arg: (m[2] ?? '').trim() };
}

function strangerReply(userId: string) {
  return {
    text: [
      `🔒 ${b('este bot é só para a equipe da Venduá.')}`,
      `seu ID do Telegram é ${mono(userId)} — abra ${b('Config → Telegram')} no CRM para conectar em um clique (ou cole esse ID em ${b('Config → Equipe')}).`,
    ].join('\n'),
  };
}

function parseRuleInput(raw: string): { content: string; segment: string | null } {
  const segMatch = /^#([a-z0-9_-]{2,40})\s+([\s\S]+)$/i.exec(raw.trim());
  if (segMatch) return { segment: segMatch[1]!.toLowerCase(), content: segMatch[2]!.trim() };
  return { segment: null, content: raw.trim() };
}

async function resolveInboundText(
  msg: NonNullable<TelegramUpdate['message']>,
  chatId: string,
  client: TelegramClient,
  media?: MediaProviders,
): Promise<{ text: string; voice: boolean } | { error: string } | null> {
  const plain = (msg.text ?? msg.caption ?? '').trim();
  const audio = msg.voice ?? msg.audio;
  if (!audio) return plain ? { text: plain, voice: false } : null;

  if (typeof audio.file_size === 'number' && audio.file_size > MAX_VOICE_BYTES) {
    return { error: '⚠️ esse áudio passa de 10 MB — mande um áudio mais curto ou em texto.' };
  }
  if (!media) {
    return {
      error:
        '🎙 transcrição de áudio indisponível neste servidor — configure em CRM → IA → Voz ou mande em texto.',
    };
  }
  await client.sendTyping(chatId);
  try {
    const { bytes } = await client.downloadFile(audio.file_id, MAX_VOICE_BYTES);
    const mime = audio.mime_type || 'audio/ogg';
    const tr = await media.transcribe(bytes, mime);
    const spoken = tr?.text?.trim() ?? '';
    if (!spoken) {
      return {
        error:
          '🎙 não consegui transcrever esse áudio — confira se há uma rota de voz em CRM → IA → Voz (ou mande em texto).',
      };
    }
    const combined = plain ? `${spoken}\n${plain}` : spoken;
    return { text: combined, voice: true };
  } catch (e) {
    wlog.warn(
      { err: e instanceof Error ? e.message : String(e) },
      'telegram voice transcribe failed',
    );
    if (e instanceof TelegramError && e.status === 413) {
      return { error: '⚠️ esse áudio passa de 10 MB — mande um áudio mais curto ou em texto.' };
    }
    return {
      error: '🎙 falhou ao baixar ou transcrever o áudio — tente de novo ou mande em texto.',
    };
  }
}

export async function handleUpdate(
  sql: Sql,
  ctx: TelegramContext,
  update: TelegramUpdate,
  client: TelegramClient,
  opts: { media?: MediaProviders } = {},
): Promise<void> {
  if (!ctx.app.ok) return;

  // ── inline button press ────────────────────────────────────────────────────
  if (update.callback_query) {
    const q = update.callback_query;
    const chat = q.message?.chat;
    if (chat && chat.type !== 'private') {
      await client
        .call('answerCallbackQuery', {
          callback_query_id: q.id,
          text: 'use este bot na conversa privada (DM)',
          show_alert: true,
        })
        .catch(() => {});
      return;
    }
    const userId = String(q.from.id);
    const staffName = await staffNameForTelegramUser(sql, userId);
    if (!staffName) {
      await client
        .call('answerCallbackQuery', {
          callback_query_id: q.id,
          text: `🔒 só a equipe pode agir. Seu ID: ${userId}`,
          show_alert: true,
        })
        .catch(() => {});
      return;
    }
    const c: CommandCtx = {
      sql,
      ctx,
      staffName,
      userId,
      chatId: String(chat?.id ?? q.from.id),
      actionKey: q.id,
    };
    try {
      await runCallback(
        c,
        {
          callbackId: q.id,
          data: q.data ?? '',
          chatId: c.chatId,
          messageId: q.message ? String(q.message.message_id) : null,
        },
        client,
      );
    } catch (e) {
      wlog.error({ err: e, data: q.data }, 'telegram callback failed');
      await client
        .call('answerCallbackQuery', {
          callback_query_id: q.id,
          text: 'algo deu errado — tente de novo ou use o CRM',
          show_alert: true,
        })
        .catch(() => {});
    }
    return;
  }

  // ── DM message / command / card reply / voice note / AI manager chat ───────
  const msg = update.message;
  if (!msg || !msg.from || msg.from.is_bot) return;
  if (msg.chat.type !== 'private') return;
  const userId = String(msg.from.id);
  const chatId = String(msg.chat.id);
  const rawCmd = msg.text ? parseCommand(msg.text) : null;

  // one-tap deep-link onboarding: `/start link_<token>` works before userId is on Equipe
  if (rawCmd?.name === 'start' && rawCmd.arg.startsWith('link_')) {
    const token = rawCmd.arg.slice('link_'.length).trim();
    if (!token) {
      await sendCard(client, chatId, strangerReply(userId));
      return;
    }
    const res = await consumeLinkToken(sql, token, {
      id: userId,
      firstName: msg.from.first_name,
      lastName: msg.from.last_name,
      username: msg.from.username,
    });
    if (res.ok) {
      await sendCard(client, chatId, {
        text: [
          `✅ ${b(`pronto, ${esc(res.name)}!`)}`,
          'seu Telegram está conectado à Venduá — os avisos chegam aqui e você pode conversar comigo (texto ou áudio) para acompanhar e orientar o agente de vendas.',
          '',
          `tente ${mono('/agente')}, ${mono('/hoje')}, ${mono('/pendencias')} ou ${mono('/ajuda')}.`,
        ].join('\n'),
      });
    } else if (res.reason === 'full') {
      await sendCard(client, chatId, {
        text: `⚠️ a lista da equipe já atingiu o limite de 20 pessoas — remova alguém em Config → Equipe e gere outro link.`,
      });
    } else {
      await sendCard(client, chatId, {
        text: `⏳ esse link já foi usado ou expirou — gere um novo em ${b('Config → Telegram')} no CRM.\n\n(seu ID do Telegram: ${mono(userId)})`,
      });
    }
    return;
  }

  const staffName = await staffNameForTelegramUser(sql, userId);
  if (!staffName) {
    await sendCard(client, chatId, strangerReply(userId));
    return;
  }

  const c: CommandCtx = {
    sql,
    ctx,
    staffName,
    userId,
    chatId,
    actionKey: `u${update.update_id}`,
  };

  // 1) Slash command
  if (rawCmd) {
    try {
      const reply = await runCommand(c, rawCmd.name, rawCmd.arg);
      await sendCard(client, chatId, reply);
    } catch (e) {
      wlog.error({ err: e, cmd: rawCmd.name }, 'telegram command failed');
      await sendCard(client, chatId, {
        text: 'algo deu errado do nosso lado — tente de novo ou use o CRM.',
      }).catch(() => {});
    }
    return;
  }

  // 2) Resolve text or transcribe voice note
  const resolved = await resolveInboundText(msg, chatId, client, opts.media);
  if (!resolved) {
    await sendCard(client, chatId, {
      text: `mande uma mensagem de texto, um áudio ou um comando como ${mono('/agente')}, ${mono('/hoje')} ou ${mono('/ajuda')}.`,
    });
    return;
  }
  if ('error' in resolved) {
    await sendCard(client, chatId, { text: resolved.error });
    return;
  }
  const { text, voice } = resolved;
  const voiceHeader = voice ? `🎙 ${i(`"${esc(clip(text, 240))}"`)}\n\n` : '';
  const replyToId = msg.reply_to_message ? String(msg.reply_to_message.message_id) : null;
  const idemKey = `telegram:u${update.update_id}`;

  // 3) Reply to a ForceReply prompt button or native swipe-reply on a delivered card
  if (replyToId) {
    try {
      const prompt = await consumePrompt(sql, chatId, replyToId);
      if (prompt) {
        if (prompt.kind === 'teach_rule') {
          const { content, segment } = parseRuleInput(text);
          const saved = await teachRule(sql, {
            content,
            ...(segment ? { segment } : {}),
            idemKey,
          });
          await sendCard(client, chatId, {
            text: [
              `${voiceHeader}📌 ${b('regra gravada na memória do agente')}${saved.segment ? ` (${esc(saved.segment)})` : ''}`,
              quote(saved.content, 500),
            ].join('\n'),
            buttons: row(
              actionButton('🗑 desfazer', `md:${saved.id}`, 'danger'),
              actionButton('📋 ver regras', 'ag:m'),
            ),
          });
          return;
        }
        if (prompt.kind === 'draft_rewrite' && prompt.targetId) {
          const r = await rewriteDraft(sql, {
            messageId: prompt.targetId,
            guidance: text,
            by: staffName,
            idemKey,
          });
          await syncAnchorCards(sql, ctx, client, `draft:${prompt.targetId}`);
          await sendCard(client, chatId, {
            text: `${voiceHeader}✏️ pedi para o agente reescrever o rascunho de ${b(esc(r.leadName))} — o novo chega aqui já já para você aprovar.`,
          });
          return;
        }
        if (prompt.kind === 'handoff_guide' && prompt.targetId) {
          const r = await guideHandoff(sql, {
            taskId: prompt.targetId,
            guidance: text,
            by: staffName,
            idemKey,
          });
          await syncAnchorCards(sql, ctx, client, `handoff:${prompt.targetId}`);
          await sendCard(client, chatId, {
            text: `${voiceHeader}🤖 orientação enviada para o agente em ${b(esc(r.leadName))} — handoff resolvido e agente retomado.`,
          });
          return;
        }
        if (prompt.kind === 'handoff_direct' && prompt.targetId) {
          const r = await directReplyToLead(sql, {
            taskId: prompt.targetId,
            body: text,
            by: staffName,
            idemKey,
          });
          await syncAnchorCards(sql, ctx, client, `handoff:${prompt.targetId}`);
          await sendCard(client, chatId, {
            text: `${voiceHeader}✉️ mensagem enviada direto para ${b(esc(r.leadName))} (${label('channel', r.channel)}) — agente mantido pausado neste lead.`,
          });
          return;
        }
        if (prompt.kind === 'lead_guide' && prompt.targetId) {
          const r = await guideLead(sql, {
            leadId: prompt.targetId,
            guidance: text,
            by: staffName,
            idemKey,
          });
          await sendCard(client, chatId, {
            text: `${voiceHeader}🤖 orientação enviada para o agente em ${b(esc(r.leadName))}.`,
          });
          return;
        }
        if (prompt.kind === 'campaign_guide' && prompt.targetId) {
          const { guideCampaign } = await import('../../crm/campaigns.ts');
          const r = await guideCampaign(sql, {
            campaignId: prompt.targetId,
            guidance: text,
            by: staffName,
            idemKey,
          });
          await syncAnchorCards(sql, ctx, client, `campaign:${prompt.targetId}`);
          await sendCard(client, chatId, {
            text: `${voiceHeader}🚀 orientação aplicada na campanha ${b(esc(r.campaign.title))} — diretor acordado para ajustar o rumo agora.`,
          });
          return;
        }
      }

      const cardTarget = await lookupRepliedCard(sql, chatId, replyToId);
      if (cardTarget) {
        if (cardTarget.kind === 'draft') {
          const r = await rewriteDraft(sql, {
            messageId: cardTarget.messageId,
            guidance: text,
            by: staffName,
            idemKey,
          });
          await syncAnchorCards(sql, ctx, client, `draft:${cardTarget.messageId}`);
          await sendCard(client, chatId, {
            text: `${voiceHeader}✏️ pedi para o agente reescrever o rascunho de ${b(esc(r.leadName))} — o novo chega aqui já já para você aprovar.`,
          });
          return;
        }
        if (cardTarget.kind === 'handoff') {
          const r = await guideHandoff(sql, {
            taskId: cardTarget.taskId,
            guidance: text,
            by: staffName,
            idemKey,
          });
          await syncAnchorCards(sql, ctx, client, `handoff:${cardTarget.taskId}`);
          await sendCard(client, chatId, {
            text: `${voiceHeader}🤖 orientação enviada para o agente em ${b(esc(r.leadName))} — handoff resolvido e agente retomado.`,
          });
          return;
        }
        if (cardTarget.kind === 'campaign') {
          const { guideCampaign } = await import('../../crm/campaigns.ts');
          const r = await guideCampaign(sql, {
            campaignId: cardTarget.campaignId,
            guidance: text,
            by: staffName,
            idemKey,
          });
          await syncAnchorCards(sql, ctx, client, `campaign:${cardTarget.campaignId}`);
          await sendCard(client, chatId, {
            text: `${voiceHeader}🚀 orientação aplicada na campanha ${b(esc(r.campaign.title))} — diretor acordado para ajustar o rumo agora.`,
          });
          return;
        }
        if (cardTarget.kind === 'lead') {
          const r = await guideLead(sql, {
            leadId: cardTarget.leadId,
            guidance: text,
            by: staffName,
            idemKey,
          });
          await sendCard(client, chatId, {
            text: `${voiceHeader}🤖 orientação enviada para o agente em ${b(esc(r.leadName))}.`,
          });
          return;
        }
      }
    } catch (e) {
      if (!(e instanceof HttpError))
        wlog.error({ err: e, replyToId }, 'telegram card reply failed');
      await sendCard(client, chatId, { text: `⚠️ ${esc(refusal(e))}` }).catch(() => {});
      return;
    }
  }

  // 4) Free-text or voice chat → dispatch to the `crm-manager` Agent Runtime v3 actor
  await client.sendTyping(chatId);
  if (voice) {
    await sendCard(
      client,
      chatId,
      { text: `🎙 ${i(`"${esc(clip(text, 300))}"`)}` },
      { silent: true, replyTo: String(msg.message_id) },
    ).catch(() => {});
  }
  try {
    await controlTx(sql, (tx) =>
      dispatchTx(tx, {
        actor: {
          tenantId: PLATFORM_TENANT_ID,
          agentId: CRM_MANAGER_AGENT_ID,
          subject: { kind: CRM_MANAGER_SUBJECT, id: chatId },
        },
        kind: 'message.inbound',
        source: `telegram:${staffName}`.slice(0, 120),
        dedupeKey: `tg:mgr:${chatId}:${msg.message_id}`,
        payload: { text: text.slice(0, 4000), staffName, voice },
      }),
    );
  } catch (e) {
    wlog.error({ err: e, chatId }, 'telegram crm-manager dispatch failed');
    await sendCard(client, chatId, {
      text: `⚠️ não consegui acionar o gerente de vendas agora — tente ${mono('/agente')} ou ${mono('/hoje')}.`,
    }).catch(() => {});
  }
}
