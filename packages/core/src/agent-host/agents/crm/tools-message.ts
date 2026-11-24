import { defineTool, s, type Json } from '@vendua/agent-runtime';
import type { Sql } from '../../../platform/db.ts';
import {
  DEFAULT_GUARDRAILS,
  getSettingTx,
  type Guardrails,
} from '../../../modules/integrations.ts';
import { recordBlockedSendTx } from '../../../modules/channel-health.ts';
import { recordStaffEventTx } from '../../../modules/staff-events.ts';
import {
  channel,
  composeMessageTx,
  isSendChannel,
  type SendChannel,
} from '../../../modules/threads.ts';
import { dropLeadMailTx } from '../../../crm/agenda.ts';
import { crmOfferTx, crmSignupLink } from '../../../crm/signup.ts';
import { workspaceOf } from './availability.ts';
import { CRM_OUTBOX_CHANNEL } from '../../../crm/outbox.ts';
import {
  agentPausedForChannelTx,
  checkSendAllowedTx,
  resolveChannelTx,
} from '../../../crm/guardrails.ts';
import {
  hasUnresolvedTemplate,
  messageStyleIssues,
  normalizeMessageBody,
} from '../../../crm/style.ts';
import { MESSAGE_BODY, MESSAGE_SUBJECT } from './fields.ts';
import { crm, emitAfter, leadOf, refusals, turn, type Ctx } from './shared.ts';

// The lead agent's only ways to reach a person. A message is a lead_messages row written in the
// step's transaction (ADR 0030 decision 4): a draft for staff to approve, or `queued` for the CRM
// outbox (crm/outbox.ts) to deliver once the step commits. The send is the commit point: the
// runtime preempts a send-effect tool when the lead wrote again, so no answer goes out stale.

/** Staff's pin for this turn (a first contact's channel, an inbound's own channel). */
function override(ctx: Ctx): SendChannel | null {
  const c = turn(ctx.state).params.channel;
  return isSendChannel(c) ? c : null;
}

/** The first message of a turn that sounds like a robot goes back once; the next goes as written. */
function styleBounce(ctx: Ctx, body: string, ch: string | null): Json | null {
  if (turn(ctx.state).styleBounced) return null;
  const issues = messageStyleIssues(body, ch);
  if (!issues.length) return null;
  return {
    error:
      'ESTILO — a mensagem não saiu: soa como robô. Reescreva como uma pessoa digitaria no celular e chame de novo.',
    issues,
    styleBounced: true,
  } as unknown as Json;
}

const notifyOutbox = (tx: Sql) => tx`select pg_notify(${CRM_OUTBOX_CHANNEL}, '')`;
const TEMPLATE_FAILURE = {
  code: 'unresolved_template',
  error: 'A mensagem contém um placeholder. Retire ou preencha com um valor confirmado.',
};

export const draftMessageTool = defineTool<
  { channel?: string | undefined; body: string; subject?: string | undefined },
  Sql
>({
  name: 'draft_message',
  description:
    'Draft an outbound message for human approval — always allowed, never sends. Omit channel to auto-pick the reachable one (last inbound channel, else whatsapp > instagram > email); if you pass a dead channel you get {blocked, reason, use} — retry on `use`. No send channel reaching the lead → channel "manual": staff sends it by hand. Instagram DMs max 1000 chars.',
  effect: 'write',
  input: s.object({
    channel: s.enum(['email', 'whatsapp', 'instagram', 'manual']).optional(),
    body: MESSAGE_BODY,
    subject: MESSAGE_SUBJECT,
  }),
  run: (ctx: Ctx, input) =>
    refusals(async () => {
      const leadId = leadOf(ctx);
      const body = normalizeMessageBody(input.body);
      if (hasUnresolvedTemplate(body, input.subject)) return TEMPLATE_FAILURE;
      const bounced = styleBounce(ctx, body, input.channel ?? override(ctx));
      if (bounced) return bounced;
      const out = await crm(ctx, async (tx) => {
        const pick = await resolveChannelTx(tx, leadId, {
          requested: input.channel ? channel(input.channel) : null,
          override: override(ctx),
          threadId: turn(ctx.state).params.threadId ?? null,
        });
        if (!pick.ok)
          return { blocked: true, reason: pick.reason, use: pick.available[0] ?? 'manual' };
        // same pause check as send_message — a staff-paused thread gets no output, drafts included
        if (await agentPausedForChannelTx(tx, leadId, pick.channel))
          return { blocked: true, reason: 'thread paused for agent' };
        const composed = await composeMessageTx(tx, {
          leadId,
          channel: pick.channel,
          body,
          ...(input.subject ? { subject: input.subject } : {}),
          author: 'agent',
          status: 'draft',
          agentRunId: ctx.turnId,
        });
        return { ...composed.body, channel: pick.channel, via: pick.via };
      });
      if (!('blocked' in out)) {
        emitAfter(ctx, 'draft.change', out.thread.id);
        emitAfter(ctx, 'thread.message', out.thread.id);
      }
      return out as unknown as Json;
    }),
});

