import type { Sql } from '../platform/db.ts';
import { log } from '../platform/log.ts';
import { storeOrigin } from '../platform/store-origin.ts';
import { localParts } from '../platform/tz.ts';
import { jidForPhone, phoneVariants } from './text.ts';

// Order updates a store sends its shoppers from its own WhatsApp. Core renders every word and
// figure here (money is Core's), queues the row in the order's own transaction, and the gateway
// only delivers it. A failure here never fails the order: it runs in a savepoint and logs.

const msgLog = log.child({ mod: 'store-whatsapp' });

export const ORDER_EVENTS = [
  'placed',
  'paid',
  'confirmed',
  'delayed',
  'preparing',
  'ready',
  'out_for_delivery',
  'delivered',
  'cancelled',
  'refunded',
] as const;
export type OrderEvent = (typeof ORDER_EVENTS)[number];

/** steps that can happen more than once on one order: each occurrence is its own message */
const REPEATS: ReadonlySet<OrderEvent> = new Set(['delayed', 'refunded']);

export const isOrderEvent = (v: unknown): v is OrderEvent =>
  typeof v === 'string' && (ORDER_EVENTS as readonly string[]).includes(v);

/** states in which queued messages can still go out (a reconnecting store catches up) */
const SENDABLE_STATES = new Set(['open', 'connecting', 'error']);

/** a shopper who wrote SAIR before gets nothing until VOLTAR */
export const OPT_OUT_FOOTER = '\n\n_Para não receber estes avisos, responda SAIR._';

/** "o de sempre" (modules/usual-reminder.ts), offered under a delivered order's message */
export const USUAL_INVITE =
  '\n\nQuer que a gente te lembre do seu pedido de sempre? Responda LEMBRAR. É no máximo uma mensagem por semana.';

/** The store sends "o de sempre" and this phone hasn't asked for it, nor been offered it lately. */
async function usualInviteTx(tx: Sql, tenantId: string, phone: string): Promise<boolean> {
  const [r] = await tx<{ ok: boolean }[]>`
    select coalesce((select usual_reminder and wanted and state in ('open', 'connecting', 'error')
                     from store_whatsapp where tenant_id = ${tenantId}), false)
      and not exists (select 1 from usual_reminders where tenant_id = ${tenantId}
                        and phone = any(${phoneVariants(phone)}))
      and not exists (select 1 from store_wa_messages where tenant_id = ${tenantId}
                        and kind = 'order' and event = 'delivered'
                        and phone = any(${phoneVariants(phone)})
                        and created_at > now() - interval '30 days'
                        and body like '%Responda LEMBRAR%') as ok`;
  return !!r?.ok;
}

export interface OrderFacts {
  storeName: string;
  firstName: string;
  number: number;
  mode: 'pickup' | 'delivery';
  totalCents: number;
  /** promised window ISO instants (null for encomendas) */
  promisedFrom: string | null;
  promisedTo: string | null;
  /** encomenda date YYYY-MM-DD */
  scheduledFor: string | null;
  timezone: string;
  /** Freio's late notice: the apology coupon on the delay message */
  apology?: { code: string; words: string } | null;
  /** the money this refund gave back; `full` when nothing paid is left */
  refund?: { cents: number; full: boolean; online: boolean } | null;
  /** the order's status-only page on the store's site (`/pedido/<id>?t=vot.…`) */
  trackUrl?: string | null;
  /** where the order came from (orders.source): a weekly plan's orders say more about the Pix */
  source?: string;
  /** how it's paid: a Pix by hand carries its copia-e-cola code (the store's own key) */
  pay?: { method: string; online: boolean; paid: boolean; copyPaste: string | null };
}

interface OrderLinks {
  storeDomain: string;
  /** the order's status-only credential (orders.ts orderTrackToken, bound to the boot secret) */
  token: (tenantId: string, orderId: string, placedAt: Date) => string;
}

// set once at boot (index.ts); unset = messages go without the link (tests, scripts)
let orderLinks: OrderLinks | null = null;
export function configureOrderLinks(c: OrderLinks | null): void {
  orderLinks = c;
}

