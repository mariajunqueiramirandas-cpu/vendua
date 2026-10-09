import {
  CATEGORY_META,
  STAFF_EVENT_KINDS,
  type DailyDigest,
  type Severity,
  type StaffEventKind,
  type StaffEventMap,
} from '../staff-events.ts';
import {
  COLORS,
  COLOR_DONE,
  actionButton,
  brl,
  clip,
  code,
  duration,
  esc,
  int,
  label,
  linkButton,
  quote,
  row,
  ts,
  usd,
  type ActionRow,
  type Embed,
  type EmbedField,
  type MessagePayload,
} from './format.ts';
import type { DuaPose } from './config.ts';
import { onboardingSteps, type StoreSnapshot } from './snapshot.ts';

// One card per event; events that share an anchor are rendered from the anchor's whole
// history, so an edit always shows the current state (ADR 0023 "living cards"). A renderer
// is pure: the dispatcher loads history and live reads, then posts or edits what comes back.

export interface EventRow<K extends StaffEventKind = StaffEventKind> {
  id: number;
  kind: K;
  tenant_id: string | null;
  severity: Severity;
  anchor: string | null;
  data: StaffEventMap[K];
  created_at: Date | string;
}

export interface RenderCtx {
  crm: (path: string) => string;
  /** lead conversation text may leave our infrastructure */
  excerpts: boolean;
  storeUrl: string | null;
  /** the onboarding card's live checklist */
  store: StoreSnapshot | null;
  /** which categories land in this channel (the test card lists them) */
  routedHere: string[];
  now: Date;
  /** Duá's art for the cards that mark a moment; without it cards go out bare */
  art?: ((pose: DuaPose) => string) | undefined;
}

export interface Rendered {
  card: MessagePayload;
  /** a follow-up worth a notification of its own, posted as a reply under the card */
  reply?: string | null;
}

/** custom_id grammar: `v1:<family>:<action>:<id>` — parsed back in interactions.ts */
export const cid = (family: string, action: string, id: string) => `v1:${family}:${action}:${id}`;

type Ev<K extends StaffEventKind> = EventRow<K>;
const all = <K extends StaffEventKind>(h: EventRow[], k: K) =>
  h.filter((e) => e.kind === k) as Ev<K>[];
const first = <K extends StaffEventKind>(h: EventRow[], k: K) => all(h, k)[0];
const lastOf = <K extends StaffEventKind>(h: EventRow[], k: K) => all(h, k).at(-1);
const isoOf = (at: Date | string) => new Date(at).toISOString();

type CardInput = {
  [K in keyof Omit<Embed, 'author' | 'timestamp'>]?: Embed[K] | undefined;
} & { at?: Date | string | undefined };

function card(ev: EventRow, embed: CardInput, components: ActionRow[] = []): MessagePayload {
  const meta = CATEGORY_META[STAFF_EVENT_KINDS[ev.kind].category];
  const { at, ...rest } = embed;
  const set = Object.fromEntries(Object.entries(rest).filter(([, v]) => v !== undefined));
  return {
    embeds: [
      {
        author: { name: `${meta.emoji} ${meta.label}` },
        timestamp: isoOf(at ?? ev.created_at),
        color: COLORS[ev.severity],
        ...(set as Omit<Embed, 'author' | 'timestamp'>),
      },
    ],
    components,
  };
}

// only key moments carry art: a mascot on every routine card turns a busy channel into wallpaper
const art = (ctx: Pick<RenderCtx, 'art'>, pose: DuaPose | null) =>
  pose && ctx.art ? { url: ctx.art(pose) } : undefined;

const field = (name: string, value: string | null | undefined, inline = true): EmbedField | null =>
  value ? { name, value, inline } : null;
const fields = (...f: (EmbedField | null)[]) => f.filter((x): x is EmbedField => !!x);

const who = (name: string, business: string | null | undefined) =>
  business && business.trim() && business.trim() !== name.trim()
    ? `${esc(name)} · ${esc(business)}`
    : esc(name);

const byLine = (by: string | null | undefined, crmWord = 'no CRM') =>
  !by ? '' : by === 'staff' || by === 'equipe' ? ` ${crmWord}` : ` por ${esc(by)}`;

// ── atendimento ──────────────────────────────────────────────────────────────

function handoff(ev: EventRow, h: EventRow[], ctx: RenderCtx): Rendered {
  const open = first(h, 'handoff.requested');
  const taken = lastOf(h, 'handoff.taken');
  const done = lastOf(h, 'handoff.resolved');
  const d = open?.data;
  const taskId = d?.taskId ?? (ev.data as { taskId: string }).taskId;
  const leadId = d?.leadId ?? (ev.data as { leadId: string }).leadId;
  const url = d?.threadId ? ctx.crm(`/inbox/${d.threadId}`) : ctx.crm(`/pipeline/${leadId}`);
  const status = done
    ? `✅ resolvido${byLine(done.data.by)} ${ts(done.created_at, 'R')}`
    : taken
      ? `🙋 assumido por ${esc(taken.data.by)} ${ts(taken.created_at, 'R')}`
      : `⏳ aberto ${ts(open?.created_at ?? ev.created_at, 'R')}`;
  const msg = card(
    { ...ev, severity: done ? 'success' : taken ? 'info' : 'warning' },
    {
      title: d
        ? `o agente pediu ajuda com ${who(d.leadName, d.business)}`
        : 'handoff para a equipe',
      url,
      description: [d ? quote(d.reason, 1200) : '', '', status].join('\n').trim(),
      fields: fields(field('canal', d?.channel ? label('channel', d.channel) : null)),
      thumbnail: art(ctx, done ? 'avatar-feliz' : 'avatar-ajuda'),
      color: done ? COLOR_DONE : taken ? COLORS.info : COLORS.warning,
      at: open?.created_at,
    },
    row(
      !done && !taken && actionButton('assumir', cid('handoff', 'take', taskId), 1, '🙋'),
      !done && actionButton('resolvido', cid('handoff', 'done', taskId), 3, '✅'),
      linkButton('abrir conversa', url),
    ),
  );
  const reply =
    ev.kind === 'handoff.taken'
      ? `🙋 ${esc((ev.data as StaffEventMap['handoff.taken']).by)} assumiu`
      : ev.kind === 'handoff.resolved'
        ? `✅ handoff resolvido${byLine((ev.data as StaffEventMap['handoff.resolved']).by)}`
        : null;
  return { card: msg, reply };
}

