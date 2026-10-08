import { emitAdminTx } from '../admin/live.ts';
import { controlTx } from '../modules/control.ts';
import { recordStaffEventTx } from '../modules/staff-events.ts';
import { withTenant, type Sql } from '../platform/db.ts';
import { LeaseLost, wipeAuth, type Fence } from './auth-store.ts';
import { enqueueTextTx, optInAck, optOutAck } from './messages.ts';
import { NOTICE_KINDS } from './proactive.ts';
import type { Inbound, Receipt, StateUpdate } from './session.ts';
import { jidForPhone, optKeyword, phoneVariants } from './text.ts';

// The gateway's writes. Every one is fenced on the store's lease (owner + epoch) and runs in the
// store's own tenant transaction, so the side effects (admin stream, staff card) commit with it.

/** a keyword only counts from someone this store texted lately (an order, a reminder, "abrimos") */
const KEYWORD_WINDOW = '90 days';
const CONTACT_KINDS = [...NOTICE_KINDS, 'chat'];
/** store_wa_optouts.jid's check */
const JID = /^[0-9:.]{1,40}@(s\.whatsapp\.net|lid)$/;
const RETENTION = '30 days';
const ACK_WINDOW = '10 minutes';

interface Row {
  state: string;
  wanted: boolean;
  connected_at: Date | null;
  outage_since: Date | null;
  owner: string | null;
  lease_epoch: string | number;
}

/** The store's row, locked, if this gateway still holds its lease; LeaseLost otherwise. */
export async function heldTx(tx: Sql, tenantId: string, fence: Fence): Promise<Row> {
  const row = (
    await tx<Row[]>`
      select state, wanted, connected_at, outage_since, owner, lease_epoch from store_whatsapp
      where tenant_id = ${tenantId} for update`
  )[0];
  if (!row || row.owner !== fence.owner || Number(row.lease_epoch) !== fence.epoch)
    throw new LeaseLost(tenantId);
  return row;
}

type StoreEvent = 'connected' | 'back' | 'lost' | 'logged_out' | 'banned';

/** What the team hears. An outage opens once (outage_since) however many reconnects fail and
 *  however many gateways restart meanwhile, and the next open closes it. */
function staffStep(prev: Row, next: StateUpdate['state']): StoreEvent | null {
  if (next === 'open') {
    if (prev.state === 'open') return null;
    if (prev.state === 'pairing' || !prev.connected_at) return 'connected';
    return prev.outage_since ? 'back' : null;
  }
  if (next === prev.state) return null;
  if (next === 'error') return prev.outage_since ? null : 'lost';
  if (next === 'logged_out') return 'logged_out';
  if (next === 'banned') return 'banned';
  return null;
}

/** Persist what a store's socket is doing. Throws LeaseLost when this gateway no longer owns it. */
export async function reportState(
  sql: Sql,
  tenantId: string,
  fence: Fence,
  u: StateUpdate,
): Promise<void> {
  await withTenant(sql, tenantId, async (tx) => {
    const prev = await heldTx(tx, tenantId, fence);
    // a disconnect the merchant asked for wins over a late "open" from a socket still closing
    if (!prev.wanted && !['off', 'logged_out', 'banned'].includes(u.state)) return;
    const set: Record<string, unknown> = { state: u.state, updated_at: new Date() };
    if (u.detail !== undefined) set.detail = u.detail;
    else if (u.state === 'open') set.detail = null;
    if (u.phone !== undefined) set.phone = u.phone;
    if (u.name !== undefined) set.account_name = u.name?.slice(0, 100) ?? null;
    if (u.pairCode !== undefined) set.pair_code = u.pairCode;
    if (u.pairCodeExpiresAt !== undefined) set.pair_code_expires_at = u.pairCodeExpiresAt;
    if (u.pairCode === null) set.pair_code_expires_at = null;
    if (u.state !== prev.state) set.state_changed_at = new Date();
    if (u.state === 'open' && prev.state !== 'open') set.connected_at = new Date();
    if (u.state === 'error' && !prev.outage_since) set.outage_since = new Date();
    if (u.state !== 'error' && u.state !== 'connecting') set.outage_since = null;
    if (u.state === 'logged_out' || u.state === 'off') {
      set.connected_at = null;
      if (u.phone === undefined) set.phone = null;
      if (u.name === undefined) set.account_name = null;
    }
    await tx`update store_whatsapp set ${tx(set as never)} where tenant_id = ${tenantId}`;
    await emitAdminTx(tx, tenantId, 'whatsapp', u.state);
    const step = staffStep(prev, u.state);
    if (step) {
      const store = (
        await tx<{ name: string }[]>`select name from tenants where id = ${tenantId}`
      )[0];
      await recordStaffEventTx(
        tx,
        'whatsapp.store',
        { storeName: store?.name ?? '', step, detail: u.detail ?? null },
        { tenantId },
      );
    }
  });
}

