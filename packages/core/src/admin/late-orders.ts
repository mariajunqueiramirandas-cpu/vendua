import { mintCouponTx } from '../modules/coupons.ts';
import { brl } from '../modules/discord/format.ts';
import { freioConfig, queueTx, readyInMinutes, type FreioPush } from '../modules/freio.ts';
import type { OrderView } from '../modules/orders.ts';
import type { StoreSettingsRow } from '../modules/store.ts';
import type { Sql } from '../platform/db.ts';
import { HttpError } from '../platform/http.ts';
import type { Merchant } from './context.ts';
import { emitAdminTx } from './live.ts';
import { delayOrderTx } from './routes-orders.ts';

// Freio › Atraso avisado (docs/features/freio-automatico.md §4.3, 0125). Each sweep re-predicts
// the open orders whose promise is near: their lane in the kitchen, plus drive and the courier's
// buffer for a delivery. One that will miss its promise by 5 minutes or more gets one notice,
// ever (order_late_notices): a suggestion to tap (Sugerir) or the message itself (Automático),
// through the same path as "Atrasou", with an apology coupon while the month's budget lasts.

/** a promise this close starts the evaluation; being near is not being late */
const LOOK_AHEAD_MINUTES = 15;
const LATE_BY_MINUTES = 5;
/** an apology per phone at most this often */
const APOLOGY_EVERY_DAYS = 14;
const APOLOGY_VALID_DAYS = 30;

export const FREIO_LATE_ACTOR = { name: 'Freio automático', userId: null };

const ceil5 = (n: number) => Math.max(5, Math.ceil(n / 5) * 5);

export async function latePassTx(tx: Sql, tenantId: string, now: Date): Promise<FreioPush[]> {
  const [s] = await tx<StoreSettingsRow[]>`
    select * from store_settings where tenant_id = ${tenantId}`;
  const mode = s?.late_mode ?? 'suggest';
  if (!s || mode === 'off') return [];
  const near = await tx<
    {
      id: string;
      number: number;
      state: string;
      delivery: OrderView['delivery'];
    }[]
  >`
    select o.id, o.number, o.state, o.delivery from orders o
    where o.tenant_id = ${tenantId} and o.state in ('confirmed', 'preparing', 'ready')
      and o.scheduled_for is null
      and (o.delivery ->> 'promisedTo') is not null
      and (o.delivery ->> 'promisedTo')::timestamptz < ${now}::timestamptz + make_interval(mins => ${LOOK_AHEAD_MINUTES})
      and not (o.state = 'ready' and o.delivery ->> 'mode' <> 'delivery')
      and not exists (select 1 from order_late_notices n where n.order_id = o.id)
    order by o.placed_at limit 20`;
  if (!near.length) return [];
  const cfg = freioConfig(s);
  const queue = await queueTx(
    tx,
    tenantId,
    now,
    cfg.prep,
    s.hours?.timezone || 'America/Sao_Paulo',
  );
  const pushes: FreioPush[] = [];
  for (const o of near) {
    const ticket = queue.find((q) => q.id === o.id);
    // a stale ticket says nothing about when it'll be ready
    if (o.state !== 'ready' && !ticket) continue;
    const ready = o.state === 'ready' ? 0 : readyInMinutes(ticket!, queue, cfg.capacity, now);
    const travel = o.delivery.mode === 'delivery' ? (o.delivery.driveMinutes ?? 0) + cfg.buffer : 0;
    const predicted = now.getTime() + (ready + travel) * 60_000;
    const late = (predicted - Date.parse(o.delivery.promisedTo!)) / 60_000;
    if (late < LATE_BY_MINUTES) continue;
    const minutes = Math.min(600, Math.ceil(late));
    const won = await tx`
      insert into order_late_notices (order_id, tenant_id, predicted_minutes, mode)
      values (${o.id}, ${tenantId}, ${minutes}, ${mode})
      on conflict do nothing returning order_id`;
    if (!won.length) continue;
    if (mode === 'auto') {
      await sendLateNoticeTx(tx, tenantId, FREIO_LATE_ACTOR, o.id);
      pushes.push({
        key: `late:${o.id}`,
        title: `#${o.number} vai atrasar ~${ceil5(minutes)} min`,
        body: 'O cliente já foi avisado pelo WhatsApp da loja.',
      });
    } else {
      await emitAdminTx(tx, tenantId, 'store');
      pushes.push({
        key: `late:${o.id}`,
        title: `#${o.number} vai atrasar ~${ceil5(minutes)} min`,
        body: 'Toque para avisar o cliente antes que ele pergunte.',
      });
    }
  }
  return pushes;
}