function draft(ev: EventRow, h: EventRow[], ctx: RenderCtx): Rendered {
  const open = first(h, 'draft.pending');
  const res = lastOf(h, 'draft.resolved');
  const d = open?.data;
  const messageId = d?.messageId ?? (ev.data as { messageId: string }).messageId;
  const url = d ? ctx.crm(`/inbox/${d.threadId}`) : ctx.crm('/inbox?f=rascunhos');
  const body = !d
    ? ''
    : ctx.excerpts
      ? `${d.subject ? `**${esc(d.subject)}**\n` : ''}${quote(d.body, 1800, 30)}`
      : '_conteúdo oculto — abra no CRM_';
  const outcome = res?.data.outcome;
  const status =
    outcome === 'approved'
      ? `✅ aprovado${byLine(res!.data.by)} — enviando`
      : outcome === 'rejected'
        ? `✕ rejeitado${byLine(res!.data.by)}`
        : outcome === 'superseded'
          ? '↷ o lead respondeu antes — o agente refaz'
          : `⏳ esperando aprovação desde ${ts(open?.created_at ?? ev.created_at, 'R')}`;
  const msg = card(
    { ...ev, severity: 'info' },
    {
      title: d
        ? `rascunho para ${who(d.leadName, d.business)} · ${label('channel', d.channel)}`
        : 'rascunho do agente',
      url,
      description: [body, '', status].join('\n').trim(),
      color: outcome === 'approved' ? COLORS.success : outcome ? COLOR_DONE : 0x5865f2,
      at: open?.created_at,
    },
    row(
      !res && actionButton('aprovar e enviar', cid('draft', 'approve', messageId), 3, '✅'),
      !res && actionButton('rejeitar', cid('draft', 'reject', messageId), 4),
      linkButton('abrir no CRM', url),
    ),
  );
  return { card: msg, reply: null };
}

function merchantHelp(ev: Ev<'merchant.help'>, ctx: RenderCtx): Rendered {
  const d = ev.data;
  return {
    card: card(
      ev,
      {
        title: `${esc(d.storeName)} pediu ajuda${d.topic && d.topic !== 'geral' ? ` · ${esc(d.topic)}` : ''}`,
        description: quote(d.message, 1800, 30),
        fields: fields(field('quem', esc(d.who)), field('contato', esc(d.contact))),
        thumbnail: art(ctx, 'avatar-ajuda'),
      },
      row(
        ev.tenant_id ? null : linkButton('abrir lojas no CRM', ctx.crm('/lojas')),
        linkButton('ver loja', ctx.storeUrl),
      ),
    ),
  };
}

function storeRequest(ev: Ev<'store.request'>, ctx: RenderCtx): Rendered {
  const d = ev.data;
  return {
    card: card(
      ev,
      { title: `${esc(d.storeName)} · ${esc(d.title)}`, description: quote(d.detail, 1500, 20) },
      row(linkButton('abrir no CRM', ctx.crm('/lojas/planos'))),
    ),
  };
}

// ── site sob medida ──────────────────────────────────────────────────────────

type SiteEv =
  | Ev<'site.task_queued'>
  | Ev<'site.ready'>
  | Ev<'site.escalated'>
  | Ev<'site.due_soon'>
  | Ev<'site.overdue'>
  | Ev<'site.delivered'>;

const SITE_KIND = { generate: 'site', revision: 'ajuste do site' } as const;

function siteCard(
  ev: SiteEv,
  ctx: RenderCtx,
  title: string,
  description: string,
  prUrl: string | null = null,
  pose: DuaPose | null = null,
): Rendered {
  return {
    card: card(
      ev,
      { title: `${esc(ev.data.storeName)} · ${title}`, description, thumbnail: art(ctx, pose) },
      row(
        prUrl ? linkButton('ver o PR', prUrl) : null,
        linkButton('abrir no CRM', ctx.crm(`/lojas/sites/${ev.data.taskId}`)),
      ),
    ),
  };
}

function siteQueued(ev: Ev<'site.task_queued'>, ctx: RenderCtx): Rendered {
  const d = ev.data;
  return siteCard(ev, ctx, `${SITE_KIND[d.kind]} na fila`, `prazo ${ts(d.dueAt, 'R')}`);
}

function siteReady(ev: Ev<'site.ready'>, ctx: RenderCtx): Rendered {
  const d = ev.data;
  const title = `${SITE_KIND[d.kind]} pronto para aprovar`;
  return siteCard(ev, ctx, title, 'o CI ficou verde', d.prUrl);
}

function siteEscalated(ev: Ev<'site.escalated'>, ctx: RenderCtx): Rendered {
  const d = ev.data;
  return siteCard(ev, ctx, `${SITE_KIND[d.kind]} precisa da equipe`, quote(d.reason, 300, 5));
}

function siteDueSoon(ev: Ev<'site.due_soon'>, ctx: RenderCtx): Rendered {
  const d = ev.data;
  return siteCard(ev, ctx, `${SITE_KIND[d.kind]} perto do prazo`, `prazo ${ts(d.dueAt, 'R')}`);
}

function siteOverdue(ev: Ev<'site.overdue'>, ctx: RenderCtx): Rendered {
  const d = ev.data;
  return siteCard(ev, ctx, `${SITE_KIND[d.kind]} atrasado`, `o prazo era ${ts(d.dueAt, 'f')}`);
}

function siteDelivered(ev: Ev<'site.delivered'>, ctx: RenderCtx): Rendered {
  const d = ev.data;
  return siteCard(ev, ctx, `${SITE_KIND[d.kind]} no ar`, `\`${esc(d.slug)}\``, null, 'publicar');
}