/** Forget a store's login, fenced: a gateway that lost the lease can't wipe the new owner's. */
export async function wipeFenced(sql: Sql, tenantId: string, fence: Fence): Promise<void> {
  await withTenant(sql, tenantId, async (tx) => {
    await heldTx(tx, tenantId, fence);
    await wipeAuth(tx, tenantId);
  });
}

/** Take a pending pairing request (once): returns the phone, or null when there is none. */
export async function takePairRequest(
  sql: Sql,
  tenantId: string,
  fence: Fence,
  seenAt: Date,
): Promise<string | null> {
  return withTenant(sql, tenantId, async (tx) => {
    await heldTx(tx, tenantId, fence);
    const rows = await tx<{ pair_phone: string | null; fresh: boolean }[]>`
      update store_whatsapp set pair_requested_at = null
      where tenant_id = ${tenantId}
        and date_trunc('milliseconds', pair_requested_at) = ${seenAt}
      returning pair_phone, ${seenAt}::timestamptz > now() - interval '2 minutes' as fresh`;
    const r = rows[0];
    if (!r) return null;
    if (!r.fresh || !r.pair_phone) {
      // the merchant asked minutes ago and nobody was here: say so instead of a silent spinner
      await tx`update store_whatsapp set state = 'off', detail = 'pair_expired', updated_at = now()
               where tenant_id = ${tenantId}`;
      await emitAdminTx(tx, tenantId, 'whatsapp', 'off');
      return null;
    }
    return r.pair_phone;
  });
}

/** The disconnect the merchant asked for is done. */
export async function finishWipe(
  sql: Sql,
  tenantId: string,
  fence: Fence,
  seenAt: Date,
): Promise<void> {
  await withTenant(sql, tenantId, async (tx) => {
    await heldTx(tx, tenantId, fence);
    await tx`update store_whatsapp set wipe_requested_at = null
             where tenant_id = ${tenantId}
               and date_trunc('milliseconds', wipe_requested_at) = ${seenAt}`;
  });
}

/** A shopper flipping SAIR/VOLTAR gets one acknowledgement per window: the setting still
 *  changes every time, but the store's number doesn't answer each flip. */
async function ackedLatelyTx(tx: Sql, tenantId: string, to: Addresses): Promise<boolean> {
  const rows = await tx`
    select 1 from store_wa_messages
    where tenant_id = ${tenantId} and (phone = any(${to.phones}::text[]) or jid = any(${to.jids}::text[]))
      and kind in ('opt_in', 'opt_out')
      and created_at > now() - ${ACK_WINDOW}::interval
    limit 1`;
  return rows.length > 0;
}

interface Addresses {
  phones: string[];
  jids: string[];
}

/** SAIR / VOLTAR from a shopper the store texted (a notice, or the Vendedor, whose nudges the
 *  opt-out stops). Anything else is the store's conversation. */