const URL_RE = /https?:\/\/[^\s<>()]+/gi;
const BRL_RE = /R\$\s*(\d+(?:\.\d{3})*(?:,\d{1,2})?)|\bBRL\s*(\d+(?:[.,]\d{1,2})?)/gi;
const REAIS_RE = /\b(\d+(?:\.\d{3})*(?:,\d{1,2})?)\s*reais\b/gi;
const PCT_RE = /(\d+(?:[.,]\d+)?)\s*%/g;
const TRIAL_DAYS_RE = /\b(\d+)\s*dias\s+(?:gr[áa]tis|de\s+teste)\b/gi;
const ZERO_FEE_RE = /\b(?:sem|zero)\s+(?:taxa|comiss[aã]o)\b/i;

function parseBrCents(raw: string): number | null {
  const clean = raw.includes(',')
    ? raw.replaceAll('.', '').replace(',', '.')
    : raw.replace(/\.(?=\d{3}\b)/g, '');
  const n = Number(clean);
  return Number.isFinite(n) ? Math.round(n * 100) : null;
}

function extractCents(text: string): number[] {
  const out: number[] = [];
  for (const re of [BRL_RE, REAIS_RE]) {
    re.lastIndex = 0;
    for (const m of text.matchAll(re)) {
      const c = parseBrCents(m[1] ?? m[2] ?? '');
      if (c !== null) out.push(c);
    }
  }
  return out;
}

function extractBps(text: string): number[] {
  PCT_RE.lastIndex = 0;
  const out: number[] = [];
  for (const m of text.matchAll(PCT_RE)) {
    const n = Number((m[1] ?? '').replace(',', '.'));
    if (Number.isFinite(n)) out.push(Math.round(n * 100));
  }
  return out;
}

function extractTrialDays(text: string): number[] {
  TRIAL_DAYS_RE.lastIndex = 0;
  return [...text.matchAll(TRIAL_DAYS_RE)].map((m) => Number(m[1])).filter(Number.isFinite);
}

/** Pulls only lines the lead wrote from the rendered subject context so the agent can echo numbers the lead brought up (e.g. "27% no iFood"). */
function leadSpokenText(subjectText: string): string {
  return subjectText
    .split('\n')
    .filter(
      (line) => /^\[[^\]]+\]\s+LEAD\b/.test(line) || line.startsWith('PEDIDO DE RETORNO DO SITE'),
    )
    .join('\n');
}

export interface CommercialCheckInput {
  body: string;
  offerText: string;
  bookingUrl: string | null;
  leadText: string;
  checkedCatalog: boolean;
  plans?: readonly { priceCents: number | null; feeBps: number; trialDays: number }[];
}

/**
 * Verifies links, prices, fees and trial days in outbound agent copy against the live catalog,
 * approved OFERTA and numbers the lead themselves stated — blocking invented claims while letting
 * the model write natural, conversational Portuguese.
 */
