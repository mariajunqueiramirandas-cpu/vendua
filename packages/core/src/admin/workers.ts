import { withTenant, type Sql } from '../platform/db.ts';
import { log } from '../platform/log.ts';
import { cartReminderPass } from '../modules/cart-reminder.ts';
import { setStock } from '../modules/stock.ts';
import { wakeStoreWaitlist } from '../modules/storefront-platform.ts';
import { maskPhone } from '../vendedor/threads.ts';
import type { MerchantNotify } from './context.ts';
import { emitAdminTx, type AdminHub } from './live.ts';
import { DEMAND_DEFAULT_MINUTES } from './routes-store.ts';
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
    else if (e.topic === 'vendedor.waiting')
      void pushWaiting(sql, tenantId, e.id).catch((err) =>
        workLog.warn({ err }, 'vendedor push failed'),
      );
    else if (e.topic === 'vendedor.ask')
      void pushAsk(sql, tenantId, e.id).catch((err) =>
        workLog.warn({ err }, 'vendedor ask push failed'),
      );
    else if (e.topic === 'vendedor.exhausted')
      void pushExhausted(sql, tenantId, e.id).catch((err) =>
        workLog.warn({ err }, 'vendedor exhausted push failed'),
      );
    else if (e.topic === 'whatsapp' && (e.id === 'logged_out' || e.id === 'banned'))
      void pushWhatsappLost(sql, tenantId).catch((err) =>
        workLog.warn({ err }, 'whatsapp push failed'),
      );
  });
}

/** The store's own WhatsApp stopped for good (unlinked on the phone, or refused): its shoppers
 *  stopped getting order updates, so the owner and managers hear it once per drop. */
export async function pushWhatsappLost(sql: Sql, tenantId: string) {
  const job = await withTenant(sql, tenantId, async (tx) => {
    const wa = (
      await tx<{ state: string; at: Date }[]>`
        select state, state_changed_at as at from store_whatsapp
        where tenant_id = ${tenantId} and wanted and state in ('logged_out', 'banned')`
    )[0];
    if (!wa) return null;
    const won = await tx`
      insert into push_deliveries (tenant_id, key)
      values (${tenantId}, ${`whatsapp.lost:${wa.at.toISOString()}`})
      on conflict do nothing returning key
    `;
    if (!won[0]) return null;
    const subs = await tx<Sub[]>`
      select s.id, s.user_id, s.endpoint, s.p256dh, s.auth from push_subscriptions s
        join merchant_users u on u.id = s.user_id
      where s.tenant_id = ${tenantId} and u.status = 'active' and u.role in ('owner', 'manager')
        and coalesce((u.prefs ->> 'push')::boolean, true)
    `;
    return { state: wa.state, subs };
  });
  if (!job) return;
  await fanOut(
    sql,
    tenantId,
    job.subs,
    {
      title: 'WhatsApp da loja desconectado',
      body:
        job.state === 'banned'
          ? 'O WhatsApp recusou o número da loja. Toque para ver o que fazer.'
          : 'Seus clientes pararam de receber os avisos de pedido. Toque para conectar de novo.',
      tag: 'whatsapp-lost',
      url: '/admin/whatsapp',
    },
    'whatsapp.lost',
    job.state,
  );
}

/** Duá ran out of conversations (ADR 0032): the shoppers go to the store's inbox, so the owner
 *  and managers hear it. push_deliveries dedupes it, so a store that stays out hears it again
 *  once that row is swept (two days), not on every shopper. */
