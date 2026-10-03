import { recordStaffEventTx } from '../modules/staff-events.ts';
import { whatsappDigits } from '../modules/store.ts';
import type { Sql } from '../platform/db.ts';
import { HttpError, bodyJson } from '../platform/http.ts';
import { wipeAuth } from '../store-whatsapp/auth-store.ts';
import {
  ORDER_EVENTS,
  enqueueTextTx,
  previewFacts,
  renderOrderMessage,
  testMessage,
  type OrderEvent,
} from '../store-whatsapp/messages.ts';
import { audit } from './audit.ts';
import { bool, isObj, text, type AdminDeps } from './context.ts';
import { handlers } from './handlers.ts';
import { emitAdminTx } from './live.ts';

// WhatsApp da loja (ADR 0026): the store links its own number as a device and its shoppers get
// order updates from it. Core only records what the merchant wants; the wa-gateway process does
// the linking and the sending and reports back through store_whatsapp.

/** a gateway that hasn't beaten in this long is gone */
const GATEWAY_FRESH = '30 seconds';
const RECENT = 20;

interface Row {
  wanted: boolean;
  state: string;
  detail: string | null;
  pair_code: string | null;
  pair_code_expires_at: Date | null;
  pair_phone: string | null;
  pair_requested_at: Date | null;
  wipe_requested_at: Date | null;
  phone: string | null;
  account_name: string | null;
  connected_at: Date | null;
  events: string[];
  live: boolean;
}

async function gatewayAlive(tx: Sql): Promise<boolean> {
  const rows = await tx`
    select 1 from wa_gateways where seen_at > now() - ${GATEWAY_FRESH}::interval limit 1`;
  return rows.length > 0;
}

async function loadRow(tx: Sql, tenantId: string): Promise<Row | null> {
  return (
    (
      await tx<Row[]>`
        select wanted, state, detail, pair_code, pair_code_expires_at, pair_phone, pair_requested_at,
               wipe_requested_at, phone, account_name, connected_at, events,
               coalesce(owner is not null and lease_until > now(), false) as live
        from store_whatsapp where tenant_id = ${tenantId}`
    )[0] ?? null
  );
}

const DEFAULT_EVENTS: readonly OrderEvent[] = [
  'placed',
  'paid',
  'confirmed',
  'ready',
  'out_for_delivery',
  'cancelled',
];

/** What the screen shows: the stored state, corrected for what the row can't know by itself. */
function effective(row: Row | null, available: boolean) {
  if (!row || (!row.wanted && row.state === 'off'))
    return { state: 'off', detail: row?.detail ?? null };
  if (row.state === 'pairing' && row.pair_code_expires_at && row.pair_code_expires_at < new Date())
    return { state: 'off', detail: 'pair_expired' };
  // the socket's process is gone: whatever it last said is no longer true
  if (['open', 'pairing', 'error'].includes(row.state) && !row.live)
    return { state: 'connecting', detail: available ? 'reconnecting' : 'gateway_offline' };
  if (row.state === 'connecting' && !available)
    return { state: 'connecting', detail: 'gateway_offline' };
  return { state: row.state, detail: row.detail };
}

export async function whatsappView(tx: Sql, tenantId: string, storeName: string) {
  const [row, available, settings, recent, stats] = await Promise.all([
    loadRow(tx, tenantId),
    gatewayAlive(tx),
    tx<{ whatsapp: string | null; tz: string | null }[]>`
      select whatsapp, hours ->> 'timezone' as tz from store_settings where tenant_id = ${tenantId}`,
    tx<
      {
        id: string;
        kind: string;
        event: string | null;
        order_id: string | null;
        number: number | null;
        status: string;
        error: string | null;
        created_at: Date;
        sent_at: Date | null;
        delivered_at: Date | null;
        read_at: Date | null;
      }[]
    >`
      select m.id, m.kind, m.event, m.order_id, o.number, m.status, m.error, m.created_at, m.sent_at,
             m.delivered_at, m.read_at
      from store_wa_messages m left join orders o on o.id = m.order_id
      where m.tenant_id = ${tenantId}
      order by m.created_at desc limit ${RECENT}`,
    tx<{ sent: number; failed: number; optouts: number }[]>`
      select
        (select count(*) from store_wa_messages where tenant_id = ${tenantId} and status = 'sent'
           and created_at > now() - interval '7 days')::int as sent,
        (select count(*) from store_wa_messages where tenant_id = ${tenantId} and status = 'failed'
           and created_at > now() - interval '7 days')::int as failed,
        (select count(*) from store_wa_optouts where tenant_id = ${tenantId})::int as optouts`,
  ]);
  const eff = effective(row, available);
  const enabled = new Set(row?.events ?? DEFAULT_EVENTS);
  const tz = settings[0]?.tz || 'America/Sao_Paulo';
  const facts = previewFacts(storeName, tz);
  const contact = whatsappDigits(settings[0]?.whatsapp ?? null);
  const pairing = eff.state === 'pairing';
  return {
    available,
    state: eff.state,
    detail: eff.detail,
    phone: eff.state === 'open' ? (row?.phone ?? null) : null,
    name: eff.state === 'open' ? (row?.account_name ?? null) : null,
    connectedAt: eff.state === 'open' ? (row?.connected_at?.toISOString() ?? null) : null,
    pairCode: pairing ? (row?.pair_code ?? null) : null,
    pairCodeExpiresAt: pairing ? (row?.pair_code_expires_at?.toISOString() ?? null) : null,
    pairPhone: row?.pair_phone ?? null,
    disconnecting: !!row?.wipe_requested_at,
    suggestedPhone: contact ? contact.slice(2) : null,
    events: Object.fromEntries(ORDER_EVENTS.map((e) => [e, enabled.has(e)])) as Record<
      OrderEvent,
      boolean
    >,
    previews: Object.fromEntries(
      ORDER_EVENTS.map((e) => [
        e,
        renderOrderMessage(e, e === 'ready' ? { ...facts, mode: 'pickup' } : facts),
      ]),
    ) as Record<OrderEvent, string | null>,
    stats: stats[0] ?? { sent: 0, failed: 0, optouts: 0 },
    recent: recent.map((r) => ({
      id: r.id,
      kind: r.kind,
      event: r.event,
      orderId: r.order_id,
      orderNumber: r.number,
      status: r.status,
      error: r.error,
      createdAt: r.created_at.toISOString(),
      sentAt: r.sent_at?.toISOString() ?? null,
      deliveredAt: r.delivered_at?.toISOString() ?? null,
      readAt: r.read_at?.toISOString() ?? null,
    })),
  };
}

