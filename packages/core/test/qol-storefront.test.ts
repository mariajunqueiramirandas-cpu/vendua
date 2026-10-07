import { afterAll, describe, expect, test } from 'bun:test';
import { join } from 'node:path';
import postgres from 'postgres';
import { sweepAdmin } from '../src/admin/workers.ts';
import { createApp } from '../src/app.ts';
import { migrate, withTenant } from '../src/platform/db.ts';
import { wakeStoreWaitlist } from '../src/modules/storefront-platform.ts';

// "Avise-me quando abrir" (Kernel 1.21): a closed store's subscribers hear once it opens — by
// its hours or a resume — from the store's own WhatsApp, then they're cleared (qol2-open-notice
// covers a store without one).

describe.skipIf(!process.env.TEST_DATABASE_URL)('closed-store notify (db)', () => {
  const sql = postgres(process.env.TEST_DATABASE_URL!, { onnotice: () => {} });
  const app = createApp({ sql, sessionSecret: 's', controlSecret: 'ctl', autoDrain: false });
  const nonce = crypto.randomUUID().slice(0, 8);
  const ids: string[] = [];
  // 09:00–18:00 every day, São Paulo
  const DAY = {
    timezone: 'America/Sao_Paulo',
    windows: [{ days: [0, 1, 2, 3, 4, 5, 6], open: '09:00', close: '18:00' }],
  };
  const at = (hhmm: string) => new Date(`2026-10-06T${hhmm}:00-03:00`);

  let ready: Promise<void> | null = null;
  const setup = () =>
    (ready ??= (async () => {
      await migrate(sql, join(import.meta.dir, '../db/migrations'));
    })());

  const store = async (name: string, over: { override?: 'closed' | 'paused' | null } = {}) => {
    await setup();
    const slug = `qs-${name}-${nonce}`;
    const [t] = await sql<{ id: string }[]>`
      insert into tenants (slug, name) values (${slug}, ${slug}) returning id`;
    ids.push(t!.id);
    await sql`insert into domains (host, tenant_id) values (${`${slug}.localhost`}, ${t!.id})`;
    await sql`
      insert into store_settings (tenant_id, hours, status_override, prep_time_minutes, min_order_cents, currency, vocabulary)
      values (${t!.id}, ${sql.json(DAY)}, ${over.override ?? null}, 25, 0, 'BRL', ${sql.json({})})`;
    await sql`insert into store_whatsapp (tenant_id, wanted, state) values (${t!.id}, true, 'open')`;
    return { id: t!.id, host: `${slug}.localhost` };
  };

  let idem = 0;
  const subscribe = (host: string, phone: string) =>
    app.request(`http://${host}/checkout/v1/notify-me`, {
      method: 'POST',
      headers: {
        host,
        'content-type': 'application/json',
        'idempotency-key': `${nonce}-notify-${++idem}`,
      },
      body: JSON.stringify({ subject: 'store', phone }),
    });

  const pending = async (tenantId: string) =>
    (
      await sql<{ contact: string }[]>`
        select contact from notify_requests
        where tenant_id = ${tenantId} and subject = 'store' and notified_at is null order by contact`
    ).map((r) => r.contact);

  const opened = async (tenantId: string) =>
    (
      await sql<{ phone: string }[]>`
        select phone from store_wa_messages where tenant_id = ${tenantId} and kind = 'store_open'
        order by phone`
    ).map((r) => r.phone);

  afterAll(async () => {
    if (ids.length) await sql`delete from tenants where id = any(${ids}::uuid[])`;
    await sql.end();
  });

  test('by its hours: nothing while closed, every subscriber once when it opens', async () => {
    const a = await store('hours');
    const b = await store('other');
    expect((await subscribe(a.host, '22999990001')).status).toBe(201);
    expect((await subscribe(a.host, '(22) 99999-0002')).status).toBe(201);
    expect((await subscribe(b.host, '22999990003')).status).toBe(201);

    // 08:00 — still closed
    expect(await withTenant(sql, a.id, (tx) => wakeStoreWaitlist(tx, a.id, at('08:00')))).toBe(0);
    expect(await pending(a.id)).toEqual(['22999990001', '22999990002']);
    expect(await opened(a.id)).toEqual([]);

    // 09:30 — open: a message to each, the subscriptions cleared
    expect(await withTenant(sql, a.id, (tx) => wakeStoreWaitlist(tx, a.id, at('09:30')))).toBe(2);
    expect(await pending(a.id)).toEqual([]);
    expect(await opened(a.id)).toEqual(['22999990001', '22999990002']);
    // once: a second pass while open sends nothing
    expect(await withTenant(sql, a.id, (tx) => wakeStoreWaitlist(tx, a.id, at('09:31')))).toBe(0);
    expect(await opened(a.id)).toHaveLength(2);

    // the other store's subscriber is its own: untouched, never in this store's row
    expect(await pending(b.id)).toEqual(['22999990003']);
    expect(await opened(b.id)).toEqual([]);

    // the same answer that week, but no second message for the number
    const again = await subscribe(a.host, '22999990001');
    expect(again.status).toBe(201);
    expect(await again.json()).toEqual({ subscribed: true });
    expect(await pending(a.id)).toEqual([]);
    // a week on, the next closing takes a new subscription for the same phone
    await sql`update notify_requests set notified_at = now() - interval '8 days' where tenant_id = ${a.id}`;
    expect((await subscribe(a.host, '22999990001')).status).toBe(201);
    expect(await pending(a.id)).toEqual(['22999990001']);
  });

  test('a typed number is one number: +55, with or without its 9, asked again and again', async () => {
    const e = await store('repeat', { override: 'closed' });
    for (const typed of ['22999990005', '+55 (22) 99999-0005', '5522999990005', '2299990005'])
      expect(await (await subscribe(e.host, typed)).json()).toEqual({ subscribed: true });
    expect(await pending(e.id)).toEqual(['22999990005']);
    expect((await subscribe(e.host, '123')).status).toBe(400);

    // rows from before the cap: one message to the number, however it was stored
    await sql`
      insert into notify_requests (tenant_id, subject, channel, contact)
      values (${e.id}, 'store', 'whatsapp', '5522999990005'), (${e.id}, 'store', 'whatsapp', '2299990005')`;
    await sql`update store_settings set status_override = null where tenant_id = ${e.id}`;
    expect(await withTenant(sql, e.id, (tx) => wakeStoreWaitlist(tx, e.id, at('10:00')))).toBe(1);
    expect(await opened(e.id)).toEqual(['22999990005']);
    expect(await pending(e.id)).toEqual([]);

    // a later round that week (another row from before the cap) sends nothing more
    await sql`
      insert into notify_requests (tenant_id, subject, channel, contact)
      values (${e.id}, 'store', 'whatsapp', '22999990005')`;
    expect(await withTenant(sql, e.id, (tx) => wakeStoreWaitlist(tx, e.id, at('11:00')))).toBe(0);
    expect(await opened(e.id)).toEqual(['22999990005']);
  });

  test('a manual close holds them; the resume (the admin sweep) wakes them', async () => {
    const c = await store('manual', { override: 'closed' });
    expect((await subscribe(c.host, '22999990004')).status).toBe(201);
    expect(await withTenant(sql, c.id, (tx) => wakeStoreWaitlist(tx, c.id, at('10:00')))).toBe(0);
    expect(await pending(c.id)).toEqual(['22999990004']);

    // a store waiting for its first plan payment isn't open either
    await sql`update store_settings set status_override = null, billing_hold = true where tenant_id = ${c.id}`;
    expect(await withTenant(sql, c.id, (tx) => wakeStoreWaitlist(tx, c.id, at('10:00')))).toBe(0);

    // resumed, and open around the clock: the once-a-minute sweep takes it from here
    await sql`
      update store_settings set billing_hold = false,
        hours = ${sql.json({ timezone: 'America/Sao_Paulo', windows: [{ days: [0, 1, 2, 3, 4, 5, 6], open: '00:00', close: '00:00' }] })}
      where tenant_id = ${c.id}`;
    await sweepAdmin(sql);
    expect(await pending(c.id)).toEqual([]);
    expect(await opened(c.id)).toEqual(['22999990004']);
  });
});
