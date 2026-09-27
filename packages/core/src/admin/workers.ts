import { withTenant, type Sql } from '../platform/db.ts';
import { log } from '../platform/log.ts';
import { setStock } from '../modules/stock.ts';
import { emitAdminTx, type AdminHub } from './live.ts';
import { sendPush, vapidPublicKey } from './webpush.ts';

const workLog = log.child({ mod: 'admin-workers' });

/** New order → web push to every subscribed device of the store. One replica wins
 *  each order (push_deliveries), so a scaled Core never double-rings a phone. */
export async function startPushNotifier(sql: Sql, hub: AdminHub): Promise<() => void> {
  return hub.onAny((tenantId, e) => {
    if (e.topic !== 'order.placed' || !e.id || !vapidPublicKey()) return;
    void pushOrder(sql, tenantId, e.id).catch((err) => workLog.warn({ err }, 'order push failed'));
  });
}

async function pushOrder(sql: Sql, tenantId: string, orderId: string) {
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
    const subs = await tx<{ id: string; endpoint: string; p256dh: string; auth: string }[]>`
      select s.id, s.endpoint, s.p256dh, s.auth from push_subscriptions s
        join merchant_users u on u.id = s.user_id
      where s.tenant_id = ${tenantId} and u.status = 'active' and coalesce((u.prefs ->> 'push')::boolean, true)
    `;
    return order ? { order, subs } : null;
  });
  if (!job) return;
  const { order, subs } = job;
  const total = (order.total / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  const message = {
    title: `Pedido #${order.number} chegou`,
    body: `${order.name.split(' ')[0]} · ${total} · ${order.mode === 'delivery' ? 'entrega' : 'retirada'}`,
    tag: `order-${orderId}`,
    url: `/admin/pedidos/${orderId}`,
    orderId,
    actions: [{ action: 'accept', title: 'aceitar' }],
  };
  for (const s of subs) {
    const r = await sendPush(s, message).catch(() => 'error' as const);
    await withTenant(sql, tenantId, (tx) =>
      r === 'gone'
        ? tx`delete from push_subscriptions where id = ${s.id}`
        : r === 'ok'
          ? tx`update push_subscriptions set last_ok_at = now(), last_error = null where id = ${s.id}`
          : tx`update push_subscriptions set last_error = 'delivery failed' where id = ${s.id}`,
    );
  }
}

/** Once a minute: "esgotado hoje" ends at midnight, a timed pause clears its row. */
export async function sweepAdmin(sql: Sql) {
  const tenants = await sql<{ id: string }[]>`select id from tenants where status = 'active'`;
  for (const t of tenants) {
    await withTenant(sql, t.id, async (tx) => {
      const due = await tx<{ id: string }[]>`
        select id from products where tenant_id = ${t.id} and sold_out_until is not null and sold_out_until <= now()
      `;
      for (const p of due) {
        await setStock(tx, t.id, p.id, { status: 'active' });
        await tx`update products set sold_out_until = null where id = ${p.id}`;
      }
      const resumed = await tx`
        update store_settings set status_override = null, resumes_at = null
        where tenant_id = ${t.id} and status_override is not null and resumes_at is not null and resumes_at <= now()
        returning tenant_id
      `;
      if (due.length) await emitAdminTx(tx, t.id, 'catalog');
      if (resumed.length) await emitAdminTx(tx, t.id, 'store');
      await tx`delete from push_deliveries where tenant_id = ${t.id} and created_at < now() - interval '2 days'`;
    });
  }
}

export function startAdminSweeper(sql: Sql): () => void {
  const timer = setInterval(() => {
    void sweepAdmin(sql).catch((err) => workLog.warn({ err }, 'admin sweep failed'));
  }, 60_000);
  return () => clearInterval(timer);
}
