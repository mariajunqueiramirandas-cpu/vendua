import type { Sql } from '../platform/db.ts';
import { log } from '../platform/log.ts';
import { localParts } from '../platform/tz.ts';
import { phoneVariants } from './text.ts';

// Order updates a store sends its shoppers from its own WhatsApp. Core renders every word and
// figure here (money is Core's), queues the row in the order's own transaction, and the gateway
// only delivers it. A failure here never fails the order: it runs in a savepoint and logs.

const msgLog = log.child({ mod: 'store-whatsapp' });

export const ORDER_EVENTS = [
  'placed',
  'paid',
  'confirmed',
  'preparing',
  'ready',
  'out_for_delivery',
  'delivered',
  'cancelled',
] as const;
export type OrderEvent = (typeof ORDER_EVENTS)[number];

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
}

const brl = (cents: number) =>
  (cents / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

const hhmm = (iso: string, tz: string) => {
  const p = localParts(new Date(iso), tz);
  return `${String(Math.floor(p.minutes / 60)).padStart(2, '0')}:${String(p.minutes % 60).padStart(2, '0')}`;
};

const ddmm = (date: string) => `${date.slice(8, 10)}/${date.slice(5, 7)}`;

export function firstName(name: string): string {
  const first = name.trim().split(/\s+/)[0] ?? '';
  return first.slice(0, 40);
}

/** The text for one step, or null when this step says nothing for this order (a delivery
 *  order's "pronto" — its "saiu para entrega" follows). */
export function renderOrderMessage(event: OrderEvent, o: OrderFacts): string | null {
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
      let when = '';
      if (!o.scheduledFor && o.promisedTo) {
        if (o.mode === 'pickup')
          when = ` Fica pronto por volta das ${hhmm(o.promisedTo, o.timezone)}.`;
        else if (o.promisedFrom && o.promisedFrom !== o.promisedTo)
          when = ` Chega entre ${hhmm(o.promisedFrom, o.timezone)} e ${hhmm(o.promisedTo, o.timezone)}.`;
        else when = ` Chega por volta das ${hhmm(o.promisedTo, o.timezone)}.`;
      }
      return `Seu pedido ${n} foi aceito pela ${o.storeName} ✓${when}`;
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
  }
}

export const optOutAck = (storeName: string) =>
  `Pronto, você não vai mais receber avisos automáticos de pedidos da ${storeName}. Para voltar a receber, responda VOLTAR.`;

export const optInAck = (storeName: string) =>
  `Combinado! Você volta a receber os avisos dos seus pedidos da ${storeName} por aqui.`;

export const testMessage = (storeName: string) =>
  `Teste da Venduá ✓ O WhatsApp da ${storeName} está conectado e pronto para avisar seus clientes sobre os pedidos.`;

/** Sample order for the admin's previews. */
export function previewFacts(storeName: string, timezone: string): OrderFacts {
  const at = (min: number) => new Date(Date.now() + min * 60_000).toISOString();
  return {
    storeName,
    firstName: 'Ana',
    number: 128,
    mode: 'delivery',
    totalCents: 5890,
    promisedFrom: at(40),
    promisedTo: at(55),
    scheduledFor: null,
    timezone,
  };
}

export async function optedOutTx(tx: Sql, tenantId: string, phone: string): Promise<boolean> {
  const rows = await tx`
    select 1 from store_wa_optouts
    where tenant_id = ${tenantId} and phone = any(${phoneVariants(phone)}) limit 1`;
  return rows.length > 0;
}

/** Has this store ever texted this number? The first message carries the SAIR footer. */
async function knownPhoneTx(tx: Sql, tenantId: string, phone: string): Promise<boolean> {
  const rows = await tx`
    select 1 from store_wa_messages
    where tenant_id = ${tenantId} and phone = any(${phoneVariants(phone)}) and kind = 'order'
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
        tz: string | null;
      }[]
    >`
      select o.number, o.customer ->> 'name' as name, o.customer_phone as phone,
             o.delivery ->> 'mode' as mode, o.total_cents as total,
             o.delivery ->> 'promisedFrom' as "from", o.delivery ->> 'promisedTo' as "to",
             o.scheduled_for::text as scheduled_for, t.name as store_name,
             s.hours ->> 'timezone' as tz
      from orders o
        join tenants t on t.id = o.tenant_id
        left join store_settings s on s.tenant_id = o.tenant_id
      where o.tenant_id = ${tenantId} and o.id = ${orderId}`
  )[0];
  if (!row) return null;
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
    phone: row.phone,
  };
}

/**
 * Queue this order step's message when the store has its WhatsApp on and this step enabled.
 * Call inside the tenant transaction that commits the step, after any Promise.all batch: it
 * runs in a savepoint and never throws, so a bug here can't block an order.
 */
export async function enqueueOrderMessageTx(
  tx: Sql,
  tenantId: string,
  orderId: string,
  event: OrderEvent,
): Promise<boolean> {
  try {
    return await (
      tx as unknown as { savepoint<T>(fn: (s: Sql) => Promise<T>): Promise<T> }
    ).savepoint(async (sp) => {
      const wa = await sendingTx(sp, tenantId);
      if (!wa || !wa.events.includes(event)) return false;
      const facts = await orderFactsTx(sp, tenantId, orderId);
      const phone = facts?.phone ?? null;
      if (!facts || !phone || !/^\d{10,11}$/.test(phone)) return false;
      if (await optedOutTx(sp, tenantId, phone)) return false;
      const text = renderOrderMessage(event, facts);
      if (!text) return false;
      const body = (await knownPhoneTx(sp, tenantId, phone)) ? text : text + OPT_OUT_FOOTER;
      const rows = await sp`
          insert into store_wa_messages (tenant_id, order_id, kind, event, phone, body)
          values (${tenantId}, ${orderId}, 'order', ${event}, ${phone}, ${body})
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
  phone: string,
  body: string,
): Promise<string> {
  const rows = await tx<{ id: string }[]>`
    insert into store_wa_messages (tenant_id, kind, phone, body, expires_at)
    values (${tenantId}, ${kind}, ${phone}, ${body}, now() + interval '30 minutes')
    returning id`;
  return rows[0]!.id;
}