function billingManual(ev: Ev<'billing.manual'>, ctx: RenderCtx): Rendered {
  const d = ev.data;
  return {
    card: card(
      ev,
      {
        title: `${esc(d.storeName)} entrou com código de acesso`,
        description: `fatura de **${brl(d.amountCents)}**${d.plan ? ` (${esc(d.plan)})` : ''} esperando baixa — marque como paga no CRM quando o pagamento chegar.`,
      },
      row(linkButton('abrir planos no CRM', ctx.crm('/lojas/planos'))),
    ),
  };
}

// ── crm ──────────────────────────────────────────────────────────────────────

function leadCreated(ev: Ev<'lead.created'>, ctx: RenderCtx): Rendered {
  const d = ev.data;
  return {
    card: card(
      ev,
      {
        title: `lead novo: ${who(d.leadName, d.business)}`,
        url: ctx.crm(`/pipeline/${d.leadId}`),
        description: ctx.excerpts ? quote(d.excerpt, 900) : '',
        fields: fields(field('canal', label('channel', d.channel))),
      },
      row(linkButton('abrir lead', ctx.crm(`/pipeline/${d.leadId}`))),
    ),
  };
}

function leadReplied(ev: Ev<'lead.replied'>, ctx: RenderCtx): Rendered {
  const d = ev.data;
  const url = ctx.crm(`/inbox/${d.threadId}`);
  return {
    card: card(
      ev,
      {
        title: `${who(d.leadName, d.business)} respondeu · ${label('channel', d.channel)}`,
        url,
        description: ctx.excerpts ? quote(d.excerpt, 900) : '',
      },
      row(linkButton('abrir conversa', url)),
    ),
  };
}

function leadMilestone(ev: Ev<'lead.milestone'>, ctx: RenderCtx): Rendered {
  const d = ev.data;
  return {
    card: card(
      ev,
      {
        title: `🎯 ${who(d.leadName, d.business)}: ${label('leadState', d.from)} → ${label('leadState', d.to)}`,
        url: ctx.crm(`/pipeline/${d.leadId}`),
        description:
          d.by === 'agent' ? 'pelo agente' : d.by === 'system' ? 'automático' : 'pela equipe',
      },
      row(linkButton('abrir lead', ctx.crm(`/pipeline/${d.leadId}`))),
    ),
  };
}

function leadUnsubscribed(ev: Ev<'lead.unsubscribed'>, ctx: RenderCtx): Rendered {
  const d = ev.data;
  const how =
    d.by === 'agent'
      ? 'pediu ao agente'
      : d.by === 'complaint'
        ? 'marcou como spam'
        : 'pela equipe';
  return {
    card: card(ev, {
      title: `${who(d.leadName, d.business)} pediu para sair`,
      url: ctx.crm(`/pipeline/${d.leadId}`),
      description: [how, d.reason ? quote(d.reason, 400) : ''].filter(Boolean).join('\n'),
    }),
  };
}

function meeting(ev: EventRow, h: EventRow[], ctx: RenderCtx): Rendered {
  const booked = first(h, 'meeting.booked');
  const change = lastOf(h, 'meeting.changed');
  const base = booked?.data ?? (ev.data as StaffEventMap['meeting.changed']);
  const startsAt = change?.data.startsAt ?? booked?.data.startsAt ?? base.startsAt;
  const cancelled = change?.data.change === 'cancelled';
  const leadUrl = ctx.crm(`/pipeline/${base.leadId}`);
  const msg = card(
    { ...ev, severity: cancelled ? 'warning' : 'success' },
    {
      title: `${cancelled ? 'call cancelada' : 'call marcada'} com ${who(base.leadName, booked?.data.business)}`,
      url: leadUrl,
      description: cancelled
        ? `~~${ts(startsAt, 'F')}~~`
        : `${ts(startsAt, 'F')} (${ts(startsAt, 'R')})${change?.data.change === 'rescheduled' ? '\nremarcada' : ''}`,
      fields: fields(field('origem', booked ? label('meetingSource', booked.data.source) : null)),
      color: cancelled ? COLOR_DONE : COLORS.success,
      at: booked?.created_at,
    },
    row(
      !cancelled && linkButton('entrar na sala', booked?.data.roomUrl),
      linkButton('abrir lead', leadUrl),
    ),
  );
  let reply: string | null = null;
  if (ev.kind === 'meeting.changed') {
    const c = (ev as Ev<'meeting.changed'>).data;
    reply =
      c.change === 'cancelled'
        ? `❌ ${c.by === 'lead' ? `${esc(c.leadName)} cancelou a call` : 'a equipe cancelou a call'}`
        : `📅 call remarcada para ${ts(c.startsAt, 'F')}`;
  }
  return { card: msg, reply };
}

// ── vendas ───────────────────────────────────────────────────────────────────

function order(ev: EventRow, h: EventRow[], ctx: RenderCtx): Rendered {
  const placed = first(h, 'order.placed');
  const updates = all(h, 'order.updated');
  const any = (placed?.data ?? ev.data) as { number: number; storeName: string };
  const latest = updates.at(-1)?.data.to;
  const bad = latest === 'cancelled' || latest === 'refunded';
  const good = latest === 'delivered' || updates.some((u) => u.data.to === 'paid');
  const d = placed?.data;
  const lines: string[] = [];
  if (d) {
    lines.push(
      [
        `**${brl(d.totalCents)}**`,
        label('method', d.method),
        d.fulfillment ? label('fulfillment', d.fulfillment) : null,
        `${int(d.items)} ${d.items === 1 ? 'item' : 'itens'}`,
      ]
        .filter(Boolean)
        .join(' · '),
    );
    if (d.scheduledFor)
      lines.push(
        // a date-only order day: as an instant it would read as the evening before in Brazil
        /^\d{4}-\d{2}-\d{2}$/.test(d.scheduledFor)
          ? `encomenda para ${d.scheduledFor.split('-').reverse().join('/')}`
          : `agendado para ${ts(d.scheduledFor, 'f')}`,
      );
  }
  const steps = [
    ...(placed ? [`recebido ${ts(placed.created_at, 't')}`] : []),
    ...updates.map((u) => `${label('orderStep', u.data.to)} ${ts(u.created_at, 't')}`),
  ];
  if (steps.length) lines.push('', steps.slice(-6).join(' → '));
  const msg = card(
    { ...ev, severity: bad ? 'warning' : good ? 'success' : 'info' },
    {
      title: `pedido #${any.number} · ${esc(any.storeName)}`,
      description: lines.join('\n'),
      color: bad ? COLORS.warning : good ? COLORS.success : COLORS.info,
      at: placed?.created_at,
    },
    row(linkButton('ver loja', ctx.storeUrl)),
  );
  let reply: string | null = null;
  if (ev.kind === 'order.updated') {
    const u = (ev as Ev<'order.updated'>).data;
    if (u.to === 'cancelled') reply = `❌ pedido #${u.number} da ${esc(u.storeName)} foi cancelado`;
    else if (u.to === 'refunded')
      reply = `↩️ pedido #${u.number} da ${esc(u.storeName)} foi reembolsado`;
  }
  return { card: msg, reply };
}

