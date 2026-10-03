import { dispatchTx } from '../agent-host/dispatch.ts';
import { recordStaffEventTx } from '../modules/staff-events.ts';
import { controlTx } from '../modules/control.ts';
import { withTenant, type Sql } from '../platform/db.ts';
import { log } from '../platform/log.ts';
import type { MediaProviders } from './media.ts';
import { loadAgent } from './settings.ts';
import { AGENT_ID, SUBJECT_KIND, loadStoreSettings, storeStatus } from './threads.ts';

// Proactive touches inside the transport's limits (sales-agent.md §4.13), each a timer row the
// one producer writes once its conditions hold *now*: recovery of a stopped sacola, an expired
// Pix, an item back in stock, and order updates for the thread's own transcript.

const actorOf = (tenantId: string, threadId: string) => ({
  tenantId,
  agentId: AGENT_ID,
  subject: { kind: SUBJECT_KIND, id: threadId },
});

async function enabledStores(sql: Sql): Promise<string[]> {
  const rows = await controlTx(
    sql,
    (tx) => tx<{ tenant_id: string }[]>`select tenant_id from store_agent where enabled`,
  );
  return rows.map((r) => r.tenant_id);
}

/** One nudge per thread per day: the shopper wrote in the last 24 h, the store is open. */
export async function recoveryPass(sql: Sql, tenantId: string, now = new Date()): Promise<number> {
  return withTenant(sql, tenantId, async (tx) => {
    const agent = await loadAgent(tx, tenantId);
    if (
      !agent.enabled ||
      !agent.settings.recovery.enabled ||
      agent.settings.coverage === 'rehearsal'
    )
      return 0;
    if (storeStatus(await loadStoreSettings(tx, tenantId), now).status !== 'open') return 0;
    const due = await tx<{ id: string }[]>`
      select t.id from shopper_threads t
      join carts c on c.id = t.cart_id and c.status = 'open'
      where t.tenant_id = ${tenantId} and t.channel = 'whatsapp' and t.class = 'shopper'
        and t.stage in ('building', 'confirming') and t.owner in ('open', 'agent')
        and t.last_in_at > ${new Date(now.getTime() - 24 * 3600_000)}
        and t.last_in_at < ${new Date(now.getTime() - agent.settings.recovery.delayMin * 60_000)}
        and t.last_out_at >= t.last_in_at
        and (t.recovery_at is null or t.recovery_at < ${new Date(now.getTime() - 24 * 3600_000)})
        and exists (select 1 from cart_items i where i.cart_id = c.id)
      limit 50`;
    for (const t of due) {
      await dispatchTx(tx, {
        actor: actorOf(tenantId, t.id),
        kind: 'timer.recovery',
        source: 'vendedor:recovery',
        dedupeKey: `recovery:${t.id}:${now.toISOString().slice(0, 10)}`,
      });
      await tx`update shopper_threads set recovery_at = now() where id = ${t.id}`;
    }
    return due.length;
  });
}

/** An online Pix that lapsed unpaid: offered once more. */
export async function pixExpiryPass(sql: Sql, tenantId: string, now = new Date()): Promise<number> {
  return withTenant(sql, tenantId, async (tx) => {
    if (!(await loadAgent(tx, tenantId)).enabled) return 0;
    const due = await tx<{ thread_id: string; order_id: string; number: number }[]>`
      select distinct on (o.id) t.id as thread_id, o.id as order_id, o.number
      from orders o join shopper_threads t on t.id = o.thread_id
      join shopper_messages m on m.thread_id = t.id and m.kind = 'pix'
      where o.tenant_id = ${tenantId} and o.state not in ('cancelled', 'refunded')
        and o.payment ->> 'status' <> 'paid' and coalesce((o.payment ->> 'online')::boolean, false)
        and (m.meta -> 'data' ->> 'orderNumber')::int = o.number
        and (m.meta -> 'data' ->> 'expiresAt')::timestamptz < ${now}
        and (m.meta -> 'data' ->> 'expiresAt')::timestamptz > ${new Date(now.getTime() - 6 * 3600_000)}
      order by o.id, m.created_at desc
      limit 50`;
    for (const d of due)
      await dispatchTx(tx, {
        actor: actorOf(tenantId, d.thread_id),
        kind: 'timer.pix_expired',
        source: 'vendedor:pix',
        dedupeKey: `pixexp:${d.order_id}`,
        payload: { orderId: d.order_id, number: d.number },
      });
    return due.length;
  });
}

