import {
  CATEGORY_META,
  STAFF_EVENT_KINDS,
  type DailyDigest,
  type Severity,
  type StaffEventKind,
  type StaffEventMap,
} from '../staff-events.ts';
import {
  actionButton,
  b,
  brl,
  cb,
  clip,
  code,
  duration,
  esc,
  i,
  int,
  label,
  linkButton,
  mono,
  quote,
  row,
  strike,
  ts,
  usd,
  type InlineButton,
  type TelegramMessage,
} from './format.ts';
import { onboardingSteps, type StoreSnapshot } from './snapshot.ts';

// One message card per event; events that share an anchor are rendered from the anchor's whole
// history, so an edit always shows the current state ("living cards", ADR 0023 / ADR 0047).
// Every renderer is pure: the dispatcher loads history and live reads, then sends or edits.

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
  now: Date;
}

export interface Rendered {
  card: TelegramMessage;
  /** short plain/HTML summary line used when collapsing a storm of standalone events */
  summary: string;
  /** a follow-up worth a notification of its own, posted as a reply to the card */
  reply?: string | null;
}

type Ev<K extends StaffEventKind> = EventRow<K>;
const all = <K extends StaffEventKind>(h: EventRow[], k: K) =>
  h.filter((e) => e.kind === k) as Ev<K>[];
const first = <K extends StaffEventKind>(h: EventRow[], k: K) => all(h, k)[0];
const lastOf = <K extends StaffEventKind>(h: EventRow[], k: K) => all(h, k).at(-1);
const isoOf = (at: Date | string) => new Date(at).toISOString();

interface CardInput {
  title: string;
  body?: (string | null | undefined | false)[];
  footer?: string | null;
  buttons?: InlineButton[][];
}

const LEADING_EMOJI = /^([\p{Extended_Pictographic}\p{Emoji_Presentation}]\uFE0F?)\s+/u;

function card(ev: EventRow, input: CardInput): TelegramMessage {
  const meta = CATEGORY_META[STAFF_EVENT_KINDS[ev.kind].category];
  const own = LEADING_EMOJI.exec(input.title);
  const header = own
    ? `${own[1]} ${b(input.title.slice(own[0].length))}`
    : `${meta.emoji} ${b(input.title)}`;
  const body = (input.body ?? []).filter((x): x is string => typeof x === 'string' && x.length > 0);
  const parts = [header, ...body];
  if (input.footer) parts.push(i(input.footer));
  return {
    text: parts.join('\n'),
    ...(input.buttons?.length ? { buttons: input.buttons } : {}),
  };
}

const who = (name: string, business: string | null | undefined) =>
  business && business.trim() && business.trim() !== name.trim()
    ? `${esc(name)} · ${esc(business)}`
    : esc(name);

const byLine = (by: string | null | undefined, crmWord = 'no CRM') =>
  !by ? '' : by === 'staff' || by === 'equipe' ? ` ${crmWord}` : ` por ${esc(by)}`;

const metaLine = (items: (string | null | undefined | false)[]) =>
  items.filter((x): x is string => typeof x === 'string' && x.length > 0).join(' · ');

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
    ? `✅ resolvido${byLine(done.data.by)} (${ts(done.created_at, 't')})`
    : taken
      ? `🙋 assumido por ${esc(taken.data.by)} (${ts(taken.created_at, 't')})`
      : `⏳ aberto desde ${ts(open?.created_at ?? ev.created_at, 't')}`;
  const title = d
    ? `o agente pediu ajuda com ${who(d.leadName, d.business)}`
    : 'handoff para a equipe';
  const msg = card(
    { ...ev, severity: done ? 'success' : taken ? 'info' : 'warning' },
    {
      title,
      body: [
        d?.channel ? `canal: ${label('channel', d.channel)}` : null,
        d ? quote(d.reason, 1200) : null,
        status,
      ],
      footer: !done ? 'responda esta mensagem (texto ou áudio) para orientar o agente' : null,
      buttons: [
        ...row(
          !done && actionButton('💬 responder ao agente', cb('h', 'g', taskId), 'primary'),
          !done && actionButton('✉️ responder ao lead', cb('h', 'm', taskId)),
        ),
        ...row(
          !done && !taken && actionButton('🙋 assumir', cb('h', 't', taskId)),
          !done && actionButton('✅ resolvido', cb('h', 'd', taskId), 'success'),
        ),
        ...row(linkButton('abrir conversa', url)),
      ],
    },
  );
  const reply =
    ev.kind === 'handoff.taken'
      ? `🙋 ${esc((ev.data as StaffEventMap['handoff.taken']).by)} assumiu`
      : ev.kind === 'handoff.resolved'
        ? `✅ handoff resolvido${byLine((ev.data as StaffEventMap['handoff.resolved']).by)}`
        : null;
  return { card: msg, summary: title, reply };
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
      ? [d.subject ? b(esc(d.subject)) : null, quote(d.body, 1800, 30)].filter(Boolean).join('\n')
      : i('conteúdo oculto — abra no CRM');
  const outcome = res?.data.outcome;
  const status =
    outcome === 'approved'
      ? `✅ aprovado${byLine(res!.data.by)} — enviando`
      : outcome === 'rejected'
        ? `✕ rejeitado${byLine(res!.data.by)}`
        : outcome === 'superseded'
          ? '↷ o lead respondeu antes — o agente refaz'
          : `⏳ esperando aprovação desde ${ts(open?.created_at ?? ev.created_at, 't')}`;
  const title = d
    ? `rascunho para ${who(d.leadName, d.business)} · ${label('channel', d.channel)}`
    : 'rascunho do agente';
  const msg = card(
    { ...ev, severity: 'info' },
    {
      title,
      body: [body, status],
      footer: !res ? 'responda esta mensagem (texto ou áudio) para pedir ajuste' : null,
      buttons: [
        ...row(
          !res && actionButton('✅ aprovar e enviar', cb('d', 'a', messageId), 'success'),
          !res && actionButton('✏️ reescrever', cb('d', 'w', messageId), 'primary'),
          !res && actionButton('✕ rejeitar', cb('d', 'r', messageId), 'danger'),
        ),
        ...row(linkButton('abrir no CRM', url)),
      ],
    },
  );
  return { card: msg, summary: title, reply: null };
}