function firstOrder(ev: Ev<'store.first_order'>, ctx: RenderCtx): Rendered {
  const d = ev.data;
  return {
    card: card(
      ev,
      {
        title: `🎉 primeiro pedido da ${esc(d.storeName)}!`,
        description: `pedido #${d.number} · **${brl(d.totalCents)}** · ${label('method', d.method)}`,
        thumbnail: art(ctx, 'sucesso'),
      },
      row(linkButton('ver loja', ctx.storeUrl)),
    ),
  };
}

function paymentProblem(ev: Ev<'payment.problem'>, ctx: RenderCtx): Rendered {
  const d = ev.data;
  return {
    card: card(
      ev,
      {
        title: `pagamento ${label('payment', d.status)} · ${esc(d.storeName)}`,
        description: [
          d.number !== null ? `pedido #${d.number}` : null,
          d.amountCents !== null ? `**${brl(d.amountCents)}**` : null,
        ]
          .filter(Boolean)
          .join(' · '),
        thumbnail: art(ctx, 'seguranca'),
      },
      row(linkButton('ver loja', ctx.storeUrl)),
    ),
  };
}

function paymentsConnection(ev: Ev<'payments.connection'>, ctx: RenderCtx): Rendered {
  const d = ev.data;
  return {
    card: card(
      ev,
      {
        title: `${esc(d.storeName)} ${d.connected ? 'conectou' : 'desconectou'} o Mercado Pago`,
        description: d.detail
          ? esc(d.detail)
          : d.connected
            ? 'a loja já recebe pagamentos online'
            : '',
      },
      row(linkButton('ver loja', ctx.storeUrl)),
    ),
  };
}

const WA_STEP: Record<Ev<'whatsapp.store'>['data']['step'], [string, string]> = {
  connected: ['conectou o WhatsApp da loja', 'os clientes passam a receber os avisos de pedido'],
  back: ['está com o WhatsApp de volta', 'os avisos que esperavam saem agora'],
  lost: ['perdeu a conexão do WhatsApp', 'o gateway segue tentando; avisos esperam até 6 h'],
  logged_out: [
    'teve o WhatsApp desvinculado',
    'o aparelho foi removido no celular: a loja precisa parear de novo',
  ],
  banned: ['teve o WhatsApp recusado', 'o WhatsApp recusou o número (403): falar com a loja'],
  disconnected: ['desconectou o WhatsApp da loja', 'os avisos de pedido aos clientes pararam'],
};

function whatsappStore(ev: Ev<'whatsapp.store'>, ctx: RenderCtx): Rendered {
  const d = ev.data;
  const [title, description] = WA_STEP[d.step];
  return {
    card: card(
      ev,
      {
        title: `${esc(d.storeName)} ${title}`,
        description,
        thumbnail: art(ctx, d.step === 'connected' || d.step === 'back' ? null : 'offline'),
      },
      row(linkButton('ver loja', ctx.storeUrl)),
    ),
  };
}

// ── assinaturas ──────────────────────────────────────────────────────────────

const SOURCE: Record<string, string> = {
  signup: 'cadastro pelo site',
  access_code: 'cadastro com código de acesso',
  invite: 'convite da equipe',
};

const STEP_LABEL: Record<string, string> = {
  paid: 'plano pago',
  live: 'loja no ar',
  first_login: 'primeiro acesso ao painel',
  setup: 'loja montada',
  payments: 'Mercado Pago conectado',
  first_order: 'primeiro pedido',
  domain: 'domínio próprio pronto',
};

function onboarding(ev: EventRow, h: EventRow[], ctx: RenderCtx): Rendered {
  const created = first(h, 'store.created');
  const seen = new Set(all(h, 'store.onboarding').map((e) => e.data.step));
  const s = ctx.store;
  const name = s?.name ?? created?.data.storeName ?? 'loja';
  const steps = s
    ? onboardingSteps(s)
    : [
        { key: 'created', label: 'cadastro', done: !!created },
        ...Object.entries(STEP_LABEL).map(([key, l]) => ({
          key,
          label: l,
          done: seen.has(key as never),
        })),
      ];
  const done = steps.filter((x) => x.done).length;
  const complete = done === steps.length;
  const intro = created
    ? [
        SOURCE[created.data.source] ?? created.data.source,
        created.data.owner ? `dono: ${esc(created.data.owner)}` : null,
        created.data.plan ? `plano ${esc(created.data.plan)}` : null,
        created.data.segment ? `segmento ${esc(created.data.segment)}` : null,
        created.data.trialEndsAt
          ? `teste grátis até ${dayMonthOf(created.data.trialEndsAt)}`
          : null,
      ]
        .filter(Boolean)
        .join(' · ')
    : '';
  const msg = card(
    { ...ev, severity: complete ? 'success' : 'info' },
    {
      title: `loja nova: ${esc(name)}`,
      url: ctx.storeUrl ?? undefined,
      description: [intro, '', ...steps.map((x) => `${x.done ? '✅' : '⬜'} ${x.label}`)]
        .join('\n')
        .trim(),
      footer: { text: `onboarding ${done}/${steps.length}` },
      thumbnail: art(ctx, complete ? 'sucesso' : 'boas-vindas'),
      color: complete ? COLORS.success : COLORS.info,
      at: created?.created_at ?? s?.createdAt,
    },
    row(
      linkButton('ver loja', ctx.storeUrl),
      ev.tenant_id ? null : linkButton('lojas no CRM', ctx.crm('/lojas')),
    ),
  );
  const reply =
    ev.kind === 'store.onboarding'
      ? `✅ ${esc(name)}: ${STEP_LABEL[(ev as Ev<'store.onboarding'>).data.step] ?? 'passo concluído'}`
      : null;
  return { card: msg, reply };
}

