import { emitAdminTx } from '../admin/live.ts';
import { withTenant, type Sql } from '../platform/db.ts';
import { HttpError } from '../platform/http.ts';
import { log } from '../platform/log.ts';
import {
  enqueueOrderNoteTx,
  optedOutTx,
  planCycleText,
  planPixCode,
  planPixReminderText,
} from '../store-whatsapp/messages.ts';
import { loadStoreSettings } from './cart.ts';
import { importLines } from './cart-share.ts';
import { createCartTx } from './cart-ops.ts';
import type { CheckoutInput } from './checkout.ts';
import type { PaymentProvider } from './payments/provider.ts';
import { placeOrderTx } from './place-order.ts';
import { addDays } from './shopper-plan-base.ts';
import type { PlanLine } from './shopper-plans.ts';
import { deriveStatus } from './store.ts';

// Plano semanal (0127): each active subscription's week, placed by Core `lead_days` before its
// date while the store is open (a closed store takes only encomendas). One plan_cycles row per
// subscription and date, inserted in the order's own transaction: at most one order a week. A
// week that can't be placed (a closed date, a sold-out basket, a zone gone) is a failed row, the
// shopper hears why, and the next week goes on.

const cycleLog = log.child({ mod: 'plan-cycles' });
/** a pass places at most this many per store; the next minute takes the rest */
const PER_PASS = 20;
/** a number that never said ASSINAR */
const PENDING_DAYS = 7;

interface DueRow {
  id: string;
  plan_name: string;
  plan_active: boolean;
  items: PlanLine[];
  phone: string;
  name: string;
  delivery: CheckoutInput['delivery'];
  payment: { method: CheckoutInput['payment']['method'] };
  notes: string | null;
  next_on: string;
  today: string;
}

const REASON: Record<string, string> = {
  STORE_CLOSED: 'a loja não abre nesse dia',
  INVALID_SCHEDULE: 'a loja não abre nesse dia',
  DATE_FULL: 'a agenda da loja lotou nesse dia',
  SOLD_OUT: 'os produtos do plano estão esgotados',
  PLAN_UNAVAILABLE: 'os produtos do plano estão esgotados',
  OUT_OF_ZONE: 'a loja não está entregando no seu endereço',
  DELIVERY_UNAVAILABLE: 'a loja não está entregando no seu endereço',
  DELIVERY_PAUSED: 'a loja pausou as entregas',
  PICKUP_UNAVAILABLE: 'a loja não está com retirada',
  ORDER_MIN_NOT_MET: 'o pedido ficou abaixo do mínimo da loja',
  PAYMENT_NOT_ALLOWED: 'a forma de pagamento não vale para encomendas',
  PAYMENT_METHOD_UNAVAILABLE: 'a forma de pagamento não está disponível',
  PLAN_OFF: 'a loja pausou este plano',
};

const ddmm = (date: string) => `${date.slice(8, 10)}/${date.slice(5, 7)}`;