export async function handleInbound(sql: Sql, tenantId: string, m: Inbound): Promise<void> {
  const kw = optKeyword(m.text);
  if (!kw) return;
  // a shopper whose WhatsApp hides their number is known by the chat's address
  // (with a number, its jids too: an opt-out taken while it was hidden moves to the number's jid)
  const jids = (xs: (string | null | undefined)[]) =>
    [...new Set(xs)].filter((j): j is string => !!j && JID.test(j));
  const to: Addresses = m.phone
    ? {
        phones: phoneVariants(m.phone),
        jids: jids([...phoneVariants(m.phone).map(jidForPhone), m.jid]),
      }
    : { phones: [], jids: jids([m.jid]) };
  if (!to.phones.length && !to.jids.length) return;
  const addresses = [...to.phones, ...to.jids];
  await withTenant(sql, tenantId, async (tx) => {
    const store = (
      await tx<{ name: string }[]>`select name from tenants where id = ${tenantId}`
    )[0];
    const name = store?.name ?? 'loja';
    if (kw === 'in') {
      // the opt-out itself is the proof: it outlives the message history it came from
      const removed = await tx<{ phone: string | null; jid: string | null }[]>`
        delete from store_wa_optouts
        where tenant_id = ${tenantId}
          and (phone = any(${to.phones}::text[]) or jid = any(${to.jids}::text[]))
        returning phone, jid`;
      if (!removed.length) return;
      if (!(await ackedLatelyTx(tx, tenantId, to)))
        await enqueueTextTx(
          tx,
          tenantId,
          'opt_in',
          removed[0]!.phone,
          optInAck(name),
          removed[0]!.jid,
        );
      await emitAdminTx(tx, tenantId, 'whatsapp', 'optout');
      return;
    }
    // the queue keeps 30 days of rows; older contacts within the window are in store_wa_contacts
    const known = (
      await tx<{ address: string }[]>`
        select address from (
          select coalesce(phone, jid) as address, created_at as at from store_wa_messages
          where tenant_id = ${tenantId}
            and (phone = any(${to.phones}::text[]) or jid = any(${to.jids}::text[]))
            and kind = any(${CONTACT_KINDS}::text[])
          union all
          select address, last_at from store_wa_contacts
          where tenant_id = ${tenantId} and address = any(${addresses}::text[])
        ) c
        where at > now() - ${KEYWORD_WINDOW}::interval
        order by at desc limit 1`
    )[0];
    if (!known) return;
    // the spelling the store texted (the contact may be on record by its jid)
    const phone = m.phone ? (/^\d{10,11}$/.test(known.address) ? known.address : m.phone) : null;
    const jid = phone ? null : to.jids[0]!;
    const added = await tx`
      insert into store_wa_optouts (tenant_id, phone, jid) values (${tenantId}, ${phone}, ${jid})
      on conflict do nothing returning tenant_id`;
    if (!added.length) return;
    await tx`update store_wa_messages set status = 'skipped', error = 'opted_out', lease_until = null
             where tenant_id = ${tenantId}
               and (phone = any(${to.phones}::text[]) or jid = any(${to.jids}::text[]))
               and kind = any(${NOTICE_KINDS as string[]}::text[]) and status = 'pending'`;
    if (!(await ackedLatelyTx(tx, tenantId, to)))
      await enqueueTextTx(tx, tenantId, 'opt_out', phone, optOutAck(name), jid);
    await emitAdminTx(tx, tenantId, 'whatsapp', 'optout');
  });
}

/** A Vendedor reply's outcome on its conversation message: queued → sent | failed. */
export async function mirrorStatusTx(
  tx: Sql,
  tenantId: string,
  shopperMessageId: string,
  status: 'sent' | 'failed',
  waId: string | null,
): Promise<void> {
  // the WhatsApp id lets Core find which reply a shopper quoted
  await tx`
    update shopper_messages set status = ${status},
      wa_id = case when ${status} = 'sent' and wa_id is null and not exists (
                select 1 from shopper_messages o where o.tenant_id = ${tenantId} and o.wa_id = ${waId})
              then ${waId} else wa_id end
    where tenant_id = ${tenantId} and id = ${shopperMessageId} and status = 'queued'`;
}