function billingPaid(ev: Ev<'billing.paid'>, ctx: RenderCtx): Rendered {
  const d = ev.data;
  return {
    card: card(
      ev,
      {
        title: d.first
          ? `💸 ${esc(d.storeName)} pagou a primeira fatura`
          : `${esc(d.storeName)} renovou o plano`,
        description: [
          `**${brl(d.amountCents)}**`,
          d.plan ? esc(d.plan) : null,
          d.method ? label('method', d.method) : null,
        ]
          .filter(Boolean)
          .join(' · '),
        thumbnail: art(ctx, d.first ? 'pagamento' : null),
      },
      row(linkButton('planos no CRM', ctx.crm('/lojas/planos'))),
    ),
  };
}

const PROBLEM: Record<StaffEventMap['billing.problem']['problem'], string> = {
  card_rejected: 'cartão recusado',
  past_due: 'assinatura vencida',
  cancelled: 'assinatura cancelada',
  trial_ended: 'teste grátis acabou sem pagamento',
  pix_mismatch: 'Pix com valor diferente da fatura',
  other: 'problema na assinatura',
};

function billingProblem(ev: Ev<'billing.problem'>, ctx: RenderCtx): Rendered {
  const d = ev.data;
  return {
    card: card(
      ev,
      {
        title: `${d.title ? esc(d.title) : PROBLEM[d.problem]} · ${esc(d.storeName)}`,
        description: esc(d.detail),
        thumbnail: art(ctx, 'erro'),
      },
      row(linkButton('planos no CRM', ctx.crm('/lojas/planos'))),
    ),
  };
}

function domainReady(ev: Ev<'domain.ready'>): Rendered {
  const d = ev.data;
  return {
    card: card(ev, {
      title: `${esc(d.host)} pronto para ${esc(d.storeName)}`,
      url: `https://${d.host}`,
      description: 'o DNS confere — falta ligar o TLS no CRM, se ainda não estiver ativo',
    }),
  };
}

// ── frota ────────────────────────────────────────────────────────────────────

function releasePublished(ev: Ev<'release.published'>, ctx: RenderCtx): Rendered {
  const d = ev.data;
  return {
    card: card(
      ev,
      {
        title: `release ${d.releaseId.slice(0, 8)} · ${esc(d.bundle)}`,
        description: [
          d.kernel ? `kernel ${esc(d.kernel)}` : null,
          d.promoted
            ? `promovido para ${int(d.promoted)} ${d.promoted === 1 ? 'loja' : 'lojas'}`
            : 'nenhuma loja promovida ainda',
        ]
          .filter(Boolean)
          .join(' · '),
      },
      row(linkButton('frota no CRM', ctx.crm('/lojas/frota'))),
    ),
  };
}

function deploymentFailed(ev: Ev<'deployment.failed'>, ctx: RenderCtx): Rendered {
  const d = ev.data;
  return {
    card: card(
      ev,
      {
        title: `implantação falhou · ${esc(d.storeName)}`,
        description: [
          esc(d.reason),
          d.rolledBackTo
            ? `↩️ voltou sozinha para ${d.rolledBackTo.slice(0, 8)} e ficou fixada`
            : '⚠️ não havia release anterior para voltar',
        ].join('\n'),
        fields: fields(field('release', d.releaseId.slice(0, 8)), field('host', esc(d.host))),
        thumbnail: art(ctx, 'erro'),
      },
      row(
        linkButton('frota no CRM', ctx.crm('/lojas/frota')),
        linkButton('ver loja', ctx.storeUrl),
      ),
    ),
  };
}

const ACTION: Record<StaffEventMap['deployment.manual']['action'], string> = {
  promote: 'promoveu',
  rollback: 'fez rollback de',
  pin: 'fixou',
  unpin: 'soltou',
};

function deploymentManual(ev: Ev<'deployment.manual'>, ctx: RenderCtx): Rendered {
  const d = ev.data;
  return {
    card: card(
      ev,
      {
        title: `${esc(d.by)} ${ACTION[d.action]} ${esc(d.storeName)}`,
        description: d.releaseId ? `release ${d.releaseId.slice(0, 8)}` : '',
      },
      row(linkButton('frota no CRM', ctx.crm('/lojas/frota'))),
    ),
  };
}

function storeLive(ev: Ev<'store.live'>, ctx: RenderCtx): Rendered {
  const d = ev.data;
  const url = d.host ? `https://${d.host}` : ctx.storeUrl;
  return {
    card: card(
      ev,
      {
        title: `🚀 ${esc(d.storeName)} está no ar`,
        url: url ?? undefined,
        description: esc(d.host),
        thumbnail: art(ctx, 'publicar'),
      },
      row(linkButton('ver loja', url)),
    ),
  };
}