/** The week's order: a fresh cart of the plan's lines through the one checkout. */
async function placeCycleTx(
  tx: Sql,
  tenantId: string,
  subscriptionId: string,
  /** the date the pass found due: another sweeper or a PULAR may have moved it since */
  dueOn: string,
  now: Date,
  provider: PaymentProvider | undefined,
): Promise<boolean> {
  const [s] = await tx<DueRow[]>`
    select s.id, p.name as plan_name, p.active as plan_active, p.items, s.phone, s.name,
           s.delivery, s.payment, s.notes, s.next_on::text as next_on,
           (${now}::timestamptz at time zone coalesce(st.hours ->> 'timezone', 'America/Sao_Paulo'))::date::text as today
    from plan_subscriptions s
      join shopper_plans p on p.id = s.plan_id
      left join store_settings st on st.tenant_id = s.tenant_id
    where s.tenant_id = ${tenantId} and s.id = ${subscriptionId} and s.state = 'active'
      and s.next_on = ${dueOn}
    for update of s`;
  if (!s) return false;
  // a date the store never got to (down, or closed every day before it): that week is gone
  if (s.next_on <= s.today) {
    await tx`
      insert into plan_cycles (tenant_id, subscription_id, day, state, reason)
      values (${tenantId}, ${s.id}, ${s.next_on}, 'failed', 'missed')
      on conflict do nothing`;
    let next = s.next_on;
    while (next <= s.today) next = addDays(next, 7);
    await tx`update plan_subscriptions set next_on = ${next}, last_error = 'missed'
             where tenant_id = ${tenantId} and id = ${s.id}`;
    await emitAdminTx(tx, tenantId, 'catalog', 'plans');
    return false;
  }
  // SAIR stops every automatic message: an order nobody hears of isn't placed
  if (await optedOutTx(tx, tenantId, s.phone)) {
    await tx`update plan_subscriptions set state = 'paused', last_error = 'opted_out'
             where tenant_id = ${tenantId} and id = ${s.id}`;
    await emitAdminTx(tx, tenantId, 'catalog', 'plans');
    return false;
  }
  if (!s.plan_active) throw new HttpError(409, 'PLAN_OFF', 'the store paused this plan');
  const [won] = await tx`
    insert into plan_cycles (tenant_id, subscription_id, day, state)
    values (${tenantId}, ${s.id}, ${s.next_on}, 'placed')
    on conflict do nothing returning day`;
  if (!won) {
    await tx`update plan_subscriptions set next_on = ${addDays(s.next_on, 7)}
             where tenant_id = ${tenantId} and id = ${s.id}`;
    return false;
  }
  // nobody holds this cart's session: Core builds it and checks it out in one go
  const { cartId } = await createCartTx(tx, tenantId, crypto.randomUUID());
  const report = await importLines(tx, tenantId, cartId, s.items);
  if (!report.added)
    throw new HttpError(409, 'PLAN_UNAVAILABLE', 'none of the plan’s products can be ordered');
  const missing = report.skipped.length
    ? (
        await tx<{ name: string }[]>`
          select name from products where tenant_id = ${tenantId}
            and id = any(${report.skipped.flatMap((k) => k.productId ?? [])}::uuid[])`
      ).map((r) => r.name)
    : [];
  const orderId = await placeOrderTx(
    tx,
    tenantId,
    cartId,
    {
      customer: { name: s.name, phone: s.phone },
      delivery: s.delivery,
      payment: { method: s.payment.method },
      ...(s.notes ? { notes: s.notes } : {}),
      scheduledFor: s.next_on,
    },
    now,
    provider,
    { provenPhone: s.phone, source: 'plan', quiet: true },
  );
  await tx`update plan_cycles set order_id = ${orderId}
           where tenant_id = ${tenantId} and subscription_id = ${s.id} and day = ${s.next_on}`;
  await tx`update plan_subscriptions set next_on = ${addDays(s.next_on, 7)}, last_error = null
           where tenant_id = ${tenantId} and id = ${s.id}`;
  await emitAdminTx(tx, tenantId, 'catalog', 'plans');
  const told = await enqueueOrderNoteTx(tx, tenantId, orderId, 'plan_cycle', (o) =>
    planCycleText(o, { name: s.plan_name, missing }),
  );
  if (told)
    await enqueueOrderNoteTx(tx, tenantId, orderId, 'plan_pix', planPixCode, { after: true });
  return true;
}

/** A week that couldn't be placed: recorded, the next one set, and the shopper told why. */
async function failCycleTx(
  tx: Sql,
  tenantId: string,
  subscriptionId: string,
  dueOn: string,
  code: string,
) {
  const [s] = await tx<{ next_on: string; plan_name: string; phone: string }[]>`
    select s.next_on::text as next_on, p.name as plan_name, s.phone
    from plan_subscriptions s join shopper_plans p on p.id = s.plan_id
    where s.tenant_id = ${tenantId} and s.id = ${subscriptionId} and s.state = 'active'
      and s.next_on = ${dueOn}
    for update of s`;
  if (!s) return;
  const [won] = await tx`
    insert into plan_cycles (tenant_id, subscription_id, day, state, reason)
    values (${tenantId}, ${subscriptionId}, ${s.next_on}, 'failed', ${code.slice(0, 80)})
    on conflict do nothing returning day`;
  const next = addDays(s.next_on, 7);
  await tx`update plan_subscriptions set next_on = ${next}, last_error = ${code.slice(0, 200)}
           where tenant_id = ${tenantId} and id = ${subscriptionId}`;
  await emitAdminTx(tx, tenantId, 'catalog', 'plans');
  if (!won || (await optedOutTx(tx, tenantId, s.phone))) return;
  const [wa] = await tx`select 1 from store_whatsapp where tenant_id = ${tenantId} and wanted`;
  if (!wa) return;
  const why = REASON[code] ?? 'a loja não conseguiu fazer o pedido';
  const body = `Oi! Esta semana não deu para fazer o pedido do seu plano "${s.plan_name}" para ${ddmm(s.next_on)}: ${why}. A próxima entrega é ${ddmm(next)}. Qualquer dúvida, é só responder aqui.`;
  // an answer-like note (0122's 'opt_in' rows), so it never waits behind the hourly caps
  await tx`
    insert into store_wa_messages (tenant_id, kind, event, phone, body, expires_at)
    values (${tenantId}, 'opt_in', 'plan', ${s.phone}, ${body}, now() + interval '6 hours')`;
}

/**
 * One store's plans for this minute: a pending number past its week is let go, and each active
 * subscription whose date is within its plan's lead gets its order, while the store is open.
 */