function merchantHelp(ev: Ev<'merchant.help'>, ctx: RenderCtx): Rendered {
  const d = ev.data;
  const title = `${esc(d.storeName)} pediu ajuda${d.topic && d.topic !== 'geral' ? ` · ${esc(d.topic)}` : ''}`;
  return {
    card: card(ev, {
      title,
      body: [
        metaLine([
          d.who ? `quem: ${esc(d.who)}` : null,
          d.contact ? `contato: ${esc(d.contact)}` : null,
        ]),
        quote(d.message, 1800, 30),
      ],
      buttons: row(
        ev.tenant_id ? null : linkButton('abrir lojas no CRM', ctx.crm('/lojas')),
        linkButton('ver loja', ctx.storeUrl),
      ),
    }),
    summary: title,
  };
}

function storeRequest(ev: Ev<'store.request'>, ctx: RenderCtx): Rendered {
  const d = ev.data;
  const title = `${esc(d.storeName)} · ${esc(d.title)}`;
  return {
    card: card(ev, {
      title,
      body: [quote(d.detail, 1500, 20)],
      buttons: row(linkButton('abrir no CRM', ctx.crm('/lojas/planos'))),
    }),
    summary: title,
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
  subtitle: string,
  description: string,
  prUrl: string | null = null,
): Rendered {
  const title = `${esc(ev.data.storeName)} · ${subtitle}`;
  return {
    card: card(ev, {
      title,
      body: [description],
      buttons: row(
        prUrl ? linkButton('ver o PR', prUrl) : null,
        linkButton('abrir no CRM', ctx.crm(`/lojas/sites/${ev.data.taskId}`)),
      ),
    }),
    summary: title,
  };
}

function siteQueued(ev: Ev<'site.task_queued'>, ctx: RenderCtx): Rendered {
  const d = ev.data;
  return siteCard(ev, ctx, `${SITE_KIND[d.kind]} na fila`, `prazo ${ts(d.dueAt, 'f')}`);
}

function siteReady(ev: Ev<'site.ready'>, ctx: RenderCtx): Rendered {
  const d = ev.data;
  return siteCard(ev, ctx, `${SITE_KIND[d.kind]} pronto para aprovar`, 'o CI ficou verde', d.prUrl);
}

function siteEscalated(ev: Ev<'site.escalated'>, ctx: RenderCtx): Rendered {
  const d = ev.data;
  return siteCard(ev, ctx, `${SITE_KIND[d.kind]} precisa da equipe`, quote(d.reason, 300, 5));
}

function siteDueSoon(ev: Ev<'site.due_soon'>, ctx: RenderCtx): Rendered {
  const d = ev.data;
  return siteCard(ev, ctx, `${SITE_KIND[d.kind]} perto do prazo`, `prazo ${ts(d.dueAt, 'f')}`);
}

function siteOverdue(ev: Ev<'site.overdue'>, ctx: RenderCtx): Rendered {
  const d = ev.data;
  return siteCard(ev, ctx, `${SITE_KIND[d.kind]} atrasado`, `o prazo era ${ts(d.dueAt, 'f')}`);
}

function siteDelivered(ev: Ev<'site.delivered'>, ctx: RenderCtx): Rendered {
  const d = ev.data;
  return siteCard(ev, ctx, `${SITE_KIND[d.kind]} no ar`, mono(d.slug));
}

function siteModeChanged(ev: Ev<'site.mode_changed'>, ctx: RenderCtx): Rendered {
  const d = ev.data;
  const title = `${esc(d.storeName)} ${d.mode === 'custom' ? 'voltou para o site sob medida' : 'trocou para o modelo padrão'}`;
  return {
    card: card(ev, {
      title,
      body: [`${mono(d.slug)} · trocado pelo lojista na Aparência`],
      buttons: row(linkButton('frota no CRM', ctx.crm('/lojas/frota'))),
    }),
    summary: title,
  };
}

function billingManual(ev: Ev<'billing.manual'>, ctx: RenderCtx): Rendered {
  const d = ev.data;
  const title = `${esc(d.storeName)} entrou com código de acesso`;
  return {
    card: card(ev, {
      title,
      body: [
        `fatura de ${b(brl(d.amountCents))}${d.plan ? ` (${esc(d.plan)})` : ''} esperando baixa — marque como paga no CRM quando o pagamento chegar.`,
      ],
      buttons: row(linkButton('abrir planos no CRM', ctx.crm('/lojas/planos'))),
    }),
    summary: title,
  };
}

// ── crm ──────────────────────────────────────────────────────────────────────

function leadCreated(ev: Ev<'lead.created'>, ctx: RenderCtx): Rendered {
  const d = ev.data;
  const title = `lead novo: ${who(d.leadName, d.business)}`;
  return {
    card: card(ev, {
      title,
      body: [`canal: ${label('channel', d.channel)}`, ctx.excerpts ? quote(d.excerpt, 900) : null],
      buttons: row(
        actionButton('🤖 guiar agente', `g:l:${d.leadId}`, 'primary'),
        linkButton('abrir lead', ctx.crm(`/pipeline/${d.leadId}`)),
      ),
    }),
    summary: title,
  };
}

function leadReplied(ev: Ev<'lead.replied'>, ctx: RenderCtx): Rendered {
  const d = ev.data;
  const url = ctx.crm(`/inbox/${d.threadId}`);
  const title = `${who(d.leadName, d.business)} respondeu · ${label('channel', d.channel)}`;
  return {
    card: card(ev, {
      title,
      body: [ctx.excerpts ? quote(d.excerpt, 900) : null],
      buttons: row(
        actionButton('🤖 guiar agente', `g:l:${d.leadId}`, 'primary'),
        linkButton('abrir conversa', url),
      ),
    }),
    summary: title,
  };
}

function leadMilestone(ev: Ev<'lead.milestone'>, ctx: RenderCtx): Rendered {
  const d = ev.data;
  const title = `🎯 ${who(d.leadName, d.business)}: ${label('leadState', d.from)} → ${label('leadState', d.to)}`;
  return {
    card: card(ev, {
      title,
      body: [d.by === 'agent' ? 'pelo agente' : d.by === 'system' ? 'automático' : 'pela equipe'],
      buttons: row(
        actionButton('🤖 guiar agente', `g:l:${d.leadId}`, 'primary'),
        linkButton('abrir lead', ctx.crm(`/pipeline/${d.leadId}`)),
      ),
    }),
    summary: title,
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
  const title = `${who(d.leadName, d.business)} pediu para sair`;
  return {
    card: card(ev, {
      title,
      body: [how, d.reason ? quote(d.reason, 400) : null],
      buttons: row(linkButton('abrir lead', ctx.crm(`/pipeline/${d.leadId}`))),
    }),
    summary: title,
  };
}

function meeting(ev: EventRow, h: EventRow[], ctx: RenderCtx): Rendered {
  const booked = first(h, 'meeting.booked');
  const change = lastOf(h, 'meeting.changed');
  const base = booked?.data ?? (ev.data as StaffEventMap['meeting.changed']);
  const startsAt = change?.data.startsAt ?? booked?.data.startsAt ?? base.startsAt;
  const cancelled = change?.data.change === 'cancelled';
  const leadUrl = ctx.crm(`/pipeline/${base.leadId}`);
  const title = `${cancelled ? 'call cancelada' : 'call marcada'} com ${who(base.leadName, booked?.data.business)}`;
  const msg = card(
    { ...ev, severity: cancelled ? 'warning' : 'success' },
    {
      title,
      body: [
        cancelled
          ? strike(ts(startsAt, 'F'))
          : `${ts(startsAt, 'F')}${change?.data.change === 'rescheduled' ? '\nremarcada' : ''}`,
        booked ? `origem: ${label('meetingSource', booked.data.source)}` : null,
      ],
      buttons: row(
        !cancelled && linkButton('entrar na sala', booked?.data.roomUrl),
        linkButton('abrir lead', leadUrl),
      ),
    },
  );
  let reply: string | null = null;
  if (ev.kind === 'meeting.changed') {
    const c = (ev as Ev<'meeting.changed'>).data;
    reply =
      c.change === 'cancelled'
        ? `❌ ${c.by === 'lead' ? `${esc(c.leadName)} cancelou a call` : 'a equipe cancelou a call'}`
        : `📅 call remarcada para ${ts(c.startsAt, 'F')}`;
  }
  return { card: msg, summary: title, reply };
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
      metaLine([
        b(brl(d.totalCents)),
        label('method', d.method),
        d.fulfillment ? label('fulfillment', d.fulfillment) : null,
        `${int(d.items)} ${d.items === 1 ? 'item' : 'itens'}`,
      ]),
    );
    if (d.scheduledFor)
      lines.push(
        /^\d{4}-\d{2}-\d{2}$/.test(d.scheduledFor)
          ? `encomenda para ${d.scheduledFor.split('-').reverse().join('/')}`
          : `agendado para ${ts(d.scheduledFor, 'f')}`,
      );
  }
  const steps = [
    ...(placed ? [`recebido ${ts(placed.created_at, 't')}`] : []),
    ...updates.map((u) => `${label('orderStep', u.data.to)} ${ts(u.created_at, 't')}`),
  ];
  if (steps.length) lines.push(steps.slice(-6).join(' → '));
  const title = `pedido #${any.number} · ${esc(any.storeName)}`;
  const msg = card(
    { ...ev, severity: bad ? 'warning' : good ? 'success' : 'info' },
    {
      title,
      body: lines,
      buttons: row(linkButton('ver loja', ctx.storeUrl)),
    },
  );
  let reply: string | null = null;
  if (ev.kind === 'order.updated') {
    const u = (ev as Ev<'order.updated'>).data;
    if (u.to === 'cancelled') reply = `❌ pedido #${u.number} da ${esc(u.storeName)} foi cancelado`;
    else if (u.to === 'refunded')
      reply = `↩️ pedido #${u.number} da ${esc(u.storeName)} foi reembolsado`;
  }
  return { card: msg, summary: title, reply };
}