const sweepLog = log.child({ mod: 'vendedor-sweeper' });

const STATE_LABEL: Record<string, string> = {
  confirmed: 'aceito pela loja',
  preparing: 'em preparo',
  ready: 'pronto',
  out_for_delivery: 'saiu para entrega',
  delivered: 'entregue',
  cancelled: 'cancelado pela loja',
};

/** Outbox topics nobody consumed before (§4.3): back in stock, and order updates on a thread. */
export async function outboxPass(sql: Sql, o: { lagMs?: number } = {}): Promise<number> {
  const consumer = 'vendedor';
  // ids are taken at insert, not commit: reading only rows older than the lag means a slower tx
  // holding a lower id has committed before the cursor passes it
  const before = new Date(Date.now() - (o.lagMs ?? 30_000));
  const rows = await controlTx(sql, async (tx) => {
    await tx`insert into outbox_cursors (consumer, last_id) values (${consumer}, 0) on conflict do nothing`;
    const [cur] = await tx<
      { last_id: string }[]
    >`select last_id from outbox_cursors where consumer = ${consumer}`;
    return tx<{ id: string; tenant_id: string; topic: string; payload: Record<string, unknown> }[]>`
      select id, tenant_id, topic, payload from outbox
      where id > ${cur!.last_id} and created_at < ${before}
        and (topic = 'waitlist.restocked' or topic like 'order.%')
      order by id limit 200`;
  });
  if (!rows.length) {
    // the cursor jumps the topics it doesn't read, so a quiet store never rescans
    await controlTx(
      sql,
      (tx) => tx`
      update outbox_cursors set last_id = greatest(last_id,
        coalesce((select max(id) from outbox where created_at < ${before}), 0)), updated_at = now()
      where consumer = ${consumer} and updated_at < now() - interval '1 hour'`,
    );
    return 0;
  }
  const enabled = new Set(await enabledStores(sql));
  for (const r of rows) {
    if (!enabled.has(r.tenant_id)) continue;
    // one bad row loses only its own touch; a crash before the cursor moves replays the batch,
    // which the dedupe keys make harmless
    await outboxRow(sql, r).catch((err) =>
      sweepLog.error({ err, outboxId: r.id }, 'outbox row failed'),
    );
  }
  await controlTx(
    sql,
    (tx) => tx`update outbox_cursors set last_id = greatest(last_id, ${rows[rows.length - 1]!.id}),
      updated_at = now() where consumer = ${consumer}`,
  );
  return rows.length;
}

async function outboxRow(
  sql: Sql,
  r: { id: string; tenant_id: string; topic: string; payload: Record<string, unknown> },
): Promise<void> {
  await withTenant(sql, r.tenant_id, async (tx) => {
    // the switch or the plan turned it off since enabledStores read it
    if (!(await loadAgent(tx, r.tenant_id)).enabled) return;
    if (r.topic === 'waitlist.restocked') {
      const productId = String(r.payload.productId ?? '');
      const contacts = (Array.isArray(r.payload.contacts) ? r.payload.contacts : []).map((c) =>
        String(c)
          .replace(/\D/g, '')
          .replace(/^55(?=\d{10,11}$)/, ''),
      );
      if (!productId || !contacts.length) return;
      const [p] = await tx<
        { name: string }[]
      >`select name from products where tenant_id = ${r.tenant_id} and id = ${productId}`;
      const threads = await tx<{ id: string }[]>`
          select id from shopper_threads where tenant_id = ${r.tenant_id} and channel = 'whatsapp'
            and phone = any(${contacts}) and owner <> 'muted' and last_in_at > now() - interval '24 hours'`;
      for (const t of threads)
        await dispatchTx(tx, {
          actor: actorOf(r.tenant_id, t.id),
          kind: 'timer.back_in_stock',
          source: 'outbox:waitlist',
          dedupeKey: `stock:${t.id}:${productId}:${r.id}`,
          payload: { productId, name: p?.name ?? 'O produto' },
        });
      return;
    }
    const orderId = String(r.payload.orderId ?? '');
    const state = r.topic.slice('order.'.length);
    if (!orderId || !STATE_LABEL[state]) return;
    const [o] = await tx<{ thread_id: string | null; number: number }[]>`
        select thread_id, number from orders where tenant_id = ${r.tenant_id} and id = ${orderId}`;
    if (!o?.thread_id) return;
    await tx`update shopper_threads set stage = 'after', updated_at = now()
        where id = ${o.thread_id} and order_id = ${orderId} and ${state} in ('delivered', 'cancelled')`;
    await dispatchTx(tx, {
      actor: actorOf(r.tenant_id, o.thread_id),
      kind: 'webhook.order',
      source: 'outbox:order',
      dedupeKey: `order:${orderId}:${state}`,
      payload: { orderId, number: o.number, state, label: STATE_LABEL[state]! },
    });
  });
}