export async function pushExhausted(sql: Sql, tenantId: string, period: string) {
  const job = await withTenant(sql, tenantId, async (tx) => {
    const won = await tx`
      insert into push_deliveries (tenant_id, key)
      values (${tenantId}, ${`vendedor.exhausted:${period}`})
      on conflict do nothing returning key
    `;
    if (!won[0]) return null;
    return tx<Sub[]>`
      select s.id, s.user_id, s.endpoint, s.p256dh, s.auth from push_subscriptions s
        join merchant_users u on u.id = s.user_id
      where s.tenant_id = ${tenantId} and u.status = 'active' and u.role in ('owner', 'manager')
        and coalesce((u.prefs ->> 'push')::boolean, true)
    `;
  });
  if (!job) return;
  const resets = period === 'trial' ? null : new Date(period);
  await fanOut(
    sql,
    tenantId,
    job,
    {
      title: 'O Duá ficou sem conversas',
      body: resets
        ? `Os clientes novos vão para você até ${resets.toLocaleDateString('pt-BR', { day: 'numeric', month: 'short', timeZone: 'America/Sao_Paulo' })}. Para o Duá voltar antes, compre mais conversas.`
        : 'As conversas do teste grátis acabaram. Os clientes novos vão para você.',
      tag: 'vendedor-exhausted',
      url: '/admin/conta#vendedor',
    },
    'vendedor.exhausted',
    period,
  );
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

/** A shopper waiting for the store in a Vendedor conversation (ADR 0031, law 13): one push per
 *  conversation per handoff, and again at each re-ping minute (`ping`); "assumir" opens it on
 *  the store's floor. Each person can turn these off apart from the other alerts (`pushWaiting`). */
export async function pushWaiting(sql: Sql, tenantId: string, threadId: string, ping = 0) {
  const job = await withTenant(sql, tenantId, async (tx) => {
    const t = (
      await tx<
        { since: Date; reason: string | null; name: string | null; preview: string | null }[]
      >`
        select t.waiting_since as since, t.owner_reason as reason,
          coalesce(t.checkout ->> 'name', split_part(t.profile_name, ' ', 1)) as name,
          (select coalesce(m.transcript, m.body) from shopper_messages m where m.thread_id = t.id
             and m.author = 'shopper' order by m.created_at desc limit 1) as preview
        from shopper_threads t
        where t.tenant_id = ${tenantId} and t.id = ${threadId} and t.waiting_since is not null
          and t.channel = 'whatsapp'`
    )[0];
    if (!t) return null;
    const won = await tx`
      insert into push_deliveries (tenant_id, key)
      values (${tenantId}, ${`vendedor.waiting:${threadId}:${t.since.toISOString()}${ping ? `:${ping}` : ''}`})
      on conflict do nothing returning key
    `;
    if (!won[0]) return null;
    const subs = await tx<Sub[]>`
      select s.id, s.user_id, s.endpoint, s.p256dh, s.auth from push_subscriptions s
        join merchant_users u on u.id = s.user_id
      where s.tenant_id = ${tenantId} and u.status = 'active' and coalesce((u.prefs ->> 'push')::boolean, true)
        and coalesce((u.prefs ->> 'pushWaiting')::boolean, true)
    `;
    return { t, subs };
  });
  if (!job) return;
  const { t, subs } = job;
  const minutes = Math.max(1, Math.round((Date.now() - t.since.getTime()) / 60_000));
  await fanOut(
    sql,
    tenantId,
    subs,
    {
      title: `${t.name || 'Um cliente'} precisa de você${t.reason ? ` · ${t.reason}` : ''}`,
      body: `${t.preview ? `“${t.preview.slice(0, 80)}” · ` : ''}esperando há ${minutes} min`,
      tag: `vendedor-${threadId}`,
      url: `/admin/vendedor/conversas/${threadId}`,
      threadId,
      actions: [{ action: 'take', title: 'assumir' }],
    },
    'vendedor.waiting',
    threadId,
  );
}

/** Minutes after a handoff at which a still-waiting shopper pings again; then it stops. */
export const WAITING_REPINGS = [5, 15] as const;

/** Nobody answered the shopper yet: "precisa de você" again at 5 and 15 min, and a WhatsApp to
 *  the owner and managers once per handoff if no ping reached a device (as orders do). An answer,
 *  or Duá taking back, clears waiting_since and ends both. */
export async function vendedorWaitingAlerts(sql: Sql, tenantId: string, opts: AlertOpts = {}) {
  const due = await withTenant(
    sql,
    tenantId,
    (tx) => tx<{ id: string; since: Date; mins: number; store: string }[]>`
      select t.id, t.waiting_since as since, s.name as store,
        floor(extract(epoch from now() - t.waiting_since) / 60)::int as mins
      from shopper_threads t join tenants s on s.id = t.tenant_id
      where t.tenant_id = ${tenantId} and t.waiting_since is not null and t.channel = 'whatsapp'
        and t.owner <> 'muted' and t.class not in ('personal', 'other')
        and t.waiting_since <= now() - make_interval(mins => ${WAITING_REPINGS[0]})
        and t.waiting_since > now() - interval '1 hour'
      order by t.waiting_since limit 20`,
  );
  for (const t of due) {
    const ping = [...WAITING_REPINGS].reverse().find((m) => t.mins >= m)!;
    if (vapidPublicKey()) await pushWaiting(sql, tenantId, t.id, ping);
    await waitingWhatsapp(sql, tenantId, t, opts);
  }
}

async function waitingWhatsapp(
  sql: Sql,
  tenantId: string,
  t: { id: string; since: Date; mins: number; store: string },
  opts: AlertOpts,
) {
  const notify = opts.notify;
  if (!notify) return;
  const people = await withTenant(sql, tenantId, async (tx) => {
    const reached = await tx`
      select 1 from push_attempts where tenant_id = ${tenantId} and event = 'vendedor.waiting'
        and ref = ${t.id} and channel = 'push' and result = 'ok' and at >= ${t.since} limit 1`;
    if (reached.length) return null;
    const won = await tx`
      insert into push_deliveries (tenant_id, key)
      values (${tenantId}, ${`vendedor.whatsapp:${t.id}:${t.since.toISOString()}`})
      on conflict do nothing returning key`;
    if (!won[0]) return null;
    return tx<{ id: string; phone: string }[]>`
      select id, phone from merchant_users
      where tenant_id = ${tenantId} and status = 'active' and role in ('owner', 'manager')
        and coalesce((prefs ->> 'whatsappAlerts')::boolean, true)
        and coalesce((prefs ->> 'pushWaiting')::boolean, true)`;
  });
  if (!people) return;
  // the store's own shopper stays out of a message sent from the platform's number
  const link = opts.adminOrigin
    ? `Responda em ${opts.adminOrigin}/admin/vendedor/conversas/${t.id}`
    : 'Abra o painel da Venduá para responder.';
  const text = `Venduá: um cliente está esperando por você numa conversa do Duá da ${t.store} há ${t.mins} min, e o aviso não chegou em nenhum aparelho. ${link}`;
  const results: { userId: string | null; r: PushResult }[] = [];
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
  if (!results.length)
    results.push({
      userId: null,
      r: { result: 'error', detail: 'nobody opted in to WhatsApp alerts' },
    });
  await withTenant(sql, tenantId, async (tx) => {
    for (const { userId, r } of results)
      await recordPushAttempt(tx, tenantId, {
        subscriptionId: null,
        userId,
        event: 'vendedor.whatsapp',
        ref: t.id,
        channel: 'whatsapp',
        ...r,
      });
    await emitAdminTx(tx, tenantId, 'alerts');
  });
}

/** A new number Duá can't tell is a customer (ADR 0033): "é cliente?", once per thread per
 *  `asked_at` (the ingest and the triage set it at most once a day). Never for personal ones. */
export async function pushAsk(sql: Sql, tenantId: string, threadId: string) {
  const job = await withTenant(sql, tenantId, async (tx) => {
    const t = (
      await tx<{ asked: Date; name: string | null; phone: string | null }[]>`
        select asked_at as asked, profile_name as name, phone from shopper_threads
        where tenant_id = ${tenantId} and id = ${threadId} and class = 'ask'
          and asked_at is not null and channel = 'whatsapp' and owner <> 'muted'`
    )[0];
    if (!t) return null;
    const won = await tx`
      insert into push_deliveries (tenant_id, key)
      values (${tenantId}, ${`vendedor.ask:${threadId}:${t.asked.toISOString()}`})
      on conflict do nothing returning key
    `;
    if (!won[0]) return null;
    const subs = await tx<Sub[]>`
      select s.id, s.user_id, s.endpoint, s.p256dh, s.auth from push_subscriptions s
        join merchant_users u on u.id = s.user_id
      where s.tenant_id = ${tenantId} and u.status = 'active' and coalesce((u.prefs ->> 'push')::boolean, true)
    `;
    return { t, subs };
  });
  if (!job) return;
  const who = job.t.name?.trim() || maskPhone(job.t.phone) || 'Um contato';
  await fanOut(
    sql,
    tenantId,
    job.subs,
    {
      title: 'Novo contato no WhatsApp',
      body: `${who} — é cliente?`,
      tag: `vendedor-ask-${threadId}`,
      url: `/admin/vendedor/conversas/${threadId}`,
      threadId,
      // the decision is made in the conversation; "assumir" (the default for a thread) isn't it
      actions: [{ action: 'open', title: 'abrir' }],
    },
    'vendedor.ask',
    threadId,
  );
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

/** Once a minute: "esgotado hoje" ends at midnight, a timed pause clears its row, "muitos
 *  pedidos agora" ends, a missed new-order alert falls back to WhatsApp; hourly, retention. */
export async function sweepAdmin(sql: Sql, opts: AlertOpts = {}) {
  const tenants = await sql<{ id: string }[]>`select id from tenants where status = 'active'`;
  const prune = Date.now() >= nextPruneAt;
  if (prune) nextPruneAt = Date.now() + PRUNE_EVERY_MS;
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
    await vendedorWaitingAlerts(sql, t.id, opts).catch((err) =>
      workLog.warn({ err, tenantId: t.id }, 'vendedor waiting re-ping failed'),
    );
    // "avise-me quando abrir": the store opened (hours or a resume) — its subscribers, once
    await withTenant(sql, t.id, (tx) => wakeStoreWaitlist(tx, t.id)).catch((err) =>
      workLog.warn({ err, tenantId: t.id }, 'store waitlist wake failed'),
    );
    // the bag reminder a shopper asked for at checkout, an hour after they stopped
    await cartReminderPass(sql, t.id).catch((err) =>
      workLog.warn({ err, tenantId: t.id }, 'bag reminder pass failed'),
    );
    if (prune)
      await pruneTenant(sql, t.id).catch((err) =>
        workLog.warn({ err, tenantId: t.id }, 'retention prune failed'),
      );
  }
}

const PRUNE_EVERY_MS = 60 * 60_000;
const PRUNE_BATCH = 1000;
let nextPruneAt = 0;

/** Retention: funnel events past 13 months (web analytics' horizon), and carts that never held a
 *  line after 14 quiet days — every storefront session mints one. A cart an order, a Vendedor
 *  thread or a reminder points at stays. Batched: a backlog drains over a few passes. */
export async function pruneTenant(sql: Sql, tenantId: string) {
  await withTenant(sql, tenantId, async (tx) => {
    await tx`
      delete from analytics_events where id in (
        select id from analytics_events
        where tenant_id = ${tenantId} and at < now() - interval '13 months'
        limit ${PRUNE_BATCH}
      )
    `;
    await tx`
      delete from carts where id in (
        select c.id from carts c
        where c.tenant_id = ${tenantId} and c.status = 'open'
          and c.updated_at < now() - interval '14 days'
          and not exists (select 1 from cart_items i where i.cart_id = c.id)
          and not exists (select 1 from orders o where o.cart_id = c.id)
          and not exists (select 1 from shopper_threads t where t.cart_id = c.id)
          and not exists (select 1 from cart_reminders r where r.cart_id = c.id)
        limit ${PRUNE_BATCH}
      )
      -- re-read on the row itself: a line added while this waited touched updated_at
      and updated_at < now() - interval '14 days'
    `;
  });
}

async function sweepTenant(sql: Sql, tenantId: string) {
  await withTenant(sql, tenantId, async (tx) => {
    const due = await tx<{ id: string; status: string }[]>`
      select id, status from products where tenant_id = ${tenantId} and sold_out_until is not null and sold_out_until <= now()
    `;
    for (const p of due) {
      // only "esgotado hoje" comes back: an archived/hidden product with a stale timer stays put
      if (p.status === 'sold_out') await setStock(tx, tenantId, p.id, { status: 'active' });
      await tx`update products set sold_out_until = null where id = ${p.id}`;
    }
    // a store waiting for its first plan payment stays paused whatever the timer said
    const resumed = await tx`
      update store_settings set status_override = null, resumes_at = null
      where tenant_id = ${tenantId} and status_override is not null and resumes_at is not null
        and resumes_at <= now() and not billing_hold
      returning tenant_id
    `;
    // "muitos pedidos agora" always ends; one turned on with no end (the CRM) gets the default,
    // and an end left on a store back to normal goes, so turning it on again can't end at once
    const demand = await tx`
      update store_settings set
        demand_level = case when demand_level = 'high' and demand_until is null then 'high' else 'normal' end,
        demand_until = case when demand_level = 'high' and demand_until is null
                            then now() + make_interval(mins => ${DEMAND_DEFAULT_MINUTES}) end
      where tenant_id = ${tenantId} and (
        (demand_level = 'high' and (demand_until is null or demand_until <= now()))
        or (demand_level = 'normal' and demand_until is not null))
      returning tenant_id
    `;
    if (due.length) await emitAdminTx(tx, tenantId, 'catalog');
    if (resumed.length || demand.length) await emitAdminTx(tx, tenantId, 'store');
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