export function checkCommercialMessage(c: CommercialCheckInput): string | null {
  const approvedLinks: readonly string[] = (c.offerText.match(URL_RE) ?? []).map((u) =>
    u.replace(/[.,!?;:)]+$/, ''),
  );
  const urls = c.body.match(URL_RE) ?? [];
  if (
    urls.some((url) => {
      const clean = url.replace(/[.,!?;:)]+$/, '');
      return clean !== c.bookingUrl && !approvedLinks.includes(clean);
    })
  ) {
    return 'Use send_signup_link para enviar um link de cadastro oficial.';
  }

  const cents = extractCents(c.body);
  const hasMoneyToken = cents.length > 0 || /R\$|\bBRL\b|\breais\b/i.test(c.body);
  const bps = extractBps(c.body);
  const zeroFee = ZERO_FEE_RE.test(c.body);
  const trials = extractTrialDays(c.body);

  if (!hasMoneyToken && !bps.length && !zeroFee && !trials.length) return null;

  const offerCents = new Set(extractCents(c.offerText));
  const offerBps = new Set(extractBps(c.offerText));
  const offerTrials = new Set(extractTrialDays(c.offerText));
  const leadBps = new Set(extractBps(c.leadText).filter((b) => b > 0));

  // Empathizing with a non-zero percentage the lead brought up (e.g. "27% no iFood") needs no catalog call;
  // 0% claims always verify against the live catalog.
  if (
    !hasMoneyToken &&
    !zeroFee &&
    !trials.length &&
    bps.every((b) => (b > 0 && leadBps.has(b)) || offerBps.has(b))
  ) {
    return null;
  }

  if (!c.checkedCatalog) {
    return 'Consulte get_sales_offer antes de informar preços, taxas ou dias de teste (ou use send_signup_link com includePrice para enviar preços e taxas vigentes).';
  }

  const plans = c.plans ?? [];
  const allowedCents = new Set([
    ...plans.map((p) => p.priceCents).filter((v): v is number => v !== null),
    ...offerCents,
  ]);
  const allowedBps = new Set([...plans.map((p) => p.feeBps), ...offerBps, ...leadBps]);
  const allowedTrials = new Set([
    ...plans.map((p) => p.trialDays).filter((d) => d > 0),
    ...offerTrials,
  ]);

  if (hasMoneyToken && (cents.length === 0 || cents.some((v) => !allowedCents.has(v)))) {
    return 'Preço não confere com o catálogo vigente. Use apenas valores retornados por get_sales_offer (ou use send_signup_link com includePrice).';
  }
  if (bps.some((b) => !allowedBps.has(b))) {
    return 'Percentual não confere com o catálogo vigente. Use apenas taxas retornadas por get_sales_offer.';
  }
  if (zeroFee && !plans.some((p) => p.feeBps === 0)) {
    return 'Os planos vigentes não têm taxa zero por pedido. Confira get_sales_offer.';
  }
  if (trials.some((d) => !allowedTrials.has(d))) {
    return 'Dias de teste não conferem com o catálogo vigente. Use apenas o prazo retornado por get_sales_offer.';
  }
  return null;
}

export const sendMessageTool = defineTool<
  { channel?: string | undefined; body: string; subject?: string | undefined },
  Sql
>({
  name: 'send_message',
  description:
    'Send an outbound message now. Guardrails decide whether it queues (auto mode) or falls back to draft. Omit channel to auto-pick the reachable one; a dead channel returns {blocked, reason, use} — retry on `use`. Official signup URLs must never be written here. Prices, fees and trial days are verified against the live catalog. Instagram DMs max 1000 chars.',
  effect: 'send',
  input: s.object({
    channel: s.enum(['email', 'whatsapp', 'instagram']).optional(),
    body: MESSAGE_BODY,
    subject: MESSAGE_SUBJECT,
  }),
  run: async (ctx: Ctx, input) => {
    const offerText = workspaceOf(ctx.state.context.tenant)?.pitch.offer ?? '';
    const subject = ctx.state.context.subject as {
      bookingUrl?: string | null;
      text?: string;
    } | null;
    const checkedCatalog = turn(ctx.state).actions.includes('get_sales_offer');
    const plans = checkedCatalog ? (await crm(ctx, crmOfferTx)).plans : undefined;
    const issue = checkCommercialMessage({
      body: input.body,
      offerText,
      bookingUrl: subject?.bookingUrl ?? null,
      leadText: leadSpokenText(subject?.text ?? ''),
      checkedCatalog,
      ...(plans ? { plans } : {}),
    });
    if (issue) return { error: issue };
    return composeAgentSend(ctx, input);
  },
});

