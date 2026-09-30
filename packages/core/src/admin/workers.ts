import { withTenant, type Sql } from '../platform/db.ts';
import { log } from '../platform/log.ts';
import { setStock } from '../modules/stock.ts';
import type { MerchantNotify } from './context.ts';
import { emitAdminTx, type AdminHub } from './live.ts';
import { sendPushResult, vapidPublicKey, type PushResult } from './webpush.ts';

const workLog = log.child({ mod: 'admin-workers' });

/** WhatsApp fallback looks this far back — push_deliveries (its dedupe) lives two days */
const FALLBACK_WINDOW = '12 hours';

export interface AlertOpts {
  notify?: MerchantNotify | undefined;
  /** `https://<admin host>` for links in messages; null = no link */
  adminOrigin?: string | null | undefined;
}

type Sub = { id: string; user_id: string; endpoint: string; p256dh: string; auth: string };

const brl = (cents: number) =>
  (cents / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

/** Every alert attempt, per device or person — how a merchant sees a ring that didn't arrive. */
export async function recordPushAttempt(
  tx: Sql,
  tenantId: string,
  a: {
    subscriptionId: string | null;
    userId: string | null;
    event: string;
    ref: string | null;
    channel: 'push' | 'whatsapp';
  } & PushResult,
) {
  await tx`
    insert into push_attempts (tenant_id, subscription_id, user_id, event, ref, channel, result, detail)
    values (${tenantId}, ${a.subscriptionId}, ${a.userId}, ${a.event.slice(0, 40)}, ${a.ref?.slice(0, 120) ?? null},
            ${a.channel}, ${a.result}, ${a.detail?.slice(0, 200) ?? null})
  `;
}

/** New order / online payment → web push to the store's devices. One replica wins each
 *  event (push_deliveries), so a scaled Core never double-rings a phone. */
export async function startPushNotifier(sql: Sql, hub: AdminHub): Promise<() => void> {
  return hub.onAny((tenantId, e) => {
    if (!e.id || !vapidPublicKey()) return;
    if (e.topic === 'order.placed')
      void pushOrder(sql, tenantId, e.id).catch((err) =>
        workLog.warn({ err }, 'order push failed'),
      );
    else if (e.topic === 'payment.received')
      void pushPayment(sql, tenantId, e.id).catch((err) =>
        workLog.warn({ err }, 'payment push failed'),
      );
  });
}

async function fanOut(
  sql: Sql,
  tenantId: string,
  subs: Sub[],
  message: object,
  event: string,
  ref: string,
) {
  if (!subs.length) return;
  const results = await Promise.all(
    subs.map((s) =>
      sendPushResult(s, message).catch((): PushResult => ({
        result: 'error',
        detail: 'delivery failed',
      })),
    ),
  );
  await withTenant(sql, tenantId, async (tx) => {
    for (const [i, s] of subs.entries()) {
      const r = results[i]!;
      await recordPushAttempt(tx, tenantId, {
        subscriptionId: r.result === 'gone' ? null : s.id,
        userId: s.user_id,
        event,
        ref,
        channel: 'push',
        ...r,
      });
      if (r.result === 'gone') await tx`delete from push_subscriptions where id = ${s.id}`;
      else if (r.result === 'ok')
        await tx`update push_subscriptions set last_ok_at = now(), last_error = null where id = ${s.id}`;
      else
        await tx`update push_subscriptions set last_error = ${r.detail ?? 'delivery failed'} where id = ${s.id}`;
    }
    await emitAdminTx(tx, tenantId, 'alerts');
  });
}

export async function pushOrder(sql: Sql, tenantId: string, orderId: string) {
  const job = await withTenant(sql, tenantId, async (tx) => {
    const won = await tx`
      insert into push_deliveries (tenant_id, key) values (${tenantId}, ${`order.placed:${orderId}`})
      on conflict do nothing returning key
    `;
    if (!won[0]) return null;
    const order = (
      await tx<{ number: number; name: string; total: number; mode: string }[]>`
        select number, customer ->> 'name' as name, total_cents as total, delivery ->> 'mode' as mode
        from orders where tenant_id = ${tenantId} and id = ${orderId}
      `
    )[0];
    const subs = await tx<Sub[]>`
      select s.id, s.user_id, s.endpoint, s.p256dh, s.auth from push_subscriptions s
        join merchant_users u on u.id = s.user_id
      where s.tenant_id = ${tenantId} and u.status = 'active' and coalesce((u.prefs ->> 'push')::boolean, true)
    `;
    return order ? { order, subs } : null;
  });
  if (!job) return;
  const { order, subs } = job;
  await fanOut(
    sql,
    tenantId,
    subs,
    {
      title: `Pedido #${order.number} chegou`,
      body: `${order.name.split(' ')[0]} · ${brl(order.total)} · ${order.mode === 'delivery' ? 'entrega' : 'retirada'}`,
      tag: `order-${orderId}`,
      url: `/admin/pedidos/${orderId}`,
      orderId,
      actions: [{ action: 'accept', title: 'aceitar' }],
    },
    'order.placed',
    orderId,
  );
}

export async function pushPayment(sql: Sql, tenantId: string, orderId: string) {
  const job = await withTenant(sql, tenantId, async (tx) => {
    const won = await tx`
      insert into push_deliveries (tenant_id, key) values (${tenantId}, ${`payment.received:${orderId}`})
      on conflict do nothing returning key
    `;
    if (!won[0]) return null;
    const order = (
      await tx<{ number: number; cents: number; method: string | null }[]>`
        select o.number, o.payment ->> 'method' as method,
               coalesce((select p.amount_cents from payments p
                          where p.tenant_id = o.tenant_id and p.order_id = o.id and p.status = 'approved'
                          order by p.approved_at desc nulls last limit 1), o.total_cents) as cents
        from orders o where o.tenant_id = ${tenantId} and o.id = ${orderId}
      `
    )[0];
    const subs = await tx<Sub[]>`
      select s.id, s.user_id, s.endpoint, s.p256dh, s.auth from push_subscriptions s
        join merchant_users u on u.id = s.user_id
      where s.tenant_id = ${tenantId} and u.status = 'active'
        and coalesce((u.prefs ->> 'push')::boolean, true)
        and coalesce((u.prefs ->> 'pushPayments')::boolean, true)
    `;
    return order ? { order, subs } : null;
  });
  if (!job) return;
  const { order, subs } = job;
  await fanOut(
    sql,
    tenantId,
    subs,
    {
      title: 'Pagamento recebido',
      body: `${brl(order.cents)} · pedido #${order.number}${order.method === 'pix' ? ' · Pix' : order.method === 'card_online' ? ' · cartão' : ''}`,
      tag: `payment-${orderId}`,
      url: `/admin/pedidos/${orderId}`,
      orderId,
    },
    'payment.received',
    orderId,
  );
}

/** An order still waiting past the accept target whose push reached no device → WhatsApp
 *  to the owners and managers, once per order. */
async function whatsappFallback(sql: Sql, tenantId: string, opts: AlertOpts) {
  const notify = opts.notify;
  if (!notify) return;
  const jobs = await withTenant(sql, tenantId, async (tx) => {
    const due = await tx<{ id: string; number: number; mins: number; store: string }[]>`
      select o.id, o.number, t.name as store,
             floor(extract(epoch from now() - o.placed_at) / 60)::int as mins
      from orders o join tenants t on t.id = o.tenant_id
        left join store_settings s on s.tenant_id = o.tenant_id
      where o.tenant_id = ${tenantId} and o.state = 'placed'
        and o.placed_at > now() - ${FALLBACK_WINDOW}::interval
        and o.placed_at < now() - make_interval(mins => coalesce(s.accept_target_minutes, 5))
        and not exists (
          select 1 from push_attempts a
          where a.tenant_id = o.tenant_id and a.event = 'order.placed' and a.ref = o.id::text
            and a.channel = 'push' and a.result = 'ok'
        )
        and not exists (
          select 1 from push_deliveries d
          where d.tenant_id = o.tenant_id and d.key = 'order.whatsapp:' || o.id::text
        )
      order by o.placed_at limit 20
    `;
    if (!due.length) return [];
    const people = await tx<{ id: string; phone: string }[]>`
      select id, phone from merchant_users
      where tenant_id = ${tenantId} and status = 'active' and role in ('owner', 'manager')
        and coalesce((prefs ->> 'whatsappAlerts')::boolean, true)
    `;
    const out: { order: (typeof due)[number]; people: typeof people }[] = [];
    for (const o of due) {
      const won = await tx`
        insert into push_deliveries (tenant_id, key) values (${tenantId}, ${`order.whatsapp:${o.id}`})
        on conflict do nothing returning key
      `;
      if (won[0]) out.push({ order: o, people });
    }
    return out;
  });
  for (const { order, people } of jobs) {
    const link = opts.adminOrigin
      ? `Aceite em ${opts.adminOrigin}/admin/pedidos/${order.id}`
      : 'Abra o painel da Venduá para aceitar.';
    const text = `Venduá: o pedido #${order.number} da ${order.store} está esperando há ${order.mins} min e o aviso não chegou em nenhum aparelho. ${link}`;
    const results: { userId: string; r: PushResult }[] = [];
    for (const p of people) {
      try {
        await notify.whatsapp(p.phone, text);
        results.push({ userId: p.id, r: { result: 'ok', detail: null } });
      } catch (err) {
        results.push({
          userId: p.id,
          r: { result: 'error', detail: String((err as Error).message ?? err).slice(0, 200) },
        });
      }
    }
    await withTenant(sql, tenantId, async (tx) => {
      for (const { userId, r } of results)
        await recordPushAttempt(tx, tenantId, {
          subscriptionId: null,
          userId,
          event: 'order.whatsapp',
          ref: order.id,
          channel: 'whatsapp',
          ...r,
        });
      if (!results.length)
        await recordPushAttempt(tx, tenantId, {
          subscriptionId: null,
          userId: null,
          event: 'order.whatsapp',
          ref: order.id,
          channel: 'whatsapp',
          result: 'error',
          detail: 'nobody opted in to WhatsApp alerts',
        });
      await emitAdminTx(tx, tenantId, 'alerts');
    });
  }
}

/** Once a minute: "esgotado hoje" ends at midnight, a timed pause clears its row,
 *  a missed new-order alert falls back to WhatsApp. */
export async function sweepAdmin(sql: Sql, opts: AlertOpts = {}) {
  const tenants = await sql<{ id: string }[]>`select id from tenants where status = 'active'`;
  for (const t of tenants) {
    // one store's bad row must not stall the sweep for every store after it
    try {
      await sweepTenant(sql, t.id);
    } catch (err) {
      workLog.warn({ err, tenantId: t.id }, 'admin sweep failed for tenant');
    }
    await whatsappFallback(sql, t.id, opts).catch((err) =>
      workLog.warn({ err, tenantId: t.id }, 'whatsapp alert fallback failed'),
    );
  }
}

async function sweepTenant(sql: Sql, tenantId: string) {
  await withTenant(sql, tenantId, async (tx) => {
    const due = await tx<{ id: string }[]>`
      select id from products where tenant_id = ${tenantId} and sold_out_until is not null and sold_out_until <= now()
    `;
    for (const p of due) {
      await setStock(tx, tenantId, p.id, { status: 'active' });
      await tx`update products set sold_out_until = null where id = ${p.id}`;
    }
    // a store waiting for its first plan payment stays paused whatever the timer said
    const resumed = await tx`
      update store_settings set status_override = null, resumes_at = null
      where tenant_id = ${tenantId} and status_override is not null and resumes_at is not null
        and resumes_at <= now() and not billing_hold
      returning tenant_id
    `;
    if (due.length) await emitAdminTx(tx, tenantId, 'catalog');
    if (resumed.length) await emitAdminTx(tx, tenantId, 'store');
    await tx`delete from push_deliveries where tenant_id = ${tenantId} and created_at < now() - interval '2 days'`;
    await tx`delete from push_attempts where tenant_id = ${tenantId} and at < now() - interval '30 days'`;
  });
}

export function startAdminSweeper(sql: Sql, opts: AlertOpts = {}): () => void {
  let running = false;
  const timer = setInterval(() => {
    // a slow pass holds a pool connection — never stack a second one behind it
    if (running) return;
    running = true;
    void sweepAdmin(sql, opts)
      .catch((err) => workLog.warn({ err }, 'admin sweep failed'))
      .finally(() => {
        running = false;
      });
  }, 60_000);
  return () => clearInterval(timer);
}