export function mountWhatsapp(d: AdminDeps) {
  const { admin } = d;
  const { read, write } = handlers(d);

  admin.get(
    '/whatsapp',
    read('manager', (tx, t) => whatsappView(tx, t.id, t.name)),
  );

  // Ask the gateway for a pairing code for this number. The code shows up on the screen (live
  // stream) a few seconds later; the merchant types it in WhatsApp → Aparelhos conectados.
  admin.post(
    '/whatsapp/pair',
    write('owner', async (tx, t, m, c) => {
      const body = await bodyJson(c, 4 * 1024);
      const raw = text(body.phone, 'phone', 40, 8).replace(/\D/g, '');
      const phone = raw.length >= 12 && raw.startsWith('55') ? raw.slice(2) : raw;
      if (!/^\d{10,11}$/.test(phone))
        throw new HttpError(422, 'BAD_REQUEST', 'phone must be a Brazilian number with DDD', {
          field: 'phone',
        });
      if (!(await gatewayAlive(tx)))
        throw new HttpError(503, 'WHATSAPP_UNAVAILABLE', 'whatsapp service is not running');
      const row = await loadRow(tx, t.id);
      if (row?.state === 'open' && row.live && row.wanted)
        throw new HttpError(409, 'WHATSAPP_CONNECTED', 'disconnect the current number first');
      await tx`
        insert into store_whatsapp (tenant_id, wanted, pair_phone, pair_requested_at, state, detail,
                                    pair_code, pair_code_expires_at)
        values (${t.id}, true, ${phone}, ${new Date()}, 'connecting', 'pair_requested', null, null)
        on conflict (tenant_id) do update set wanted = true, pair_phone = excluded.pair_phone,
          pair_requested_at = excluded.pair_requested_at, state = 'connecting',
          detail = 'pair_requested', pair_code = null, pair_code_expires_at = null,
          connected_at = null, outage_since = null, state_changed_at = now(), updated_at = now()`;
      await audit(tx, t.id, m, {
        action: 'whatsapp.pair',
        entity: 'whatsapp',
        summary: 'pediu um código para conectar o WhatsApp da loja',
        after: { phone: `…${phone.slice(-4)}` },
      });
      await emitAdminTx(tx, t.id, 'whatsapp', 'connecting');
      return { status: 200, body: await whatsappView(tx, t.id, t.name) };
    }),
  );

  // Unlink the device and forget the login. The gateway logs out on WhatsApp's side; when none
  // is running, Core forgets the login itself (the phone keeps a dead entry the merchant removes).
  admin.post(
    '/whatsapp/disconnect',
    write('owner', async (tx, t, m) => {
      const row = await loadRow(tx, t.id);
      if (!row || (!row.wanted && !row.wipe_requested_at && row.state === 'off'))
        return { status: 200, body: await whatsappView(tx, t.id, t.name) };
      const alive = await gatewayAlive(tx);
      if (alive)
        await tx`
          update store_whatsapp set wanted = false, wipe_requested_at = ${new Date()},
            pair_requested_at = null, state = 'off', detail = null, pair_code = null,
            pair_code_expires_at = null, phone = null, account_name = null, connected_at = null,
            state_changed_at = now(), updated_at = now()
          where tenant_id = ${t.id}`;
      else {
        await wipeAuth(tx, t.id);
        await tx`
          update store_whatsapp set wanted = false, wipe_requested_at = null, pair_requested_at = null,
            state = 'off', detail = 'unlinked_offline', pair_code = null, pair_code_expires_at = null,
            phone = null, account_name = null, connected_at = null, state_changed_at = now(),
            updated_at = now()
          where tenant_id = ${t.id}`;
      }
      // queued messages would only go out on a number the store just let go
      const skipped = await tx<{ shopper_message_id: string | null }[]>`
        update store_wa_messages set status = 'skipped', error = 'disconnected', lease_until = null
        where tenant_id = ${t.id} and status in ('pending', 'sending')
        returning shopper_message_id`;
      // the Vendedor's replies that never left say so in its conversations
      const replies = skipped.map((r) => r.shopper_message_id).filter((x): x is string => !!x);
      if (replies.length)
        await tx`update shopper_messages set status = 'failed'
          where tenant_id = ${t.id} and id = any(${replies}::uuid[]) and status = 'queued'`;
      await audit(tx, t.id, m, {
        action: 'whatsapp.disconnect',
        entity: 'whatsapp',
        summary: 'desconectou o WhatsApp da loja',
        before: { state: row.state, phone: row.phone ? `…${row.phone.slice(-4)}` : null },
      });
      await emitAdminTx(tx, t.id, 'whatsapp', 'off');
      if (row.state === 'open')
        await recordStaffEventTx(
          tx,
          'whatsapp.store',
          { storeName: t.name, step: 'disconnected', detail: 'pelo lojista' },
          { tenantId: t.id },
        );
      return { status: 200, body: await whatsappView(tx, t.id, t.name) };
    }),
  );

  admin.patch(
    '/whatsapp/settings',
    write('manager', async (tx, t, m, c) => {
      const body = await bodyJson(c, 4 * 1024);
      if (!isObj(body.events))
        throw new HttpError(422, 'BAD_REQUEST', 'events must be an object', { field: 'events' });
      const adds: string[] = [];
      const removes: string[] = [];
      for (const [k, v] of Object.entries(body.events)) {
        if (!(ORDER_EVENTS as readonly string[]).includes(k))
          throw new HttpError(422, 'BAD_REQUEST', `unknown event ${k.slice(0, 30)}`, {
            field: 'events',
          });
        (bool(v, `events.${k}`) ? adds : removes).push(k);
      }
      // two quick toggles each change only their own step: no read-modify-write of the array
      await tx`insert into store_whatsapp (tenant_id) values (${t.id}) on conflict do nothing`;
      const changed = (
        await tx<{ before: string[]; events: string[] }[]>`
          update store_whatsapp w set events = (
              select coalesce(array_agg(e order by ord), '{}')
              from unnest(${ORDER_EVENTS as unknown as string[]}::text[]) with ordinality as x(e, ord)
              where (e = any(w.events) or e = any(${adds}::text[])) and not (e = any(${removes}::text[]))
            ), updated_at = now()
          from (select events as before from store_whatsapp where tenant_id = ${t.id} for update) old
          where w.tenant_id = ${t.id}
          returning old.before, w.events`
      )[0]!;
      await audit(tx, t.id, m, {
        action: 'whatsapp.settings',
        entity: 'whatsapp',
        summary: 'mudou os avisos de pedido pelo WhatsApp',
        before: { events: changed.before },
        after: { events: changed.events },
      });
      await emitAdminTx(tx, t.id, 'whatsapp', 'settings');
      return { status: 200, body: await whatsappView(tx, t.id, t.name) };
    }),
  );

  // "Mandar um teste para mim": the signed-in merchant's own phone, from the store's number.
  admin.post(
    '/whatsapp/test',
    write('manager', async (tx, t, m) => {
      const row = await loadRow(tx, t.id);
      if (!row?.wanted || row.state !== 'open' || !row.live)
        throw new HttpError(409, 'WHATSAPP_NOT_CONNECTED', 'connect the store whatsapp first');
      const phone = m.phone.replace(/\D/g, '');
      if (!/^\d{10,11}$/.test(phone))
        throw new HttpError(422, 'BAD_REQUEST', 'your phone is not a Brazilian mobile');
      const recent = await tx`
        select 1 from store_wa_messages where tenant_id = ${t.id} and kind = 'test'
          and created_at > now() - interval '1 minute' limit 1`;
      if (recent.length)
        throw new HttpError(429, 'RATE_LIMITED', 'one test a minute', { retryAfter: 60 });
      await enqueueTextTx(tx, t.id, 'test', phone, testMessage(t.name));
      await emitAdminTx(tx, t.id, 'whatsapp', 'message');
      return { status: 200, body: await whatsappView(tx, t.id, t.name) };
    }),
  );
}