export async function planCyclePass(
  sql: Sql,
  tenantId: string,
  provider: PaymentProvider | undefined,
  now = new Date(),
): Promise<number> {
  const due = await withTenant(sql, tenantId, async (tx) => {
    const gone = await tx`
      update plan_subscriptions set state = 'cancelled', cancelled_at = now(),
        cancelled_by = 'not_confirmed', next_on = null
      where tenant_id = ${tenantId} and state = 'pending'
        and created_at < ${now}::timestamptz - make_interval(days => ${PENDING_DAYS})
      returning id`;
    if (gone.length) await emitAdminTx(tx, tenantId, 'catalog', 'plans');
    const settings = await loadStoreSettings(tx, tenantId);
    if (!settings) return [];
    const status = deriveStatus(
      settings.hours ?? { timezone: 'America/Sao_Paulo', windows: [] },
      settings.status_override ?? null,
      settings.resumes_at ?? null,
      now,
      settings.special_days ?? [],
    );
    if (status.status !== 'open') return [];
    const tz = settings.hours?.timezone || 'America/Sao_Paulo';
    return tx<{ id: string; next_on: string }[]>`
      select s.id, s.next_on::text as next_on
      from plan_subscriptions s join shopper_plans p on p.id = s.plan_id
      where s.tenant_id = ${tenantId} and s.state = 'active' and s.next_on is not null
        and s.next_on - p.lead_days <= (${now}::timestamptz at time zone ${tz})::date
      order by s.next_on limit ${PER_PASS}`;
  });
  let placed = 0;
  for (const { id, next_on } of due) {
    try {
      if (
        await withTenant(sql, tenantId, (tx) =>
          placeCycleTx(tx, tenantId, id, next_on, now, provider),
        )
      )
        placed++;
    } catch (err) {
      // a checkout refusal is this week's answer; anything else is retried next minute
      if (!(err instanceof HttpError)) {
        cycleLog.warn({ err, tenantId, subscriptionId: id }, 'plan week not placed');
        continue;
      }
      await withTenant(sql, tenantId, (tx) => failCycleTx(tx, tenantId, id, next_on, err.code));
    }
  }
  return placed;
}

/** a week's order placed less than this ago isn't reminded yet: its message just went out */
const REMIND_AFTER = '6 hours';

export interface PlanPush {
  key: string;
  title: string;
  body: string;
}

/**
 * The weeks whose Pix hasn't landed as their date comes (from 09:00 the day before): the shopper
 * gets one reminder with the code again, and the store one push, so it decides before it bakes.
 * Nothing is cancelled here: an unpaid week is the store's call (or the shopper's PULAR).
 */
export async function planPaymentPass(
  sql: Sql,
  tenantId: string,
  now = new Date(),
): Promise<PlanPush[]> {
  return withTenant(sql, tenantId, async (tx) => {
    const due = await tx<
      { id: string; number: number; total: number; day: string; today: string; plan: string }[]
    >`
      with local as (
        select (${now}::timestamptz at time zone z)::date as today,
               (${now}::timestamptz at time zone z)::time as t
        from (select coalesce(hours ->> 'timezone', 'America/Sao_Paulo') as z
              from store_settings where tenant_id = ${tenantId}) tz
      )
      select o.id, o.number, o.total_cents as total, o.scheduled_for::text as day,
             local.today::text as today, p.name as plan
      from orders o
        join plan_cycles c on c.tenant_id = o.tenant_id and c.order_id = o.id
        join plan_subscriptions s on s.id = c.subscription_id
        join shopper_plans p on p.id = s.plan_id,
        local
      where o.tenant_id = ${tenantId} and o.source = 'plan'
        and o.state not in ('cancelled', 'refunded', 'delivered')
        and coalesce(o.payment ->> 'status', 'pending') = 'pending'
        and o.placed_at < ${now}::timestamptz - ${REMIND_AFTER}::interval
        and local.t >= '09:00' and o.scheduled_for between local.today and local.today + 1
        and not exists (select 1 from store_wa_messages m
                        where m.order_id = o.id and m.event = 'plan_pix_reminder')
      order by o.scheduled_for, o.number limit 50`;
    const pushes: PlanPush[] = [];
    for (const o of due) {
      const told = await enqueueOrderNoteTx(tx, tenantId, o.id, 'plan_pix_reminder', (f) =>
        planPixReminderText(f, { name: o.plan }, o.today),
      );
      if (told)
        await enqueueOrderNoteTx(tx, tenantId, o.id, 'plan_pix_again', planPixCode, {
          after: true,
        });
      pushes.push({
        key: `planpix:${o.id}`,
        title: `Pix do plano não chegou: #${o.number}`,
        body: `${brl(o.total)}, entrega ${o.day === o.today ? 'hoje' : 'amanhã'}.${told ? ' O cliente foi lembrado pelo WhatsApp.' : ''} Toque para ver o pedido.`,
      });
    }
    return pushes;
  });
}

const brl = (cents: number) =>
  (cents / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