/** "avisar o cliente": the delay, its message, and the apology coupon the budget allows. */
export async function sendLateNoticeTx(
  tx: Sql,
  tenantId: string,
  actor: Pick<Merchant, 'name'> & { userId: string | null },
  orderId: string,
): Promise<{ notified: boolean; coupon: string | null }> {
  const [n] = await tx<{ predicted: number; state: string }[]>`
    select predicted_minutes as predicted, state from order_late_notices
    where tenant_id = ${tenantId} and order_id = ${orderId} for update`;
  if (!n) throw new HttpError(404, 'NOT_FOUND', 'no late notice for this order');
  if (n.state !== 'suggested')
    throw new HttpError(409, 'ALREADY_DECIDED', 'this notice was already sent or dismissed');
  const [o] = await tx<
    {
      number: number;
      state: string;
      delivery: OrderView['delivery'];
      phone: string | null;
      fee: number;
    }[]
  >`
    select number, state, delivery, customer_phone as phone, delivery_fee_cents as fee
    from orders where tenant_id = ${tenantId} and id = ${orderId} for update`;
  if (!o || !['confirmed', 'preparing', 'ready', 'out_for_delivery'].includes(o.state)) {
    await tx`update order_late_notices set state = 'dismissed', decided_at = now()
             where order_id = ${orderId}`;
    throw new HttpError(409, 'ORDER_NOT_DELAYABLE', 'the order is no longer open');
  }
  const apology = await mintApologyTx(tx, tenantId, o.phone, o.fee);
  const { notified } = await delayOrderTx(
    tx,
    tenantId,
    actor,
    orderId,
    { number: o.number, delivery: o.delivery },
    Math.min(120, ceil5(n.predicted)),
    apology ? { code: apology.code, words: apology.words } : null,
  );
  await tx`
    update order_late_notices set state = 'sent', decided_at = now(),
      coupon_id = ${apology?.id ?? null}, coupon_cents = ${apology?.cents ?? 0}
    where order_id = ${orderId}`;
  return { notified, coupon: apology?.code ?? null };
}

export async function dismissLateNoticeTx(tx: Sql, tenantId: string, orderId: string) {
  const r = await tx`
    update order_late_notices set state = 'dismissed', decided_at = now()
    where tenant_id = ${tenantId} and order_id = ${orderId} and state = 'suggested'
    returning order_id`;
  if (!r.length) throw new HttpError(404, 'NOT_FOUND', 'no open late notice for this order');
}

/**
 * The apology, when the owner set a budget and there's room this month: personal to the order's
 * phone, single use, 30 days. None for a phone that got one in the last two weeks, none without a
 * phone, none worth nothing. Counted by face value at mint, under the store's lock.
 */
async function mintApologyTx(
  tx: Sql,
  tenantId: string,
  phone: string | null,
  deliveryFee: number,
): Promise<{ id: string; code: string; words: string; cents: number } | null> {
  if (!phone || !/^\d{10,11}$/.test(phone)) return null;
  const [s] = await tx<
    { kind: 'free_delivery' | 'fixed'; value: number; budget: number }[]
  >`select apology_kind as kind, apology_value_cents as value, apology_budget_cents as budget
    from store_settings where tenant_id = ${tenantId}`;
  if (!s || s.budget <= 0) return null;
  const cents = s.kind === 'fixed' ? s.value : deliveryFee;
  if (cents <= 0) return null;
  await tx`select pg_advisory_xact_lock(hashtext(${'apology:' + tenantId}))`;
  const [spent] = await tx<{ cents: number }[]>`
    select coalesce(sum(coupon_cents), 0)::int as cents from order_late_notices
    where tenant_id = ${tenantId}
      and created_at >= (date_trunc('month', now() at time zone 'America/Sao_Paulo')
                         at time zone 'America/Sao_Paulo')`;
  if ((spent?.cents ?? 0) + cents > s.budget) return null;
  const [recent] = await tx`
    select 1 from coupons where tenant_id = ${tenantId} and source = 'apology' and phone = ${phone}
      and created_at > now() - make_interval(days => ${APOLOGY_EVERY_DAYS}) limit 1`;
  if (recent) return null;
  const c = await mintCouponTx(
    tx,
    tenantId,
    {
      prefix: 'DESCULPA',
      kind: s.kind === 'fixed' ? 'fixed' : 'free_delivery',
      value: s.kind === 'fixed' ? s.value : 0,
      label: 'Desculpe a demora',
      phone,
      maxRedemptions: 1,
      perPhoneLimit: 1,
      validDays: APOLOGY_VALID_DAYS,
    },
    'apology',
  );
  return {
    id: c.id,
    code: c.code,
    words: s.kind === 'fixed' ? `${brl(s.value)} de desconto` : 'entrega grátis',
    cents,
  };
}