function firstOrder(ev: Ev<'store.first_order'>, ctx: RenderCtx): Rendered {
  const d = ev.data;
  const title = `🎉 primeiro pedido da ${esc(d.storeName)}!`;
  return {
    card: card(ev, {
      title,
      body: [`pedido #${d.number} · ${b(brl(d.totalCents))} · ${label('method', d.method)}`],
      buttons: row(linkButton('ver loja', ctx.storeUrl)),
    }),
    summary: title,
  };
}

function paymentProblem(ev: Ev<'payment.problem'>, ctx: RenderCtx): Rendered {
  const d = ev.data;
  const title = `pagamento ${label('payment', d.status)} · ${esc(d.storeName)}`;
  return {
    card: card(ev, {
      title,
      body: [
        metaLine([
          d.number !== null ? `pedido #${d.number}` : null,
          d.amountCents !== null ? b(brl(d.amountCents)) : null,
        ]),
      ],
      buttons: row(linkButton('ver loja', ctx.storeUrl)),
    }),
    summary: title,
  };
}

function paymentsConnection(ev: Ev<'payments.connection'>, ctx: RenderCtx): Rendered {
  const d = ev.data;
  const title = `${esc(d.storeName)} ${d.connected ? 'conectou' : 'desconectou'} o Mercado Pago`;
  return {
    card: card(ev, {
      title,
      body: [d.detail ? esc(d.detail) : d.connected ? 'a loja já recebe pagamentos online' : null],
      buttons: row(linkButton('ver loja', ctx.storeUrl)),
    }),
    summary: title,
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
  const [verb, description] = WA_STEP[d.step];
  const title = `${esc(d.storeName)} ${verb}`;
  return {
    card: card(ev, {
      title,
      body: [description],
      buttons: row(linkButton('ver loja', ctx.storeUrl)),
    }),
    summary: title,
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
    ? metaLine([
        SOURCE[created.data.source] ?? created.data.source,
        created.data.owner ? `dono: ${esc(created.data.owner)}` : null,
        created.data.plan ? `plano ${esc(created.data.plan)}` : null,
        created.data.segment ? `segmento ${esc(created.data.segment)}` : null,
        created.data.trialEndsAt
          ? `teste grátis até ${dayMonthOf(created.data.trialEndsAt)}`
          : null,
        created.data.coupon ? `cupom ${esc(created.data.coupon)}` : null,
        created.data.referral ? `indicação: ${esc(created.data.referral)}` : null,
      ])
    : '';
  const title = `loja nova: ${esc(name)}`;
  const msg = card(
    { ...ev, severity: complete ? 'success' : 'info' },
    {
      title,
      body: [intro || null, steps.map((x) => `${x.done ? '✅' : '⬜'} ${esc(x.label)}`).join('\n')],
      footer: `onboarding ${done}/${steps.length}`,
      buttons: row(
        linkButton('ver loja', ctx.storeUrl),
        ev.tenant_id ? null : linkButton('lojas no CRM', ctx.crm('/lojas')),
      ),
    },
  );
  const reply =
    ev.kind === 'store.onboarding'
      ? `✅ ${esc(name)}: ${STEP_LABEL[(ev as Ev<'store.onboarding'>).data.step] ?? 'passo concluído'}`
      : null;
  return { card: msg, summary: title, reply };
}

function billingPaid(ev: Ev<'billing.paid'>, ctx: RenderCtx): Rendered {
  const d = ev.data;
  const title = d.first
    ? `💸 ${esc(d.storeName)} pagou a primeira fatura`
    : `${esc(d.storeName)} renovou o plano`;
  return {
    card: card(ev, {
      title,
      body: [
        metaLine([
          b(brl(d.amountCents)),
          d.plan ? esc(d.plan) : null,
          d.method ? label('method', d.method) : null,
        ]),
      ],
      buttons: row(linkButton('planos no CRM', ctx.crm('/lojas/planos'))),
    }),
    summary: title,
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
  const title = `${d.title ? esc(d.title) : PROBLEM[d.problem]} · ${esc(d.storeName)}`;
  return {
    card: card(ev, {
      title,
      body: [esc(d.detail)],
      buttons: row(linkButton('planos no CRM', ctx.crm('/lojas/planos'))),
    }),
    summary: title,
  };
}

function domainReady(ev: Ev<'domain.ready'>): Rendered {
  const d = ev.data;
  const title = `${esc(d.host)} pronto para ${esc(d.storeName)}`;
  return {
    card: card(ev, {
      title,
      body: ['o DNS confere — falta ligar o TLS no CRM, se ainda não estiver ativo'],
      buttons: row(linkButton('abrir domínio', `https://${d.host}`)),
    }),
    summary: title,
  };
}

// ── frota ────────────────────────────────────────────────────────────────────

function releasePublished(ev: Ev<'release.published'>, ctx: RenderCtx): Rendered {
  const d = ev.data;
  const title = `release ${d.releaseId.slice(0, 8)} · ${esc(d.bundle)}`;
  return {
    card: card(ev, {
      title,
      body: [
        metaLine([
          d.kernel ? `kernel ${esc(d.kernel)}` : null,
          d.promoted
            ? `promovido para ${int(d.promoted)} ${d.promoted === 1 ? 'loja' : 'lojas'}`
            : 'nenhuma loja promovida ainda',
        ]),
      ],
      buttons: row(linkButton('frota no CRM', ctx.crm('/lojas/frota'))),
    }),
    summary: title,
  };
}

function deploymentFailed(ev: Ev<'deployment.failed'>, ctx: RenderCtx): Rendered {
  const d = ev.data;
  const title = `implantação falhou · ${esc(d.storeName)}`;
  return {
    card: card(ev, {
      title,
      body: [
        esc(d.reason),
        d.rolledBackTo
          ? `↩️ voltou sozinha para ${mono(d.rolledBackTo.slice(0, 8))} e ficou fixada`
          : '⚠️ não havia release anterior para voltar',
        metaLine([`release ${mono(d.releaseId.slice(0, 8))}`, d.host ? esc(d.host) : null]),
      ],
      buttons: row(
        linkButton('frota no CRM', ctx.crm('/lojas/frota')),
        linkButton('ver loja', ctx.storeUrl),
      ),
    }),
    summary: title,
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
  const title = `${esc(d.by)} ${ACTION[d.action]} ${esc(d.storeName)}`;
  return {
    card: card(ev, {
      title,
      body: [d.releaseId ? `release ${mono(d.releaseId.slice(0, 8))}` : null],
      buttons: row(linkButton('frota no CRM', ctx.crm('/lojas/frota'))),
    }),
    summary: title,
  };
}

function partnerApplied(ev: Ev<'partner.applied'>, ctx: RenderCtx): Rendered {
  const d = ev.data;
  const title = `🤝 ${esc(d.name)} quer indicar lojas`;
  return {
    card: card(ev, {
      title,
      body: [metaLine([esc(d.kind), d.city ? esc(d.city) : null])],
      buttons: row(linkButton('ver parceiros', ctx.crm('/lojas/parceiros'))),
    }),
    summary: title,
  };
}

function storeLive(ev: Ev<'store.live'>, ctx: RenderCtx): Rendered {
  const d = ev.data;
  const url = d.host ? `https://${d.host}` : ctx.storeUrl;
  const title = `🚀 ${esc(d.storeName)} está no ar`;
  return {
    card: card(ev, {
      title,
      body: [esc(d.host)],
      buttons: row(linkButton('ver loja', url)),
    }),
    summary: title,
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
    : metaLine([
        critical
          ? `🔴 crítico${escalated ? ` desde ${ts(escalated.created_at, 't')}` : ''}`
          : '🟠 aberto',
        acked ? `👀 reconhecido por ${esc(acked.data.by ?? 'equipe')}` : null,
      ]);
  const severity: Severity = resolved ? 'success' : critical ? 'critical' : 'warning';
  const url = ctx.crm('/lojas/frota');
  const title = esc(summary);
  const msg = card(
    { ...ev, severity },
    {
      title,
      body: [
        status,
        metaLine([
          d ? label('incident', d.kind) : null,
          d?.storeName ? esc(d.storeName) : d ? 'frota inteira' : null,
        ]),
        d?.subject ? `assunto: ${esc(clip(d.subject, 200))}` : null,
      ],
      buttons: [
        ...row(
          !resolved && !acked && actionButton('👀 reconhecer', cb('i', 'a', id), 'primary'),
          !resolved && actionButton('✅ resolver', cb('i', 'r', id), 'success'),
        ),
        ...row(linkButton('frota no CRM', url)),
      ],
    },
  );
  let reply: string | null = null;
  if (ev.kind === 'incident.updated') {
    const u = (ev as Ev<'incident.updated'>).data;
    if (u.change === 'escalated') reply = `🔴 ficou crítico: ${esc(clip(summary, 300))}`;
    if (u.change === 'resolved')
      reply = `✅ resolvido em ${duration(isoOf(open?.created_at ?? ev.created_at), new Date(ev.created_at))}`;
  }
  return { card: msg, summary: title, reply };
}

// ── agente ───────────────────────────────────────────────────────────────────

function runFailed(ev: Ev<'agent.run_failed'>, ctx: RenderCtx): Rendered {
  const d = ev.data;
  const title = `run do agente falhou · ${esc(d.job)}`;
  return {
    card: card(ev, {
      title,
      body: [
        metaLine([d.leadName ? `lead: ${esc(d.leadName)}` : null, `tentativas: ${d.attempts}`]),
        code(d.error, 900),
      ],
      buttons: row(
        linkButton('ver execução', ctx.crm(`/agente/operacao/${d.runId}`)),
        d.leadId ? linkButton('abrir lead', ctx.crm(`/pipeline/${d.leadId}`)) : null,
      ),
    }),
    summary: title,
  };
}

function turnFailed(ev: Ev<'agent.turn_failed'>): Rendered {
  const d = ev.data;
  const title = `turno do agente falhou · ${esc(d.agentId)}`;
  const ver = d.version.startsWith('v') ? esc(d.version) : `v${esc(d.version)}`;
  return {
    card: card(ev, {
      title,
      body: [
        metaLine([
          d.storeName ? esc(d.storeName) : null,
          ver,
          `${d.attempts} tentativas`,
          esc(d.actorId),
        ]),
        code(d.error, 900),
      ],
    }),
    summary: title,
  };
}

function versionRollback(ev: Ev<'agent.version_rollback'>): Rendered {
  const d = ev.data;
  const title = `rollback · ${esc(d.agentId)} ${esc(d.version)}`;
  return {
    card: card(ev, {
      title,
      body: [`estava em: ${esc(d.stage)}`, esc(clip(d.reasons.join('\n'), 900))],
    }),
    summary: title,
  };
}

function qaAlert(ev: Ev<'agent.qa_alert'>): Rendered {
  const d = ev.data;
  const title = `qualidade caiu · ${esc(d.agentId)} ${esc(d.version)}`;
  return {
    card: card(ev, {
      title,
      body: [
        `média ${d.mean.toFixed(2)} nas últimas ${d.window} conversas (mínimo ${d.threshold})`,
      ],
    }),
    summary: title,
  };
}

const MONITOR_WORDS = {
  blocks: 'respostas barradas a cada 100',
  handoffs: '% das conversas passadas para a loja',
  optouts: 'pedidos para parar de receber',
} as const;

function vendedorMonitor(ev: Ev<'vendedor.monitor'>): Rendered {
  const d = ev.data;
  const title = `Duá fora do normal · ${esc(d.storeName ?? 'loja')}`;
  return {
    card: card(ev, {
      title,
      body: [
        `${d.today.toFixed(1)} ${MONITOR_WORDS[d.metric]} hoje (de costume ${d.baseline.toFixed(1)}; ${d.volume} no dia)`,
      ],
    }),
    summary: title,
  };
}

function costCap(ev: Ev<'agent.cost_cap'>, ctx: RenderCtx): Rendered {
  const d = ev.data;
  const title = `${esc(d.leadName)} bateu o teto de custo`;
  return {
    card: card(ev, {
      title,
      body: [
        `gastou ${usd(d.spentCents)} de ${usd(d.capCents)} — o agente parou neste lead até a equipe liberar`,
      ],
      buttons: row(linkButton('abrir lead', ctx.crm(`/pipeline/${d.leadId}`))),
    }),
    summary: title,
  };
}

function channel(ev: EventRow, h: EventRow[], ctx: RenderCtx): Rendered {
  const down = first(h, 'channel.down');
  const up = lastOf(h, 'channel.up');
  const name = label('channel', (down?.data ?? (ev.data as { channel: string })).channel);
  const title = up ? `${name} voltou` : `${name} caiu`;
  const msg = card(
    { ...ev, severity: up ? 'success' : 'critical' },
    {
      title,
      body: [
        down ? esc(down.data.detail) : null,
        up
          ? `✅ de volta (${ts(up.created_at, 't')})${down ? ` · fora por ${duration(isoOf(down.created_at), new Date(up.created_at))}` : ''}`
          : name === label('channel', 'whatsapp_lojas')
            ? '⛔ nenhuma loja está mandando avisos de pedido pelo WhatsApp'
            : '⛔ o agente não consegue mandar mensagens por este canal',
      ],
      buttons: row(linkButton('conexões no CRM', ctx.crm('/config'))),
    },
  );
  const reply =
    ev.kind === 'channel.up'
      ? `✅ ${name} voltou${down ? ` (fora por ${duration(isoOf(down.created_at), new Date(ev.created_at))})` : ''}`
      : null;
  return { card: msg, summary: title, reply };
}

// ── sistema ──────────────────────────────────────────────────────────────────

function boot(ev: Ev<'system.boot'>): Rendered {
  const d = ev.data;
  const title =
    d.bootsLastHour >= 3
      ? `⚠️ Core reiniciou ${d.bootsLastHour}× na última hora`
      : 'Core reiniciou';
  return {
    card: card(ev, {
      title,
      body: [
        d.version ? `versão ${mono(d.version)}` : null,
        d.bootsLastHour >= 3 ? 'parece um loop de crash — veja os logs do container' : null,
      ],
    }),
    summary: title,
  };
}

function systemError(ev: Ev<'system.error'>): Rendered {
  const d = ev.data;
  const title = `erro 500 em ${esc(d.method)} ${esc(d.path)}`;
  return {
    card: card(ev, {
      title,
      body: [
        code(d.message, 800),
        `${int(d.count)} ${d.count === 1 ? 'ocorrência' : 'ocorrências'} — detalhes no log (${mono('unhandled error')})`,
      ],
    }),
    summary: title,
  };
}

function job(ev: EventRow, h: EventRow[], ctx: RenderCtx): Rendered {
  const failing = first(h, 'job.failing');
  const back = lastOf(h, 'job.recovered');
  const lbl = (failing?.data ?? (ev.data as { label: string })).label;
  const title = back ? `rotina de volta: ${esc(lbl)}` : `rotina falhando: ${esc(lbl)}`;
  const msg = card(
    { ...ev, severity: back ? 'success' : 'warning' },
    {
      title,
      body: [
        failing ? code(failing.data.error, 900) : null,
        back
          ? `✅ voltou (${ts(back.created_at, 't')})${failing ? ` · falhou por ${duration(isoOf(failing.created_at), new Date(back.created_at))}` : ''}`
          : null,
      ],
      buttons: row(linkButton('rotinas no CRM', ctx.crm('/config'))),
    },
  );
  return {
    card: msg,
    summary: title,
    reply: ev.kind === 'job.recovered' ? `✅ ${esc(lbl)} voltou a rodar` : null,
  };
}

function statusPage(ev: EventRow, h: EventRow[], ctx: RenderCtx): Rendered {
  const opened = first(h, 'status.opened');
  const upd = lastOf(h, 'status.updated');
  const rawTitle = upd?.data.title ?? opened?.data.title ?? 'aviso';
  const sev = upd?.data.severity ?? opened?.data.severity ?? 'info';
  const resolved = upd?.data.resolved === true;
  const title = `status page: ${esc(rawTitle)}`;
  const msg = card(
    { ...ev, severity: resolved ? 'success' : sev === 'outage' ? 'critical' : 'warning' },
    {
      title,
      body: [
        opened?.data.body ? quote(opened.data.body, 900) : null,
        resolved
          ? `✅ resolvido (${ts(upd!.created_at, 't')})`
          : `🟠 ${label('statusSeverity', sev)} — os lojistas veem este aviso`,
      ],
      buttons: row(linkButton('incidentes no CRM', ctx.crm('/lojas/incidentes'))),
    },
  );
  const reply =
    ev.kind === 'status.updated' && (ev as Ev<'status.updated'>).data.resolved
      ? `✅ aviso resolvido: ${esc(rawTitle)}`
      : null;
  return { card: msg, summary: title, reply };
}

function testCard(ev: Ev<'telegram.test'>): Rendered {
  const title = '✅ o bot da Venduá está funcionando';
  return {
    card: card(ev, {
      title,
      body: [`teste enviado por ${esc(ev.data.by ?? 'alguém da equipe')}.`],
    }),
    summary: title,
  };
}

function storeReset(ev: Ev<'store.reset'>, ctx: RenderCtx): Rendered {
  const title = `🧹 ${esc(ev.data.storeName)} foi zerada`;
  return {
    card: card(ev, {
      title,
      body: [`a equipe zerou ${mono(ev.data.slug)} no CRM: a loja volta ao começo do onboarding`],
      buttons: row(linkButton('ver loja', ctx.storeUrl)),
    }),
    summary: title,
  };
}

function storeDeleted(ev: Ev<'store.deleted'>): Rendered {
  const d = ev.data;
  const title = `🗑️ ${esc(d.storeName)} foi apagada`;
  return {
    card: card(ev, {
      title,
      body: [metaLine([mono(d.slug), d.owner ? `dono ${esc(d.owner)}` : null])],
    }),
    summary: title,
  };
}

function reviewLogin(ev: Ev<'auth.review_login'>): Rendered {
  const title = `🔑 a revisão das lojas de apps entrou na ${esc(ev.data.storeName)}`;
  return {
    card: card(ev, {
      title,
      body: ['pelo código fixo de VENDUA_REVIEW_LOGIN: troque o código quando a revisão acabar'],
    }),
    summary: title,
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
  ctx: Pick<RenderCtx, 'crm'>,
): TelegramMessage {
  const v = r.vendas;
  const top = v.top
    .slice(0, 5)
    .map((t) => `• ${esc(t.storeName)} — ${int(t.orders)} · ${brl(t.gmvCents)}`)
    .join('\n');
  const sections = [
    [
      b('💬 crm'),
      `leads novos: ${b(int(r.crm.newLeads))} · respostas: ${b(int(r.crm.replies))}`,
      `calls marcadas: ${b(int(r.crm.meetingsBooked))} (próximas 24h: ${int(r.crm.meetingsNext24h)}) · avanços: ${b(int(r.crm.milestones))}`,
    ].join('\n'),
    [
      b('🙋 esperando a equipe'),
      `rascunhos: ${b(int(r.crm.pendingDrafts))} · tarefas abertas: ${b(int(r.crm.openTasks))}`,
    ].join('\n'),
    [
      b('🤖 agente'),
      `runs: ${b(int(r.agent.runs))} · ${usd(r.agent.costCents)} · ${r.agent.failedRuns ? `⚠️ ${int(r.agent.failedRuns)} falharam` : 'nenhuma falhou'}`,
    ].join('\n'),
    [
      b('🛍️ vendas'),
      `pedidos: ${b(int(v.orders))} · ${b(brl(v.gmvCents))} em ${int(v.stores)} ${v.stores === 1 ? 'loja' : 'lojas'}${v.cancelled ? ` · cancelados: ${int(v.cancelled)}` : ''}`,
      v.firstOrders.length ? `🎉 primeiro pedido: ${v.firstOrders.map(esc).join(', ')}` : null,
      top || null,
    ]
      .filter(Boolean)
      .join('\n'),
    [
      b('🧾 assinaturas'),
      `lojas novas: ${b(int(r.assinaturas.newStores))} · faturas pagas: ${b(int(r.assinaturas.paid))} (${brl(r.assinaturas.paidCents)})${r.assinaturas.problems ? ` · ⚠️ problemas: ${int(r.assinaturas.problems)}` : ''}`,
    ].join('\n'),
    [
      b('🚀 frota'),
      `lojas no ar: ${b(int(r.frota.storesLive))} · ${r.frota.openIncidents ? `🟠 incidentes: ${int(r.frota.openIncidents)}` : 'sem incidentes'}${r.frota.failedDeployments ? ` · falhas deploy: ${int(r.frota.failedDeployments)}` : ''}`,
    ].join('\n'),
    [
      b('🛠️ sistema'),
      `erros 500: ${b(int(r.sistema.errors))} · reinícios: ${int(r.sistema.boots)}`,
      r.sistema.failingJobs.length
        ? `⚠️ rotinas falhando: ${r.sistema.failingJobs.map(esc).join(', ')}`
        : null,
    ]
      .filter(Boolean)
      .join('\n'),
  ];
  return card(ev, {
    title: `resumo de ${dayLabel(r.date)}`,
    body: [i('as últimas 24 horas'), '', sections.join('\n\n')],
    buttons: row(linkButton('abrir o CRM', ctx.crm('/'))),
  });
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
  'site.mode_changed': siteModeChanged,
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
  'partner.applied': partnerApplied,
  'agent.run_failed': runFailed,
  'agent.cost_cap': costCap,
  'system.boot': boot,
  'system.error': systemError,
  'telegram.test': testCard,
  'auth.review_login': reviewLogin,
  'store.reset': storeReset,
  'store.deleted': storeDeleted,
  'digest.daily': (ev, ctx) => ({
    card: digestCard(ev, ev.data, ctx),
    summary: `resumo de ${dayLabel(ev.data.date)}`,
  }),
};

function campaign(ev: EventRow, h: EventRow[], ctx: RenderCtx): Rendered {
  const started = first(h, 'campaign.started');
  const won = lastOf(h, 'campaign.won');
  const ended = lastOf(h, 'campaign.ended');
  const latest = h.at(-1) ?? ev;
  const lastProgress = lastOf(h, 'campaign.progress');
  const lastUpdate = lastOf(h, 'campaign.updated');

  const anyData = latest.data as {
    campaignId: string;
    title: string;
    goalKind: 'signup' | 'meeting' | 'reply';
    goalTarget: number;
    goalProgress?: number;
    spentCents?: number;
    budgetCents: number;
    hunts?: number;
    leads?: number;
  };
  const campaignId = started?.data.campaignId ?? anyData.campaignId;
  const title = started?.data.title ?? anyData.title ?? 'campanha autônoma';
  const goalKind = started?.data.goalKind ?? anyData.goalKind ?? 'signup';
  const goalTarget = started?.data.goalTarget ?? anyData.goalTarget ?? 1;

  // Determine current status from the latest state-changing event in anchor history
  let status: 'active' | 'paused' | 'won' | 'stopped' | 'exhausted' = 'active';
  let statusReason: string | null = null;
  let statusBy: string | null = null;
  for (const rowEv of h) {
    if (rowEv.kind === 'campaign.won') {
      status = 'won';
      statusReason = null;
      statusBy = null;
    } else if (rowEv.kind === 'campaign.ended') {
      const d = (rowEv as Ev<'campaign.ended'>).data;
      status = d.status;
      statusReason = d.reason;
      statusBy = d.by;
    } else if (rowEv.kind === 'campaign.updated') {
      const d = (rowEv as Ev<'campaign.updated'>).data;
      status = d.status;
      statusReason = d.reason;
      statusBy = d.by;
    }
  }

  const progress = anyData.goalProgress ?? 0;
  const spentCents = anyData.spentCents ?? 0;
  const budgetCents = anyData.budgetCents ?? started?.data.budgetCents ?? 0;
  const hunts = anyData.hunts ?? 0;
  const leads = anyData.leads ?? 0;
  const goalWord = label('campaignGoal', goalKind);

  const headEmoji =
    status === 'won'
      ? '🎉'
      : status === 'paused'
        ? '⏸'
        : status === 'exhausted'
          ? '⚠️'
          : status === 'stopped'
            ? '🛑'
            : '🚀';
  const headLabel =
    status === 'won' ? `meta batida · ${esc(title)}` : `modo campanha · ${esc(title)}`;

  const focusBits = [
    started?.data.focusSegment ? esc(started.data.focusSegment) : null,
    started?.data.focusCity ? esc(started.data.focusCity) : null,
  ];
  const progressLine =
    `meta: ${b(`${int(progress)}/${int(goalTarget)}`)} ${goalWord} · ` +
    `gasto ${b(usd(spentCents))} / ${usd(budgetCents)}`;
  const funnelLine =
    hunts > 0 || leads > 0 || lastProgress
      ? metaLine([
          `buscas: ${int(hunts)}`,
          `leads: ${int(leads)}`,
          lastProgress?.data.activeWip ? `em andamento: ${int(lastProgress.data.activeWip)}` : null,
          lastProgress?.data.replies ? `respostas: ${int(lastProgress.data.replies)}` : null,
        ])
      : null;

  const statusLine =
    status === 'won' && won
      ? `✅ ${b(who(won.data.winnerName, won.data.winnerBusiness))}${won.data.detail ? ` — ${esc(won.data.detail)}` : ''}`
      : status === 'paused'
        ? `⏸ pausada${byLine(statusBy, '')}${statusReason ? ` — ${esc(statusReason)}` : ''}`
        : status === 'exhausted'
          ? `⚠️ limite atingido${statusReason ? ` — ${esc(statusReason)}` : ''}`
          : status === 'stopped'
            ? `🛑 encerrada${byLine(statusBy, '')}${statusReason ? ` — ${esc(statusReason)}` : ''}`
            : `🟢 rodando${started ? ` · iniciada por ${esc(started.data.by)} (${ts(started.created_at, 't')})` : ''}`;

  const buttons: InlineButton[][] = [];
  if (status === 'active') {
    buttons.push(
      ...row(
        actionButton('💬 orientar', `cp:g:${campaignId}`, 'primary'),
        actionButton('⏸ pausar', `cp:p:${campaignId}`),
        actionButton('🛑 encerrar', `cp:s:${campaignId}`, 'danger'),
      ),
    );
  } else if (status === 'paused' || status === 'exhausted') {
    buttons.push(
      ...row(
        actionButton('▶️ retomar', `cp:r:${campaignId}`, 'success'),
        actionButton('➕ +US$10', `cp:b:${campaignId}`, 'primary'),
        actionButton('🛑 encerrar', `cp:s:${campaignId}`, 'danger'),
      ),
    );
  } else if (status === 'won' && won) {
    buttons.push(
      ...row(
        linkButton('abrir lead vencedor', ctx.crm(`/pipeline/${won.data.winnerLeadId}`)),
        linkButton('abrir campanha', ctx.crm(`/agente/campanhas/${campaignId}`)),
      ),
    );
  }
  if (status !== 'won') {
    buttons.push(...row(linkButton('abrir no CRM', ctx.crm(`/agente/campanhas/${campaignId}`))));
  }

  const msg = card(
    {
      ...ev,
      severity:
        status === 'won'
          ? 'success'
          : status === 'paused' || status === 'exhausted'
            ? 'warning'
            : 'info',
    },
    {
      title: `${headEmoji} ${headLabel}`,
      body: [
        started?.data.objective && status === 'active' && !lastProgress
          ? quote(started.data.objective, 360, 4)
          : null,
        focusBits.some(Boolean) ? `foco: ${metaLine(focusBits)}` : null,
        progressLine,
        funnelLine,
        lastProgress?.data.summary && status !== 'won'
          ? quote(lastProgress.data.summary, 420, 6)
          : null,
        statusLine,
      ],
      footer:
        status === 'active'
          ? 'responda esta mensagem (texto ou áudio) para ajustar o rumo da campanha'
          : null,
      buttons,
    },
  );

  let reply: string | null = null;
  if (ev.kind === 'campaign.won') {
    const d = (ev as Ev<'campaign.won'>).data;
    reply =
      `🎉 ${b('Meta batida!')} ${who(d.winnerName, d.winnerBusiness)} fechou ` +
      `(${int(d.goalProgress)}/${int(d.goalTarget)} ${goalWord} · gasto ${usd(d.spentCents)}). Campanha encerrada!`;
  } else if (ev.kind === 'campaign.ended') {
    const d = (ev as Ev<'campaign.ended'>).data;
    reply =
      d.status === 'exhausted'
        ? `⚠️ Campanha ${b(esc(title))} parou: ${esc(d.reason ?? 'limite atingido')}. Toque em ➕ +US$10 para continuar.`
        : `🛑 Campanha ${b(esc(title))} encerrada${byLine(d.by, '')}.`;
  } else if (ev.kind === 'campaign.updated' && lastUpdate) {
    const d = (ev as Ev<'campaign.updated'>).data;
    reply =
      d.status === 'paused'
        ? `⏸ Campanha ${b(esc(title))} pausada${d.reason ? `: ${esc(d.reason)}` : ''}.`
        : `▶️ Campanha ${b(esc(title))} retomada${d.reason ? ` (${esc(d.reason)})` : ''}.`;
  } else if (ev.kind === 'campaign.progress') {
    const d = (ev as Ev<'campaign.progress'>).data;
    if (d.urgent) reply = `📣 ${esc(d.summary)}`;
  }

  return { card: msg, summary: `${headEmoji} ${headLabel}`, reply };
}

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
  campaign,
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
  const title = STAFF_EVENT_KINDS[ev.kind]?.label ?? ev.kind;
  return {
    card: card(ev, {
      title: esc(title),
      body: [code(JSON.stringify(ev.data, null, 2), 1500)],
    }),
    summary: esc(title),
  };
}

/** An event about one store links to that store's page in the CRM, whatever its card. */
function withStorePage(out: Rendered, ev: EventRow, ctx: RenderCtx): Rendered {
  if (!ev.tenant_id) return out;
  const btn = linkButton('loja no CRM', ctx.crm(`/lojas/${ev.tenant_id}`))!;
  const rows = out.card.buttons ?? [];
  const last = rows.at(-1);
  // keep rows compact for phones (≤ 2 link buttons per row, never mixing action & link rows)
  const canAppend = last && last.length < 2 && last.every((x) => !!x.url);
  const buttons = canAppend ? [...rows.slice(0, -1), [...last, btn]] : [...rows, [btn]];
  return { ...out, card: { ...out.card, buttons } };
}
