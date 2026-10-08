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
  /** the money this refund gave back; `full` when nothing paid is left */
  refund?: { cents: number; full: boolean; online: boolean } | null;
  /** the order's status-only page on the store's site (`/pedido/<id>?t=vot.…`) */
  trackUrl?: string | null;
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
      return when ? `Seu pedido ${n} vai atrasar um pouquinho, desculpe 🙏 Agora ${when}.` : null;
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
      and kind in ('order', 'cart_reminder', 'store_open') and status = 'sent'
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
      }[]
    >`
      select o.number, o.customer ->> 'name' as name, o.customer_phone as phone,
             o.delivery ->> 'mode' as mode, o.total_cents as total,
             o.delivery ->> 'promisedFrom' as "from", o.delivery ->> 'promisedTo' as "to",
             o.scheduled_for::text as scheduled_for, t.name as store_name, t.slug, o.placed_at,
             s.hours ->> 'timezone' as tz
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
    phone: row.phone,
  };
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
  extra: { occurrence?: string; refund?: OrderFacts['refund'] } = {},
): Promise<boolean> {
  try {
    return await (
      tx as unknown as { savepoint<T>(fn: (s: Sql) => Promise<T>): Promise<T> }
    ).savepoint(async (sp) => {
      if (REPEATS.has(event) && !/^\d{1,20}$/.test(extra.occurrence ?? '')) return false;
      const wa = await sendingTx(sp, tenantId);
      if (!wa || !wa.events.includes(event)) return false;
      const facts = await orderFactsTx(sp, tenantId, orderId);
      const phone = facts?.phone ?? null;
      if (!facts || !phone || !/^\d{10,11}$/.test(phone)) return false;
      if (await optedOutTx(sp, tenantId, phone)) return false;
      const text = renderOrderMessage(event, { ...facts, refund: extra.refund ?? null });
      if (!text) return false;
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