/** Voice replies (V3): the verified words spoken; on any failure the text goes as text. */
export async function voicePass(sql: Sql, media: MediaProviders | null): Promise<number> {
  const due = await controlTx(
    sql,
    (tx) => tx<{ id: string; tenant_id: string; thread_id: string; body: string }[]>`
      update shopper_messages set meta = meta || jsonb_build_object('voice', 'working', 'voiceAt', now())
      where id in (select id from shopper_messages
                   where meta ->> 'voice' = 'pending'
                      -- a claim whose worker died: the reply still goes, as voice or as text
                      or (meta ->> 'voice' = 'working' and (meta ->> 'voiceAt')::timestamptz < now() - interval '2 minutes')
                   order by created_at limit 5 for update skip locked)
      returning id, tenant_id, thread_id, body`,
  );
  for (const m of due) {
    const spoken = media ? await media.speak(m.body).catch(() => null) : null;
    await withTenant(sql, m.tenant_id, async (tx) => {
      const [t] = await tx<{ address: string; phone: string | null }[]>`
        select address, phone from shopper_threads where id = ${m.thread_id}`;
      if (!t) return;
      const jid = /@(s\.whatsapp\.net|lid)$/.test(t.address) ? t.address : null;
      const phone = t.phone && /^\d{10,11}$/.test(t.phone) ? t.phone : null;
      let mediaId: string | null = null;
      if (spoken) {
        const [row] = await tx<{ id: string }[]>`
          insert into shopper_media (tenant_id, message_id, mime, bytes, seconds)
          values (${m.tenant_id}, ${m.id}, ${spoken.mime}, ${Buffer.from(spoken.bytes)}, ${spoken.seconds})
          returning id`;
        mediaId = row!.id;
      }
      await tx`
        insert into store_wa_messages (tenant_id, kind, phone, jid, body, shopper_message_id, media_id, expires_at)
        values (${m.tenant_id}, 'chat', ${phone}, ${jid}, ${m.body.slice(0, 2000)}, ${m.id}, ${mediaId}, now() + interval '30 minutes')
        on conflict (shopper_message_id) where shopper_message_id is not null do nothing`;
      await tx`update shopper_messages set kind = ${spoken ? 'audio' : 'text'}, meta = meta || ${tx.json({ voice: spoken ? 'sent' : 'fallback' })}
        where id = ${m.id}`;
    }).catch((err) =>
      sweepLog.error({ err, messageId: m.id }, 'voice reply failed; retried later'),
    );
  }
  return due.length;
}

/**
 * The team hears when a store's Vendedor leaves its normal (sales-agent.md §6): verifier blocks
 * per 100 replies, the share of conversations handed to the store, or shoppers asking it to stop,
 * today against the last week. Counts only, never a shopper (ADR 0023).
 */