function incident(ev: EventRow, h: EventRow[], ctx: RenderCtx): Rendered {
  const open = first(h, 'incident.opened');
  const updates = all(h, 'incident.updated');
  const resolved = updates.find((u) => u.data.change === 'resolved');
  const acked = updates.find((u) => u.data.change === 'acked');
  const escalated = updates.find((u) => u.data.change === 'escalated');
  const d = open?.data;
  const id = d?.incidentId ?? (ev.data as { incidentId: string }).incidentId;
  const critical = d?.severity === 'critical' || !!escalated;
  const summary =
    escalated?.data.summary ?? d?.summary ?? updates.at(-1)?.data.summary ?? 'incidente';
  const status = resolved
    ? `✅ resolvido${byLine(resolved.data.by, 'pela equipe')} · durou ${duration(isoOf(open?.created_at ?? ev.created_at), new Date(resolved.created_at))}`
    : [
        critical
          ? `🔴 crítico${escalated ? ` desde ${ts(escalated.created_at, 'R')}` : ''}`
          : '🟠 aberto',
        acked ? `👀 reconhecido por ${esc(acked.data.by ?? 'equipe')}` : null,
      ]
        .filter(Boolean)
        .join(' · ');
  const severity: Severity = resolved ? 'success' : critical ? 'critical' : 'warning';
  const url = ctx.crm('/lojas/frota');
  const msg = card(
    { ...ev, severity },
    {
      title: esc(summary),
      url,
      description: status,
      fields: fields(
        field('tipo', d ? label('incident', d.kind) : null),
        field('loja', d?.storeName ? esc(d.storeName) : d ? 'frota inteira' : null),
        field('assunto', d ? esc(clip(d.subject, 200)) : null, false),
      ),
      thumbnail: art(ctx, resolved ? 'sucesso' : 'erro'),
      color: resolved ? COLORS.success : COLORS[severity],
      at: open?.created_at,
    },
    row(
      !resolved && !acked && actionButton('reconhecer', cid('incident', 'ack', id), 2, '👀'),
      !resolved && actionButton('resolver', cid('incident', 'resolve', id), 3, '✅'),
      linkButton('frota no CRM', url),
    ),
  );
  let reply: string | null = null;
  if (ev.kind === 'incident.updated') {
    const u = (ev as Ev<'incident.updated'>).data;
    if (u.change === 'escalated') reply = `🔴 ficou crítico: ${esc(clip(summary, 300))}`;
    if (u.change === 'resolved')
      reply = `✅ resolvido em ${duration(isoOf(open?.created_at ?? ev.created_at), new Date(ev.created_at))}`;
  }
  return { card: msg, reply };
}

// ── agente ───────────────────────────────────────────────────────────────────

function runFailed(ev: Ev<'agent.run_failed'>, ctx: RenderCtx): Rendered {
  const d = ev.data;
  return {
    card: card(
      ev,
      {
        title: `run do agente falhou · ${esc(d.job)}`,
        url: ctx.crm(`/agente/atividade/${d.runId}`),
        description: code(d.error, 900),
        fields: fields(
          field('lead', d.leadName ? esc(d.leadName) : null),
          field('tentativas', String(d.attempts)),
        ),
      },
      row(
        linkButton('ver run', ctx.crm(`/agente/atividade/${d.runId}`)),
        d.leadId ? linkButton('abrir lead', ctx.crm(`/pipeline/${d.leadId}`)) : null,
      ),
    ),
  };
}

function turnFailed(ev: Ev<'agent.turn_failed'>): Rendered {
  const d = ev.data;
  return {
    card: card(ev, {
      title: `turno do agente falhou · ${esc(d.agentId)}`,
      description: code(d.error, 900),
      fields: fields(
        field('loja', d.storeName ? esc(d.storeName) : null),
        field('versão', esc(d.version)),
        field('tentativas', String(d.attempts)),
        field('ator', esc(d.actorId)),
      ),
    }),
  };
}

function versionRollback(ev: Ev<'agent.version_rollback'>): Rendered {
  const d = ev.data;
  return {
    card: card(ev, {
      title: `rollback · ${esc(d.agentId)} ${esc(d.version)}`,
      description: esc(clip(d.reasons.join('\n'), 900)),
      fields: fields(field('estava em', esc(d.stage))),
    }),
  };
}

function qaAlert(ev: Ev<'agent.qa_alert'>): Rendered {
  const d = ev.data;
  return {
    card: card(ev, {
      title: `qualidade caiu · ${esc(d.agentId)} ${esc(d.version)}`,
      description: `média ${d.mean.toFixed(2)} nas últimas ${d.window} conversas (mínimo ${d.threshold})`,
    }),
  };
}

const MONITOR_WORDS = {
  blocks: 'respostas barradas a cada 100',
  handoffs: '% das conversas passadas para a loja',
  optouts: 'pedidos para parar de receber',
} as const;

function vendedorMonitor(ev: Ev<'vendedor.monitor'>): Rendered {
  const d = ev.data;
  return {
    card: card(ev, {
      title: `Duá fora do normal · ${esc(d.storeName ?? 'loja')}`,
      description: `${d.today.toFixed(1)} ${MONITOR_WORDS[d.metric]} hoje (de costume ${d.baseline.toFixed(1)}; ${d.volume} no dia)`,
    }),
  };
}

function costCap(ev: Ev<'agent.cost_cap'>, ctx: RenderCtx): Rendered {
  const d = ev.data;
  return {
    card: card(
      ev,
      {
        title: `${esc(d.leadName)} bateu o teto de custo`,
        url: ctx.crm(`/pipeline/${d.leadId}`),
        description: `gastou ${usd(d.spentCents)} de ${usd(d.capCents)} — o agente parou neste lead até a equipe liberar`,
      },
      row(linkButton('abrir lead', ctx.crm(`/pipeline/${d.leadId}`))),
    ),
  };
}

function channel(ev: EventRow, h: EventRow[], ctx: RenderCtx): Rendered {
  const down = first(h, 'channel.down');
  const up = lastOf(h, 'channel.up');
  const name = label('channel', (down?.data ?? (ev.data as { channel: string })).channel);
  const msg = card(
    { ...ev, severity: up ? 'success' : 'critical' },
    {
      title: up ? `${name} voltou` : `${name} caiu`,
      url: ctx.crm('/config'),
      description: [
        down ? esc(down.data.detail) : '',
        up
          ? `✅ de volta ${ts(up.created_at, 'R')}${down ? ` · fora por ${duration(isoOf(down.created_at), new Date(up.created_at))}` : ''}`
          : name === label('channel', 'whatsapp_lojas')
            ? '⛔ nenhuma loja está mandando avisos de pedido pelo WhatsApp'
            : '⛔ o agente não consegue mandar mensagens por este canal',
      ]
        .filter(Boolean)
        .join('\n'),
      thumbnail: art(ctx, up ? 'sucesso' : 'offline'),
      color: up ? COLORS.success : COLORS.critical,
      at: down?.created_at,
    },
    row(linkButton('conexões no CRM', ctx.crm('/config'))),
  );
  const reply =
    ev.kind === 'channel.up'
      ? `✅ ${name} voltou${down ? ` (fora por ${duration(isoOf(down.created_at), new Date(ev.created_at))})` : ''}`
      : null;
  return { card: msg, reply };
}