/** Ticks on Vendedor replies: never back from read to delivered. */
async function mirrorReceiptsTx(tx: Sql, tenantId: string, delivered: string[], read: string[]) {
  await tx`
    update shopper_messages m set status = 'delivered'
    from store_wa_messages w
    where w.tenant_id = ${tenantId} and w.wa_id = any(${delivered}) and m.id = w.shopper_message_id
      and m.status in ('queued', 'sent', 'failed')`;
  if (read.length)
    await tx`
      update shopper_messages m set status = 'read'
      from store_wa_messages w
      where w.tenant_id = ${tenantId} and w.wa_id = any(${read}) and m.id = w.shopper_message_id
        and m.status in ('queued', 'sent', 'failed', 'delivered')`;
}

export async function recordReceipts(sql: Sql, tenantId: string, rs: Receipt[]): Promise<void> {
  const read = rs.filter((r) => r.status === 'read').map((r) => r.waId);
  const delivered = rs.map((r) => r.waId);
  await withTenant(sql, tenantId, async (tx) => {
    await tx`update store_wa_messages set delivered_at = coalesce(delivered_at, now())
             where tenant_id = ${tenantId} and wa_id = any(${delivered})`;
    if (read.length)
      await tx`update store_wa_messages set read_at = coalesce(read_at, now())
               where tenant_id = ${tenantId} and wa_id = any(${read})`;
    await mirrorReceiptsTx(tx, tenantId, delivered, read);
    // the open screen's ticks move on their own
    await emitAdminTx(tx, tenantId, 'whatsapp', 'receipt');
  });
}

export async function messageText(
  sql: Sql,
  tenantId: string,
  waId: string,
): Promise<string | null> {
  const rows = await withTenant(
    sql,
    tenantId,
    (tx) => tx<{ body: string }[]>`
      select body from store_wa_messages
      where tenant_id = ${tenantId} and wa_id = ${waId} and media_id is null limit 1`,
  );
  return rows[0]?.body ?? null;
}

/** Old queue rows go; pending ones past their moment expire (a "saiu para entrega" six hours
 *  late is worse than none). Any gateway may run it. */
export async function housekeeping(sql: Sql): Promise<{ expired: number; deleted: number }> {
  return controlTx(sql, async (tx) => {
    const expired = await tx<{ tenant_id: string; shopper_message_id: string | null }[]>`
      update store_wa_messages set status = 'expired', lease_until = null
      where status in ('pending', 'sending') and expires_at < now()
        and (lease_until is null or lease_until < now())
      returning tenant_id, shopper_message_id`;
    const replies = expired.flatMap((r) => (r.shopper_message_id ? [r.shopper_message_id] : []));
    if (replies.length)
      await tx`update shopper_messages set status = 'failed'
               where id = any(${replies}::uuid[]) and status = 'queued'`;
    // a SAIR counts for KEYWORD_WINDOW after the last contact, longer than the rows live
    await tx`
      insert into store_wa_contacts (tenant_id, address, last_at)
      select m.tenant_id, a.address, max(m.created_at)
      from store_wa_messages m
      cross join lateral (values (m.phone), (m.jid)) a (address)
      where m.created_at < now() - ${RETENTION}::interval
        and m.kind = any(${CONTACT_KINDS}::text[]) and a.address is not null
      group by m.tenant_id, a.address
      on conflict (tenant_id, address)
        do update set last_at = greatest(store_wa_contacts.last_at, excluded.last_at)`;
    await tx`delete from store_wa_contacts where last_at < now() - ${KEYWORD_WINDOW}::interval`;
    const deleted = await tx`
      delete from store_wa_messages where created_at < now() - ${RETENTION}::interval`;
    await tx`delete from wa_gateways where seen_at < now() - interval '1 day'`;
    return { expired: expired.count, deleted: deleted.count };
  });
}