export async function monitorPass(sql: Sql, tenantId: string, now = new Date()): Promise<number> {
  return withTenant(sql, tenantId, async (tx) => {
    const day = new Date(now.getTime() - 24 * 3600_000);
    const week = new Date(now.getTime() - 8 * 24 * 3600_000);
    const [r] = await tx<
      {
        replies_d: number;
        blocks_d: number;
        replies_w: number;
        blocks_w: number;
        threads_d: number;
        handed_d: number;
        threads_w: number;
        handed_w: number;
        stop_d: number;
        stop_w: number;
      }[]
    >`
      select
        count(*) filter (where e.type = 'message.sent' and e.at >= ${day})::int as replies_d,
        count(*) filter (where e.type = 'guard.blocked' and e.payload ->> 'stage' = 'output' and e.at >= ${day})::int as blocks_d,
        count(*) filter (where e.type = 'message.sent' and e.at < ${day})::int as replies_w,
        count(*) filter (where e.type = 'guard.blocked' and e.payload ->> 'stage' = 'output' and e.at < ${day})::int as blocks_w,
        (select count(*) from shopper_threads where tenant_id = ${tenantId} and channel = 'whatsapp' and last_in_at >= ${day})::int as threads_d,
        (select count(*) from shopper_threads where tenant_id = ${tenantId} and channel = 'whatsapp' and waiting_since >= ${day})::int as handed_d,
        (select count(*) from shopper_threads where tenant_id = ${tenantId} and channel = 'whatsapp' and last_in_at between ${week} and ${day})::int as threads_w,
        (select count(*) from shopper_threads where tenant_id = ${tenantId} and channel = 'whatsapp' and waiting_since between ${week} and ${day})::int as handed_w,
        (select count(*) from store_wa_optouts where tenant_id = ${tenantId} and created_at >= ${day})::int as stop_d,
        (select count(*) from store_wa_optouts where tenant_id = ${tenantId} and created_at between ${week} and ${day})::int as stop_w
      from agent_events e join agent_actors a on a.id = e.actor_id
      where e.tenant_id = ${tenantId} and a.agent_id = ${AGENT_ID} and e.at >= ${week}
        and e.type in ('message.sent', 'guard.blocked')`;
    if (!r) return 0;
    const checks: {
      metric: 'blocks' | 'handoffs' | 'optouts';
      today: number;
      baseline: number;
      volume: number;
      floor: number;
    }[] = [
      {
        metric: 'blocks',
        today: r.replies_d ? (100 * r.blocks_d) / r.replies_d : 0,
        baseline: r.replies_w ? (100 * r.blocks_w) / r.replies_w : 0,
        volume: r.replies_d,
        floor: 20,
      },
      {
        metric: 'handoffs',
        today: r.threads_d ? (100 * r.handed_d) / r.threads_d : 0,
        baseline: r.threads_w ? (100 * r.handed_w) / r.threads_w : 0,
        volume: r.threads_d,
        floor: 10,
      },
      {
        metric: 'optouts',
        today: r.stop_d,
        baseline: r.stop_w / 7,
        volume: r.threads_d,
        floor: 10,
      },
    ];
    let n = 0;
    const [store] = await tx<{ name: string }[]>`select name from tenants where id = ${tenantId}`;
    for (const c of checks) {
      if (c.volume < c.floor) continue;
      const jumped =
        c.today >=
        Math.max(2 * c.baseline, c.metric === 'optouts' ? 3 : c.metric === 'blocks' ? 15 : 40);
      if (!jumped) continue;
      // awaited alone: it runs in a savepoint of this transaction
      await recordStaffEventTx(
        tx,
        'vendedor.monitor',
        {
          storeName: store?.name ?? null,
          metric: c.metric,
          today: Math.round(c.today * 10) / 10,
          baseline: Math.round(c.baseline * 10) / 10,
          volume: c.volume,
        },
        {
          tenantId,
          dedupeKey: `vendedor.monitor:${tenantId}:${c.metric}:${now.toISOString().slice(0, 10)}`,
        },
      );
      n++;
    }
    return n;
  });
}

/** Cliente oculto re-runs on its own after the menu changes (G4), at most once a day. */
export async function menuChangePass(
  sql: Sql,
  tenantId: string,
  hasModel: boolean,
): Promise<boolean> {
  if (!hasModel) return false;
  return withTenant(sql, tenantId, async (tx) => {
    // switched off, or a plan without the Vendedor: no model runs on its own (ADR 0032)
    if (!(await loadAgent(tx, tenantId)).enabled) return false;
    const [r] = await tx<{ changed: boolean }[]>`
      select exists (select 1 from audit_log where tenant_id = ${tenantId} and entity in ('product', 'category', 'modifier', 'catalog')
          and at > coalesce((select max(created_at) from vendedor_runs where tenant_id = ${tenantId}), 'epoch'::timestamptz))
        and not exists (select 1 from vendedor_runs where tenant_id = ${tenantId} and created_at > now() - interval '1 day')
        and exists (select 1 from vendedor_runs where tenant_id = ${tenantId} and status = 'done') as changed`;
    if (!r?.changed) return false;
    await tx`insert into vendedor_runs (tenant_id, trigger) values (${tenantId}, 'menu_change')`;
    return true;
  });
}

export async function sweepAll(sql: Sql, now = new Date(), hasModel = false): Promise<void> {
  for (const tenantId of await enabledStores(sql)) {
    await recoveryPass(sql, tenantId, now);
    await pixExpiryPass(sql, tenantId, now);
    await monitorPass(sql, tenantId, now);
    await menuChangePass(sql, tenantId, hasModel);
  }
  // catch up in batches: a busy hour's outbox is read in one sweep
  for (let i = 0; i < 10 && (await outboxPass(sql)) === 200; i++);
}