// ── sistema ──────────────────────────────────────────────────────────────────

function boot(ev: Ev<'system.boot'>): Rendered {
  const d = ev.data;
  return {
    card: card(ev, {
      title:
        d.bootsLastHour >= 3
          ? `⚠️ Core reiniciou ${d.bootsLastHour}× na última hora`
          : 'Core reiniciou',
      description: [
        d.version ? `versão ${esc(d.version)}` : null,
        d.bootsLastHour >= 3 ? 'parece um loop de crash — veja os logs do container' : null,
      ]
        .filter(Boolean)
        .join('\n'),
    }),
  };
}

function systemError(ev: Ev<'system.error'>): Rendered {
  const d = ev.data;
  return {
    card: card(ev, {
      title: `erro 500 em ${esc(d.method)} ${esc(d.path)}`,
      description: `${code(d.message, 800)}\n${int(d.count)} ${d.count === 1 ? 'ocorrência' : 'ocorrências'} — detalhes no log (\`unhandled error\`)`,
    }),
  };
}

function job(ev: EventRow, h: EventRow[], ctx: RenderCtx): Rendered {
  const failing = first(h, 'job.failing');
  const back = lastOf(h, 'job.recovered');
  const lbl = (failing?.data ?? (ev.data as { label: string })).label;
  const msg = card(
    { ...ev, severity: back ? 'success' : 'warning' },
    {
      title: back ? `rotina de volta: ${esc(lbl)}` : `rotina falhando: ${esc(lbl)}`,
      description: [
        failing ? code(failing.data.error, 900) : '',
        back
          ? `✅ voltou ${ts(back.created_at, 'R')}${failing ? ` · falhou por ${duration(isoOf(failing.created_at), new Date(back.created_at))}` : ''}`
          : '',
      ]
        .filter(Boolean)
        .join('\n'),
      color: back ? COLORS.success : COLORS.warning,
      at: failing?.created_at,
    },
    row(linkButton('rotinas no CRM', ctx.crm('/agente/atividade'))),
  );
  return { card: msg, reply: ev.kind === 'job.recovered' ? `✅ ${esc(lbl)} voltou a rodar` : null };
}

function statusPage(ev: EventRow, h: EventRow[], ctx: RenderCtx): Rendered {
  const opened = first(h, 'status.opened');
  const upd = lastOf(h, 'status.updated');
  const title = upd?.data.title ?? opened?.data.title ?? 'aviso';
  const sev = upd?.data.severity ?? opened?.data.severity ?? 'info';
  const resolved = upd?.data.resolved === true;
  const msg = card(
    { ...ev, severity: resolved ? 'success' : sev === 'outage' ? 'critical' : 'warning' },
    {
      title: `status page: ${esc(title)}`,
      url: ctx.crm('/lojas/incidentes'),
      description: [
        opened?.data.body ? quote(opened.data.body, 900) : '',
        resolved
          ? `✅ resolvido ${ts(upd!.created_at, 'R')}`
          : `🟠 ${label('statusSeverity', sev)} — os lojistas veem este aviso`,
      ]
        .filter(Boolean)
        .join('\n'),
      color: resolved ? COLORS.success : sev === 'outage' ? COLORS.critical : COLORS.warning,
      at: opened?.created_at,
    },
    row(linkButton('incidentes no CRM', ctx.crm('/lojas/incidentes'))),
  );
  const reply =
    ev.kind === 'status.updated' && (ev as Ev<'status.updated'>).data.resolved
      ? `✅ aviso resolvido: ${esc(title)}`
      : null;
  return { card: msg, reply };
}

function test(ev: Ev<'discord.test'>, ctx: RenderCtx): Rendered {
  return {
    card: card(ev, {
      title: '✅ o bot da Venduá está funcionando',
      description: [
        `teste enviado por ${esc(ev.data.by ?? 'alguém da equipe')}.`,
        ctx.routedHere.length ? `este canal recebe: ${ctx.routedHere.join(', ')}` : '',
      ]
        .filter(Boolean)
        .join('\n'),
      color: COLORS.success,
    }),
  };
}

/** an ISO instant → '16/10' in Brasília */
function dayMonthOf(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? iso
    : d.toLocaleDateString('pt-BR', {
        day: '2-digit',
        month: '2-digit',
        timeZone: 'America/Sao_Paulo',
      });
}

/** '2026-10-01' → 'quinta-feira, 1 de outubro' (a local date, read at noon UTC so it can't shift) */
function dayLabel(date: string): string {
  const d = new Date(`${date}T12:00:00Z`);
  return Number.isNaN(d.getTime())
    ? date
    : d.toLocaleDateString('pt-BR', {
        weekday: 'long',
        day: 'numeric',
        month: 'long',
        timeZone: 'UTC',
      });
}