export const getSalesOfferTool = defineTool<Record<string, never>, Sql>({
  name: 'get_sales_offer',
  description:
    'Read current public plans, monthly prices in cents, rates in basis points, trial days, features and whether online signup is open. Trial eligibility is confirmed during signup.',
  effect: 'read',
  input: s.object({}),
  run: async (ctx) => (await crm(ctx, crmOfferTx)) as unknown as Json,
});

export const sendSignupLinkTool = defineTool<
  {
    planId: string;
    includePrice?: boolean | undefined;
    includeLink?: boolean | undefined;
    intro?: string | undefined;
    outro?: string | undefined;
  },
  Sql
>({
  name: 'send_signup_link',
  description:
    'Send the official signup link for an available plan when the lead truly wants to start (never on a brief curiosity reply like "sim"). Add a short, natural `intro` (and optional `outro`) tailored to the lead so it reads like a real human conversation. Core inserts the approved current price, fee, trial note and signed link. Use includeLink=false only for a price-only quote.',
  effect: 'send',
  input: s.object({
    planId: s.string({ min: 2, max: 30 }),
    includePrice: s.boolean().optional(),
    includeLink: s.boolean().optional(),
    intro: s
      .string({ max: 600 })
      .describe(
        'short natural opening before the price/link, answering the lead and tying the plan to their shop (no URLs; skip repeating the price when includePrice=true)',
      )
      .optional(),
    outro: s
      .string({ max: 300 })
      .describe('short warm closing or one light follow-up question after the price/link')
      .optional(),
  }),
  run: async (ctx, input) => {
    const offer = await crm(ctx, crmOfferTx);
    const wantsLink = input.includeLink !== false;
    if (wantsLink && !offer.signupOpen)
      return {
        code: 'signup_closed',
        error:
          'O cadastro online está fechado agora. Ofereça ajuda na conversa se a pessoa quiser começar.',
      };
    const plan = offer.plans.find((p) => p.id === input.planId);
    if (!plan) {
      return {
        code: 'plan_unavailable',
        error: 'Esse plano está indisponível. Consulte o catálogo vigente para ver opções abertas.',
      };
    }
    if (!wantsLink && (!input.includePrice || plan.priceCents === null)) {
      return {
        code: 'price_unavailable',
        error: 'Não há preço para enviar com esses parâmetros.',
      };
    }
    const link = wantsLink ? crmSignupLink(leadOf(ctx), plan.id) : null;
    if (wantsLink && !link) {
      return { code: 'link_unavailable', error: 'O link oficial não pôde ser criado.' };
    }

    const intro = input.intro ? normalizeMessageBody(input.intro) : '';
    const outro = input.outro ? normalizeMessageBody(input.outro) : '';
    if (hasUnresolvedTemplate(intro) || hasUnresolvedTemplate(outro)) return TEMPLATE_FAILURE;
    if (intro || outro) {
      const offerText = workspaceOf(ctx.state.context.tenant)?.pitch.offer ?? '';
      const subject = ctx.state.context.subject as {
        bookingUrl?: string | null;
        text?: string;
      } | null;
      const issue = checkCommercialMessage({
        body: [intro, outro].filter(Boolean).join('\n'),
        offerText,
        bookingUrl: subject?.bookingUrl ?? null,
        leadText: leadSpokenText(subject?.text ?? ''),
        checkedCatalog: true,
        plans: offer.plans,
      });
      if (issue) return { error: issue };
    }

    const formattedPrice =
      plan.priceCents !== null
        ? (plan.priceCents / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
        : null;
    const formattedFee = (plan.feeBps / 100).toLocaleString('pt-BR');
    const trialSuffix =
      plan.trialDays > 0
        ? ` e ${plan.trialDays} dias de teste grátis (confirmados no cadastro)`
        : '';
    const priceLine =
      input.includePrice && formattedPrice
        ? `O ${plan.name} fica ${formattedPrice}/mês, com ${formattedFee}% de taxa da Venduá por pedido${trialSuffix}.`
        : '';
    const standaloneTrial =
      !priceLine && plan.trialDays > 0 && !/\bteste\b/i.test(`${intro} ${outro}`)
        ? `Os ${plan.trialDays} dias de teste grátis são confirmados no cadastro.`
        : '';
    const linkLine = link
      ? intro && /\b(?:link|por aqui|cadastro)\b/i.test(intro)
        ? link
        : `Por aqui você cria sua loja no ${plan.name}:\n${link}`
      : '';
    const coreBlock = [priceLine, linkLine, standaloneTrial].filter(Boolean).join('\n');
    return composeAgentSend(ctx, {
      body: [intro, coreBlock, outro].filter(Boolean).join('\n\n'),
    });
  },
});

function composeAgentSend(
  ctx: Ctx,
  input: { channel?: string | undefined; body: string; subject?: string | undefined },
): Promise<Json> {
  return refusals(async () => {
    const leadId = leadOf(ctx);
    const t = turn(ctx.state);
    const draftOnly = t.params.draftOnly === true;
    const body = normalizeMessageBody(input.body);
    if (hasUnresolvedTemplate(body, input.subject)) return TEMPLATE_FAILURE;
    const bounced = styleBounce(ctx, body, input.channel ?? override(ctx));
    if (bounced) return bounced;
    const out = await crm(ctx, async (tx) => {
      // serializes concurrent sends so the unanswered cap sees the winner's row
      await tx`select pg_advisory_xact_lock(hashtext(${`send:${leadId}`}))`;
      const [already] = await tx`
          select 1 from lead_messages m
          join lead_threads t on t.id = m.thread_id
          where t.lead_id = ${leadId} and m.agent_run_id = ${ctx.turnId}
            and m.status in ('draft', 'queued', 'sending', 'sent', 'delivered')
          limit 1`;
      if (already) return { blocked: true, reason: 'already dispatched by this turn' };
      const pick = await resolveChannelTx(tx, leadId, {
        requested: input.channel ? channel(input.channel) : null,
        override: override(ctx),
        threadId: t.params.threadId ?? null,
      });
      if (!pick.ok) return { blocked: true, reason: pick.reason, use: pick.available[0] ?? null };
      // pause applies per (lead, channel) — a lead-wide handoff survives a channel hop
      if (await agentPausedForChannelTx(tx, leadId, pick.channel))
        return { blocked: true, reason: 'thread paused for agent' };
      // draft-only turns skip the verdict — a draft never leaves anyway
      const verdict = draftOnly
        ? ({ ok: true, forceDraft: false, retryAt: undefined } as const)
        : await checkSendAllowedTx(
            tx,
            {
              ...DEFAULT_GUARDRAILS,
              ...(await getSettingTx<Partial<Guardrails>>(tx, 'guardrails', {})),
            },
            leadId,
            pick.channel,
          );
      if (!verdict.ok && !verdict.retryAt) {
        // durable signal for the channel-health rollup — blocks otherwise leave no record
        await recordBlockedSendTx(tx, leadId, pick.channel, verdict.reason ?? 'guardrail');
        return { blocked: true, reason: verdict.reason };
      }
      const drafted = verdict.forceDraft || draftOnly;
      const composed = await composeMessageTx(tx, {
        leadId,
        channel: pick.channel,
        body,
        ...(input.subject ? { subject: input.subject } : {}),
        author: 'agent',
        status: drafted ? 'draft' : 'queued',
        agentRunId: ctx.turnId,
        ...(verdict.retryAt ? { sendAfter: verdict.retryAt } : {}),
      });
      if (!drafted) await notifyOutbox(tx);
      return {
        ...composed.body,
        draftFallback: drafted,
        ...(verdict.retryAt ? { retryAt: verdict.retryAt.toISOString() } : {}),
        channel: pick.channel,
        via: pick.via,
        ...(pick.prevChannel && pick.prevChannel !== pick.channel
          ? { switchedFrom: pick.prevChannel }
          : {}),
      };
    });
    if (!('blocked' in out)) {
      emitAfter(ctx, 'thread.message', out.thread.id);
      if (out.draftFallback) emitAfter(ctx, 'draft.change', out.thread.id);
    }
    return out as unknown as Json;
  });
}

export const unsubscribeTool = defineTool<
  { reason?: string | undefined; reply?: string | undefined },
  Sql
>({
  name: 'unsubscribe',
  description:
    'The sender asked to stop receiving messages / be removed — opts the lead out (unsubscribed_at). `reply` is an optional one-line farewell sent as the final message; never send anything else after calling this.',
  effect: 'send',
  input: s.object({
    reason: s.string({ max: 200 }).optional(),
    reply: s
      .string({ max: 500 })
      .describe("one short line in the lead's own register, no pitch, no question")
      .optional(),
  }),
  run: (ctx: Ctx, input) =>
    refusals(async () => {
      const leadId = leadOf(ctx);
      const draftOnly = turn(ctx.state).params.draftOnly === true;
      const reply = input.reply ? normalizeMessageBody(input.reply).slice(0, 500) : null;
      const reason = input.reason?.slice(0, 200) ?? null;
      // one transaction under the send:lead lock: farewell + opt-out stamp + note — a concurrent
      // send serializes behind it and sees the opt-out; only is_farewell survives
      const out = await crm(ctx, async (tx) => {
        await tx`select pg_advisory_xact_lock(hashtext(${`send:${leadId}`}))`;
        let threadId: string | null = null;
        let sendBlocked: string | null =
          reply && hasUnresolvedTemplate(reply) ? TEMPLATE_FAILURE.code : null;
        let drafted = false;
        let queued = false;
        if (reply && !sendBlocked) {
          const pick = await resolveChannelTx(tx, leadId, {
            requested: null,
            override: override(ctx),
            threadId: turn(ctx.state).params.threadId ?? null,
          });
          if (!pick.ok) sendBlocked = pick.reason ?? 'no channel';
          else {
            const g = await getSettingTx(tx, 'guardrails', {} as Partial<Guardrails>);
            const verdict = draftOnly
              ? ({ ok: true, forceDraft: false } as const)
              : await checkSendAllowedTx(tx, { ...DEFAULT_GUARDRAILS, ...g }, leadId, pick.channel);
            if (!verdict.ok) {
              sendBlocked = verdict.reason ?? 'guardrail';
              await recordBlockedSendTx(tx, leadId, pick.channel, sendBlocked);
            } else {
              // forceDraft keeps the opt-out but the farewell becomes an approval draft
              drafted = verdict.forceDraft || draftOnly;
              const composed = await composeMessageTx(tx, {
                leadId,
                channel: pick.channel,
                body: reply,
                author: 'agent',
                status: drafted ? 'draft' : 'queued',
                agentRunId: ctx.turnId,
                farewell: true,
              });
              threadId = composed.body.thread.id;
              queued = !drafted;
              if (queued) await notifyOutbox(tx);
            }
          }
        }
        const [changed] = await tx<{ name: string; business_name: string | null }[]>`
          update leads set unsubscribed_at = now(), updated_at = now()
          where id = ${leadId} and unsubscribed_at is null
          returning name, business_name`;
        if (changed) {
          // opt-out never lifts: what still waits for this lead's agent goes
          await dropLeadMailTx(tx, leadId);
          await tx`
            insert into lead_activities (lead_id, kind, body, created_by)
            values (${leadId}, 'system', ${`Pediu para sair — opt-out registrado${reason ? ` (${reason})` : ''}`}, 'agent')`;
          await recordStaffEventTx(tx, 'lead.unsubscribed', {
            leadId,
            leadName: changed.name,
            business: changed.business_name,
            by: 'agent',
            reason,
          });
        }
        return { threadId, sendBlocked, drafted, queued, changed: !!changed };
      });
      if (out.threadId) {
        emitAfter(ctx, 'thread.message', out.threadId);
        if (out.drafted) emitAfter(ctx, 'draft.change', out.threadId);
      }
      if (out.changed) emitAfter(ctx, 'lead.change', leadId);
      return {
        unsubscribed: true,
        farewellSent: out.queued,
        ...(out.drafted ? { farewellDrafted: true } : {}),
        ...(out.sendBlocked ? { farewellBlocked: out.sendBlocked } : {}),
      };
    }),
});