const brl = (cents: number) =>
  (cents / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

const hhmm = (iso: string, tz: string) => {
  const p = localParts(new Date(iso), tz);
  return `${String(Math.floor(p.minutes / 60)).padStart(2, '0')}:${String(p.minutes % 60).padStart(2, '0')}`;
};

const ddmm = (date: string) => `${date.slice(8, 10)}/${date.slice(5, 7)}`;

/** The shopper-typed first name, or '' when it could carry a link or WhatsApp formatting: the
 *  store's own number would send it verbatim. */
export function firstName(name: string): string {
  const first = (name.trim().split(/\s+/)[0] ?? '').slice(0, 40);
  return /[.\/@:_*~`\d]/.test(first) ? '' : first;
}

/** steps after which there is nothing left to follow — the link only shows the order */
const FINAL_EVENTS: ReadonlySet<OrderEvent> = new Set(['delivered', 'cancelled', 'refunded']);

/** The text for one step, or null when this step says nothing for this order (a delivery
 *  order's "pronto" — its "saiu para entrega" follows). Ends with the order's link, when set. */
export function renderOrderMessage(event: OrderEvent, o: OrderFacts): string | null {
  const text = stepText(event, o);
  if (!text || !o.trackUrl) return text;
  const label = FINAL_EVENTS.has(event) ? 'Ver o pedido' : 'Acompanhe o pedido';
  return `${text}\n\n${label}: ${o.trackUrl}`;
}

function stepText(event: OrderEvent, o: OrderFacts): string | null {
  const n = `#${o.number}`;
  const hi = o.firstName ? `Oi, ${o.firstName}! ` : 'Oi! ';
  switch (event) {
    case 'placed': {
      const what = o.scheduledFor
        ? `sua encomenda ${n} para ${ddmm(o.scheduledFor)}`
        : `seu pedido ${n}`;
      return `${hi}Aqui é da ${o.storeName} 👋\nRecebemos ${what} (${brl(o.totalCents)}). A gente avisa por aqui cada passo.`;
    }
    case 'paid':
      return `Pagamento do pedido ${n} confirmado ✓`;
    case 'confirmed': {
      const when = promise(o);
      return `Seu pedido ${n} foi aceito pela ${o.storeName} ✓${when ? ` ${cap(when)}.` : ''}`;
    }
    case 'delayed': {
      const when = promise(o);
      if (!when) return null;
      const sorry = o.apology
        ? ` Pra compensar, seu próximo pedido tem ${o.apology.words}: cupom ${o.apology.code}.`
        : '';
      return `Seu pedido ${n} vai atrasar um pouquinho, desculpe 🙏 Agora ${when}.${sorry}`;
    }
    case 'preparing':
      return `Seu pedido ${n} está sendo preparado 👩‍🍳`;
    case 'ready':
      return o.mode === 'pickup' ? `Seu pedido ${n} está pronto para retirar. Te esperamos!` : null;
    case 'out_for_delivery':
      return `Seu pedido ${n} saiu para entrega e chega logo 🛵`;
    case 'delivered':
      return `Pedido ${n} entregue. Obrigado por comprar na ${o.storeName}! 💛`;
    case 'cancelled':
      return `Seu pedido ${n} foi cancelado. Qualquer dúvida, é só responder esta mensagem.`;
    case 'refunded': {
      const r = o.refund;
      if (!r || r.cents <= 0) return null;
      const what = r.full
        ? `o valor do seu pedido ${n} (${brl(r.cents)})`
        : `${brl(r.cents)} do seu pedido ${n}`;
      return r.online
        ? `Devolvemos ${what} ✓ O dinheiro volta pela mesma forma de pagamento que você usou.`
        : `A ${o.storeName} devolveu ${what}. Qualquer dúvida, é só responder esta mensagem.`;
    }
  }
}

/** "chega entre 19:40 e 19:55" / "fica pronto por volta das 19:40"; none for an encomenda */
function promise(o: OrderFacts): string | null {
  if (o.scheduledFor || !o.promisedTo) return null;
  const to = hhmm(o.promisedTo, o.timezone);
  if (o.mode === 'pickup') return `fica pronto por volta das ${to}`;
  if (o.promisedFrom && o.promisedFrom !== o.promisedTo)
    return `chega entre ${hhmm(o.promisedFrom, o.timezone)} e ${to}`;
  return `chega por volta das ${to}`;
}

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

export const optOutAck = (storeName: string) =>
  `Pronto, você não vai mais receber avisos automáticos de pedidos da ${storeName}. Para voltar a receber, responda VOLTAR.`;

export const optInAck = (storeName: string) =>
  `Combinado! Você volta a receber os avisos dos seus pedidos da ${storeName} por aqui.`;

export const usualAck = (storeName: string) =>
  `Combinado! Uma vez por semana, no máximo, a ${storeName} te lembra do seu pedido de sempre. Para parar, responda SAIR.`;

export const testMessage = (storeName: string) =>
  `Teste da Venduá ✓ O WhatsApp da ${storeName} está conectado e pronto para avisar seus clientes sobre os pedidos.`;

/** Sample order for the admin's previews; `origin` = the store's address, for a sample link
 *  (the real one carries the order's id and its status-only token). */
export function previewFacts(
  storeName: string,
  timezone: string,
  origin?: string | null,
): OrderFacts {
  const at = (min: number) => new Date(Date.now() + min * 60_000).toISOString();
  return {
    trackUrl: origin ? `${origin}/pedido/128` : null,
    storeName,
    firstName: 'Ana',
    number: 128,
    mode: 'delivery',
    totalCents: 5890,
    promisedFrom: at(40),
    promisedTo: at(55),
    scheduledFor: null,
    timezone,
    refund: { cents: 5890, full: true, online: true },
  };
}

/** The store's address for the previews' sample link; null while messages go without one. */
export async function previewOriginTx(tx: Sql, tenantId: string): Promise<string | null> {
  const links = orderLinks;
  if (!links) return null;
  const rows = await tx<{ slug: string }[]>`select slug from tenants where id = ${tenantId}`;
  return rows[0] ? storeOrigin(tx, { id: tenantId, slug: rows[0].slug }, links.storeDomain) : null;
}

export async function optedOutTx(tx: Sql, tenantId: string, phone: string): Promise<boolean> {
  const variants = phoneVariants(phone);
  // a SAIR kept by the chat's address, from before WhatsApp told us the number
  const jids = variants.map((p) => jidForPhone(p)).filter((j): j is string => !!j);
  const rows = await tx`
    select 1 from store_wa_optouts
    where tenant_id = ${tenantId} and (phone = any(${variants}) or jid = any(${jids}::text[]))
    limit 1`;
  return rows.length > 0;
}

/** Has this store's WhatsApp already reached this number about an order (or with a reminder,
 *  which always carries it)? The first message that actually goes out carries the SAIR footer;
 *  a failed or expired one doesn't count. */
export async function contactedTx(tx: Sql, tenantId: string, phone: string): Promise<boolean> {
  const rows = await tx`
    select 1 from store_wa_messages
    where tenant_id = ${tenantId} and phone = any(${phoneVariants(phone)})
      and kind in ('order', 'cart_reminder', 'store_open', 'usual_reminder') and status = 'sent'
    limit 1`;
  return rows.length > 0;
}

interface Wanted {
  state: string;
  events: string[];
}

async function sendingTx(tx: Sql, tenantId: string): Promise<Wanted | null> {
  const row = (
    await tx<Wanted[]>`
      select state, events from store_whatsapp where tenant_id = ${tenantId} and wanted`
  )[0];
  return row && SENDABLE_STATES.has(row.state) ? row : null;
}

async function orderFactsTx(
  tx: Sql,
  tenantId: string,
  orderId: string,
): Promise<(OrderFacts & { phone: string | null }) | null> {
  const row = (
    await tx<
      {
        number: number;
        name: string | null;
        phone: string | null;
        mode: string | null;
        total: number;
        from: string | null;
        to: string | null;
        scheduled_for: string | null;
        store_name: string;
        slug: string;
        placed_at: Date;
        tz: string | null;
        source: string;
        payment: {
          method?: string;
          online?: boolean;
          status?: string;
          pix?: { copyPaste?: string } | null;
        } | null;
      }[]
    >`
      select o.number, o.customer ->> 'name' as name, o.customer_phone as phone,
             o.delivery ->> 'mode' as mode, o.total_cents as total,
             o.delivery ->> 'promisedFrom' as "from", o.delivery ->> 'promisedTo' as "to",
             o.scheduled_for::text as scheduled_for, t.name as store_name, t.slug, o.placed_at,
             s.hours ->> 'timezone' as tz, o.source, o.payment
      from orders o
        join tenants t on t.id = o.tenant_id
        left join store_settings s on s.tenant_id = o.tenant_id
      -- a PDV order is followed only when it goes out for delivery: the customer is waiting at
      -- home on the phone they gave (ADR 0035)
      where o.tenant_id = ${tenantId} and o.id = ${orderId}
        and (o.source <> 'pdv' or o.delivery ->> 'mode' = 'delivery')`
  )[0];
  if (!row) return null;
  const links = orderLinks;
  return {
    storeName: row.store_name,
    firstName: firstName(row.name ?? ''),
    number: row.number,
    mode: row.mode === 'pickup' ? 'pickup' : 'delivery',
    totalCents: row.total,
    promisedFrom: row.from,
    promisedTo: row.to,
    scheduledFor: row.scheduled_for,
    timezone: row.tz || 'America/Sao_Paulo',
    trackUrl: links
      ? `${await storeOrigin(tx, { id: tenantId, slug: row.slug }, links.storeDomain)}/pedido/${orderId}?t=${links.token(tenantId, orderId, row.placed_at)}`
      : null,
    source: row.source,
    pay: {
      method: row.payment?.method ?? '',
      online: row.payment?.online === true,
      paid: row.payment?.status === 'paid',
      copyPaste: row.payment?.pix?.copyPaste ?? null,
    },
    phone: row.phone,
  };
}

/** Festa calculada F0: the day before an encomenda, its date and where it's picked up or goes */
export function eveReminderText(o: OrderFacts): string | null {
  if (!o.scheduledFor) return null;
  const hi = o.firstName ? `Oi, ${o.firstName}! ` : 'Oi! ';
  const how = o.mode === 'pickup' ? 'Pode vir retirar' : 'A entrega sai';
  const text = `${hi}Amanhã (${ddmm(o.scheduledFor)}) é o dia da sua encomenda #${o.number} na ${o.storeName} 🎉 ${how} conforme combinado. Qualquer mudança, é só responder esta mensagem.`;
  return o.trackUrl ? `${text}\n\nAcompanhe o pedido: ${o.trackUrl}` : text;
}

/** Queues the D−1 message once per order (event 'reminder_eve'), on the store's linked number. */
export function enqueueEveReminderTx(tx: Sql, tenantId: string, orderId: string): Promise<boolean> {
  return enqueueOrderNoteTx(tx, tenantId, orderId, 'reminder_eve', eveReminderText);
}

const WEEKDAYS = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado'];
/** "toda sexta", "todo sábado" */
export const everyWeekday = (w: number) => `${w === 0 || w === 6 ? 'todo' : 'toda'} ${WEEKDAYS[w]}`;

/** Plano semanal (0127): under the first order, the plan it starts; a typed number confirms it */
export function planConfirmText(
  o: OrderFacts,
  plan: { name: string; weekday: number; nextOn: string; active: boolean },
): string {
  const hi = o.firstName ? `Oi, ${o.firstName}! ` : 'Oi! ';
  const head = `${hi}Você assinou o plano semanal "${plan.name}" da ${o.storeName}: ${everyWeekday(plan.weekday)} a loja faz este pedido para você e avisa aqui antes.`;
  const tail = plan.active
    ? `A próxima entrega é ${ddmm(plan.nextOn)}. Para pular uma semana, responda PULAR. Para encerrar, responda CANCELAR PLANO.`
    : 'Para confirmar, responda ASSINAR. Sem essa resposta o plano não começa (este pedido segue normal). Se não foi você, é só ignorar esta mensagem.';
  return `${head}\n\n${tail}`;
}

/** How the shopper pays a plan's week: the code in the next message, or the order page. */
function planPayLine(o: OrderFacts, again: boolean): string {
  if (o.pay?.online)
    return `Pague o Pix pela página do pedido${o.trackUrl ? ' (o link abaixo)' : ''}: a confirmação chega aqui sozinha.`;
  if (o.pay?.copyPaste)
    return `O código Pix copia e cola vem ${again ? 'de novo ' : ''}na próxima mensagem. Depois de pagar, mande o comprovante aqui.`;
  return 'Responda esta mensagem para combinar o Pix com a loja.';
}

/** The week's order, placed by the plan: what, when, how much, how to pay and how to skip it */
export function planCycleText(
  o: OrderFacts,
  plan: { name: string; missing: string[] },
): string | null {
  if (!o.scheduledFor) return null;
  const hi = o.firstName ? `Oi, ${o.firstName}! ` : 'Oi! ';
  const lines = [
    `${hi}O pedido do seu plano "${plan.name}" desta semana está feito: #${o.number}, para ${ddmm(o.scheduledFor)}. Total: ${brl(o.totalCents)}, por Pix.`,
    plan.missing.length ? `Fora desta vez (a loja não tem hoje): ${plan.missing.join(', ')}.` : '',
    planPayLine(o, false),
    'Para pular esta semana, responda PULAR. Para encerrar o plano, responda CANCELAR PLANO.',
  ].filter(Boolean);
  const text = lines.join('\n\n');
  return o.trackUrl ? `${text}\n\nAcompanhe o pedido: ${o.trackUrl}` : text;
}

/** The week's Pix, still unpaid as the date comes: the total, the date and the code again */
export function planPixReminderText(
  o: OrderFacts,
  plan: { name: string },
  today: string,
): string | null {
  if (!o.scheduledFor || o.pay?.paid) return null;
  const hi = o.firstName ? `Oi, ${o.firstName}! ` : 'Oi! ';
  const when = o.scheduledFor === today ? 'hoje' : `amanhã (${ddmm(o.scheduledFor)})`;
  const text = [
    `${hi}O Pix do pedido #${o.number} do seu plano "${plan.name}" (${brl(o.totalCents)}) ainda não chegou para a ${o.storeName}. A entrega é ${when}.`,
    planPayLine(o, true),
    'Se não quiser esta semana, responda PULAR.',
  ].join('\n\n');
  return o.pay?.online && o.trackUrl ? `${text}\n\nPagar: ${o.trackUrl}` : text;
}

/** The copia-e-cola code alone, so a long press copies just it (the store's own Pix key) */
export function planPixCode(o: OrderFacts): string | null {
  return !o.pay?.online && !o.pay?.paid ? (o.pay?.copyPaste ?? null) : null;
}

/**
 * A store note on one order beyond its steps (the eve reminder, a plan's messages): once per
 * order and event, on the store's linked number, never to a number that said SAIR. Runs in a
 * savepoint and never throws, like enqueueOrderMessageTx.
 */
export async function enqueueOrderNoteTx(
  tx: Sql,
  tenantId: string,
  orderId: string,
  event: string,
  render: (o: OrderFacts) => string | null,
  /** queued after this tx's other messages (a Pix code under its message) */
  opts: { after?: boolean } = {},
): Promise<boolean> {
  try {
    return await (
      tx as unknown as { savepoint<T>(fn: (s: Sql) => Promise<T>): Promise<T> }
    ).savepoint(async (sp) => {
      const wa = await sendingTx(sp, tenantId);
      if (!wa) return false;
      const facts = await orderFactsTx(sp, tenantId, orderId);
      const phone = facts?.phone ?? null;
      if (!facts || !phone || !/^\d{10,11}$/.test(phone)) return false;
      if (await optedOutTx(sp, tenantId, phone)) return false;
      const text = render(facts);
      if (!text) return false;
      const rows = await sp`
          insert into store_wa_messages (tenant_id, order_id, kind, event, phone, body, created_at)
          values (${tenantId}, ${orderId}, 'order', ${event}, ${phone}, ${text},
                  ${opts.after ? sp`clock_timestamp()` : sp`now()`})
          on conflict (order_id, event) where order_id is not null do nothing
          returning id`;
      return rows.length > 0;
    });
  } catch (err) {
    msgLog.error({ err, orderId, event }, 'order note not queued');
    return false;
  }
}

/**
 * Queue this order step's message when the store has its WhatsApp on and this step enabled.
 * Call inside the tenant transaction that commits the step, after any Promise.all batch: it
 * runs in a savepoint and never throws, so a bug here can't block an order.
 * A step that repeats (a delay, a refund) names its `occurrence` (digits): the same one queued
 * twice is still one message.
 */
export async function enqueueOrderMessageTx(
  tx: Sql,
  tenantId: string,
  orderId: string,
  event: OrderEvent,
  extra: {
    occurrence?: string;
    refund?: OrderFacts['refund'];
    /** Freio's late notice: the apology coupon, said on the delay message */
    apology?: { code: string; words: string };
  } = {},
): Promise<boolean> {
  try {
    return await (
      tx as unknown as { savepoint<T>(fn: (s: Sql) => Promise<T>): Promise<T> }
    ).savepoint(async (sp) => {
      if (REPEATS.has(event) && !/^\d{1,20}$/.test(extra.occurrence ?? '')) return false;
      const wa = await sendingTx(sp, tenantId);
      // a weekly plan's Pix is paid from these messages: its "pago" is always said
      const enabled = !!wa && wa.events.includes(event);
      if (!wa || (!enabled && event !== 'paid')) return false;
      const facts = await orderFactsTx(sp, tenantId, orderId);
      if (!enabled && facts?.source !== 'plan') return false;
      const phone = facts?.phone ?? null;
      if (!facts || !phone || !/^\d{10,11}$/.test(phone)) return false;
      if (await optedOutTx(sp, tenantId, phone)) return false;
      let text = renderOrderMessage(event, {
        ...facts,
        refund: extra.refund ?? null,
        apology: extra.apology ?? null,
      });
      if (!text) return false;
      // a delivered order may offer "o de sempre" once, to someone who hasn't asked yet
      if (event === 'delivered' && (await usualInviteTx(sp, tenantId, phone)))
        text = text.includes(OPT_OUT_FOOTER)
          ? text.replace(OPT_OUT_FOOTER, USUAL_INVITE + OPT_OUT_FOOTER)
          : text + USUAL_INVITE;
      const key = REPEATS.has(event) ? `${event}:${extra.occurrence}` : event;
      const rows = await sp`
          insert into store_wa_messages (tenant_id, order_id, kind, event, phone, body)
          values (${tenantId}, ${orderId}, 'order', ${key}, ${phone}, ${text})
          on conflict (order_id, event) where order_id is not null do nothing
          returning id`;
      return rows.length > 0;
    });
  } catch (err) {
    msgLog.error({ err, orderId, event }, 'order message not queued');
    return false;
  }
}

/** Queue a non-order message (acks, the merchant's test). No savepoint: callers own the tx. */
export async function enqueueTextTx(
  tx: Sql,
  tenantId: string,
  kind: 'opt_out' | 'opt_in' | 'test',
  phone: string | null,
  body: string,
  jid: string | null = null,
): Promise<string> {
  const rows = await tx<{ id: string }[]>`
    insert into store_wa_messages (tenant_id, kind, phone, jid, body, expires_at)
    values (${tenantId}, ${kind}, ${phone}, ${jid}, ${body}, now() + interval '30 minutes')
    returning id`;
  return rows[0]!.id;
}