export function digestCard(
  ev: EventRow,
  r: DailyDigest,
  ctx: Pick<RenderCtx, 'crm' | 'art'>,
): MessagePayload {
  const v = r.vendas;
  const top = v.top
    .slice(0, 5)
    .map((t) => `• ${esc(t.storeName)} — ${int(t.orders)} · ${brl(t.gmvCents)}`)
    .join('\n');
  const f: EmbedField[] = [
    {
      name: '💬 crm',
      value: [
        `leads novos: **${int(r.crm.newLeads)}**`,
        `respostas: **${int(r.crm.replies)}**`,
        `calls marcadas: **${int(r.crm.meetingsBooked)}** (próximas 24h: ${int(r.crm.meetingsNext24h)})`,
        `avanços no funil: **${int(r.crm.milestones)}**`,
      ].join('\n'),
      inline: true,
    },
    {
      name: '🙋 esperando a equipe',
      value: [
        `rascunhos: **${int(r.crm.pendingDrafts)}**`,
        `tarefas abertas: **${int(r.crm.openTasks)}**`,
      ].join('\n'),
      inline: true,
    },
    {
      name: '🤖 agente',
      value: [
        `runs: **${int(r.agent.runs)}** · ${usd(r.agent.costCents)}`,
        r.agent.failedRuns ? `⚠️ ${int(r.agent.failedRuns)} falharam` : 'nenhuma falhou',
      ].join('\n'),
      inline: true,
    },
    {
      name: '🛍️ vendas',
      value: [
        `pedidos: **${int(v.orders)}** · **${brl(v.gmvCents)}** em ${int(v.stores)} ${v.stores === 1 ? 'loja' : 'lojas'}`,
        v.cancelled ? `cancelados: ${int(v.cancelled)}` : null,
        v.firstOrders.length ? `🎉 primeiro pedido: ${v.firstOrders.map(esc).join(', ')}` : null,
        top || null,
      ]
        .filter(Boolean)
        .join('\n'),
      inline: false,
    },
    {
      name: '🧾 assinaturas',
      value: [
        `lojas novas: **${int(r.assinaturas.newStores)}**`,
        `faturas pagas: **${int(r.assinaturas.paid)}** · ${brl(r.assinaturas.paidCents)}`,
        r.assinaturas.problems ? `⚠️ problemas: ${int(r.assinaturas.problems)}` : null,
      ]
        .filter(Boolean)
        .join('\n'),
      inline: true,
    },
    {
      name: '🚀 frota',
      value: [
        `lojas no ar: **${int(r.frota.storesLive)}**`,
        r.frota.openIncidents
          ? `🟠 incidentes abertos: ${int(r.frota.openIncidents)}`
          : 'sem incidentes abertos',
        r.frota.failedDeployments
          ? `implantações que falharam: ${int(r.frota.failedDeployments)}`
          : null,
      ]
        .filter(Boolean)
        .join('\n'),
      inline: true,
    },
    {
      name: '🛠️ sistema',
      value: [
        `erros 500: **${int(r.sistema.errors)}**`,
        `reinícios: ${int(r.sistema.boots)}`,
        r.sistema.failingJobs.length
          ? `⚠️ rotinas falhando: ${r.sistema.failingJobs.map(esc).join(', ')}`
          : null,
      ]
        .filter(Boolean)
        .join('\n'),
      inline: true,
    },
  ];
  return card(
    ev,
    {
      title: `resumo de ${dayLabel(r.date)}`,
      description: 'as últimas 24 horas',
      fields: f,
      thumbnail: art(ctx, 'horarios'),
      color: 0x5865f2,
    },
    row(linkButton('abrir o CRM', ctx.crm('/'))),
  );
}

type Standalone = { [K in StaffEventKind]?: (ev: Ev<K>, ctx: RenderCtx) => Rendered };
type Family = (ev: EventRow, history: EventRow[], ctx: RenderCtx) => Rendered;

const STANDALONE: Standalone = {
  'agent.turn_failed': turnFailed,
  'agent.version_rollback': versionRollback,
  'agent.qa_alert': qaAlert,
  'vendedor.monitor': vendedorMonitor,
  'merchant.help': merchantHelp,
  'store.request': storeRequest,
  'site.task_queued': siteQueued,
  'site.ready': siteReady,
  'site.escalated': siteEscalated,
  'site.due_soon': siteDueSoon,
  'site.overdue': siteOverdue,
  'site.delivered': siteDelivered,
  'billing.manual': billingManual,
  'lead.created': leadCreated,
  'lead.replied': leadReplied,
  'lead.milestone': leadMilestone,
  'lead.unsubscribed': leadUnsubscribed,
  'store.first_order': firstOrder,
  'payment.problem': paymentProblem,
  'payments.connection': paymentsConnection,
  'whatsapp.store': whatsappStore,
  'billing.paid': billingPaid,
  'billing.problem': billingProblem,
  'domain.ready': domainReady,
  'release.published': releasePublished,
  'deployment.failed': deploymentFailed,
  'deployment.manual': deploymentManual,
  'store.live': storeLive,
  'agent.run_failed': runFailed,
  'agent.cost_cap': costCap,
  'system.boot': boot,
  'system.error': systemError,
  'discord.test': test,
  'digest.daily': (ev, ctx) => ({ card: digestCard(ev, ev.data, ctx) }),
};

const FAMILIES: Record<string, Family> = {
  handoff,
  draft,
  meeting,
  order,
  onboarding,
  incident,
  channel,
  job,
  status: statusPage,
};

/** Which family renders an anchored kind: the anchor's prefix. */
export function familyOf(anchor: string | null): string | null {
  return anchor ? (anchor.split(':')[0] ?? null) : null;
}

export function render(ev: EventRow, history: EventRow[], ctx: RenderCtx): Rendered {
  return withStorePage(renderCard(ev, history, ctx), ev, ctx);
}

function renderCard(ev: EventRow, history: EventRow[], ctx: RenderCtx): Rendered {
  const family = familyOf(ev.anchor);
  if (family && FAMILIES[family]) return FAMILIES[family](ev, history.length ? history : [ev], ctx);
  const one = STANDALONE[ev.kind] as ((e: EventRow, c: RenderCtx) => Rendered) | undefined;
  if (one) return one(ev, ctx);
  // a kind without a renderer still says what happened
  return {
    card: card(ev, {
      title: STAFF_EVENT_KINDS[ev.kind]?.label ?? ev.kind,
      description: code(JSON.stringify(ev.data, null, 2), 1500),
    }),
  };
}

/** An event about one store links to that store's page in the CRM, whatever its card. */
function withStorePage(out: Rendered, ev: EventRow, ctx: RenderCtx): Rendered {
  if (!ev.tenant_id) return out;
  const btn = linkButton('loja no CRM', ctx.crm(`/lojas/${ev.tenant_id}`))!;
  const rows = out.card.components ?? [];
  const last = rows.at(-1);
  // Discord: at most 5 buttons per row and 5 rows
  const components =
    last && last.components.length < 5
      ? [...rows.slice(0, -1), { ...last, components: [...last.components, btn] }]
      : rows.length < 5
        ? [...rows, ...row(btn)]
        : rows;
  return { ...out, card: { ...out.card, components } };
}
