import { afterAll, describe, expect, test } from 'bun:test';
import { join } from 'node:path';
import postgres from 'postgres';
import { createApp } from '../src/app.ts';
import { migrate, withTenant } from '../src/platform/db.ts';
import { wakeStoreWaitlist } from '../src/modules/storefront-platform.ts';
import { OPT_OUT_FOOTER } from '../src/store-whatsapp/messages.ts';
import { outboxPass } from '../src/vendedor/sweeper.ts';

// "Avise-me quando abrir" reaches people: when the store opens, each subscriber gets one message
// from the store's own WhatsApp, queued with the request marked; without one, nobody is consumed.

describe.skipIf(!process.env.TEST_DATABASE_URL)('store-open notice (db)', () => {
  const sql = postgres(process.env.TEST_DATABASE_URL!, { onnotice: () => {} });
  const app = createApp({ sql, sessionSecret: 's', controlSecret: 'ctl', autoDrain: false });
  const nonce = crypto.randomUUID().slice(0, 8);
  const stamp = String(Date.now()).slice(-6);
  const ids: string[] = [];
  let n = 0;
  // 09:00–18:00 every day, São Paulo
  const DAY = {
    timezone: 'America/Sao_Paulo',
    windows: [{ days: [0, 1, 2, 3, 4, 5, 6], open: '09:00', close: '18:00' }],
  };
  const at = (hhmm: string) => new Date(`2026-10-06T${hhmm}:00-03:00`);
  const phone = (k: number) => `2199${stamp}${k}`;

  let ready: Promise<void> | null = null;
  const setup = () =>
    (ready ??= (async () => {
      await migrate(sql, join(import.meta.dir, '../db/migrations'));
    })());

  const store = async (o: { linked?: boolean; vendedor?: boolean } = {}) => {
    await setup();
    const slug = `on-${nonce}-${++n}`;
    const [t] = await sql<{ id: string }[]>`
      insert into tenants (slug, name) values (${slug}, ${'Doce ' + n}) returning id`;
    ids.push(t!.id);
    await sql`insert into domains (host, tenant_id) values (${`${slug}.localhost`}, ${t!.id})`;
    await sql`
      insert into store_settings (tenant_id, hours, prep_time_minutes, min_order_cents, currency, vocabulary)
      values (${t!.id}, ${sql.json(DAY)}, 25, 0, 'BRL', ${sql.json({})})`;
    if (o.linked !== false)
      await sql`insert into store_whatsapp (tenant_id, wanted, state) values (${t!.id}, true, 'open')`;
    if (o.vendedor) await sql`insert into store_agent (tenant_id, enabled) values (${t!.id}, true)`;
    return { id: t!.id, host: `${slug}.localhost`, slug };
  };

  let idem = 0;
  const subscribe = async (host: string, contact: string) => {
    const r = await app.request(`http://${host}/checkout/v1/notify-me`, {
      method: 'POST',
      headers: {
        host,
        'content-type': 'application/json',
        'idempotency-key': `${nonce}-notify-${++idem}`,
      },
      body: JSON.stringify({ subject: 'store', phone: contact }),
    });
    expect(r.status).toBe(201);
  };
  const wake = (tenantId: string, hhmm: string) =>
    withTenant(sql, tenantId, (tx) => wakeStoreWaitlist(tx, tenantId, at(hhmm)));
  const pending = async (tenantId: string) =>
    (
      await sql<{ contact: string }[]>`
        select contact from notify_requests
        where tenant_id = ${tenantId} and subject = 'store' and notified_at is null order by contact`
    ).map((r) => r.contact);
  const notices = (tenantId: string) =>
    sql<{ phone: string; body: string; status: string; expires_at: Date }[]>`
      select phone, body, status, expires_at from store_wa_messages
      where tenant_id = ${tenantId} and kind = 'store_open' order by phone`;

  afterAll(async () => {
    if (ids.length) await sql`delete from tenants where id = any(${ids}::uuid[])`;
    await sql.end();
  });

  test('once per subscriber when the store opens, from its own WhatsApp; other stores untouched', async () => {
    const a = await store();
    const b = await store();
    await subscribe(a.host, phone(1));
    await subscribe(a.host, `(${phone(2).slice(0, 2)}) ${phone(2).slice(2)}`);
    await subscribe(b.host, phone(3));

    expect(await wake(a.id, '08:00')).toBe(0);
    expect(await pending(a.id)).toEqual([phone(1), phone(2)]);
    expect(await notices(a.id)).toHaveLength(0);

    expect(await wake(a.id, '09:30')).toBe(2);
    expect(await pending(a.id)).toEqual([]);
    const sent = await notices(a.id);
    expect(sent.map((m) => m.phone)).toEqual([phone(1), phone(2)]);
    expect(sent[0]!.body).toContain('Aqui é da Doce');
    expect(sent[0]!.body).toContain(`https://${a.slug}.`);
    expect(sent[0]!.body.endsWith(OPT_OUT_FOOTER)).toBe(true);
    // a "we're open" an hour late says something no longer true
    expect(sent[0]!.expires_at.getTime() - Date.now()).toBeLessThanOrEqual(3_600_000);

    // once: another pass while open sends nothing more
    expect(await wake(a.id, '09:31')).toBe(0);
    expect(await notices(a.id)).toHaveLength(2);
    // the other store's subscriber is its own
    expect(await pending(b.id)).toEqual([phone(3)]);
    expect(await notices(b.id)).toHaveLength(0);
    // and no outbox row carrying phones is left behind
    const ob =
      await sql`select 1 from outbox where tenant_id = ${a.id} and topic = 'waitlist.store_open'`;
    expect(ob).toHaveLength(0);
  });

  test('without a linked WhatsApp nobody is consumed; linking it delivers at the next pass', async () => {
    const s = await store({ linked: false });
    await subscribe(s.host, phone(4));
    expect(await wake(s.id, '10:00')).toBe(0);
    expect(await pending(s.id)).toEqual([phone(4)]);
    // linked but unlinked again on the phone: still waiting
    await sql`insert into store_whatsapp (tenant_id, wanted, state) values (${s.id}, true, 'logged_out')`;
    expect(await wake(s.id, '10:00')).toBe(0);
    expect(await pending(s.id)).toEqual([phone(4)]);
    await sql`update store_whatsapp set state = 'open' where tenant_id = ${s.id}`;
    expect(await wake(s.id, '10:01')).toBe(1);
    expect(await pending(s.id)).toEqual([]);
  });

  test('a number that said SAIR is consumed unsent; one number twice is one message', async () => {
    const s = await store();
    await subscribe(s.host, phone(5));
    await subscribe(s.host, `55${phone(5)}`);
    await subscribe(s.host, phone(6));
    await sql`insert into store_wa_optouts (tenant_id, phone) values (${s.id}, ${phone(6)})`;
    expect(await wake(s.id, '12:00')).toBe(1);
    expect((await notices(s.id)).map((m) => m.phone)).toEqual([phone(5)]);
    expect(await pending(s.id)).toEqual([]);
  });

  test('a burst waits under the hourly ceiling for messages the store starts', async () => {
    const s = await store();
    await sql`
      insert into store_wa_messages (tenant_id, kind, phone, body, status, sent_at)
      select ${s.id}, 'store_open', ${phone(0)}, 'x', 'sent', now() from generate_series(1, 59)`;
    await subscribe(s.host, phone(7));
    await subscribe(s.host, phone(8));
    expect(await wake(s.id, '12:00')).toBe(1);
    expect((await pending(s.id)).length).toBe(1);
    expect(await wake(s.id, '12:01')).toBe(0);
    await sql`update store_wa_messages set created_at = now() - interval '2 hours'
              where tenant_id = ${s.id} and phone = ${phone(0)}`;
    expect(await wake(s.id, '12:02')).toBe(1);
    expect(await pending(s.id)).toEqual([]);
  });

  test('two sweeps at once share the ceiling, not each fill it', async () => {
    const s = await store();
    await sql`
      insert into store_wa_messages (tenant_id, kind, phone, body, status, sent_at)
      select ${s.id}, 'store_open', ${phone(0)}, 'x', 'sent', now() from generate_series(1, 58)`;
    for (const k of [1, 2, 3, 4]) await subscribe(s.host, `2198${stamp}${k}`);
    const woken = await Promise.all([wake(s.id, '12:00'), wake(s.id, '12:00')]);
    expect(woken[0]! + woken[1]!).toBe(2);
    expect(await notices(s.id)).toHaveLength(60);
  });

  test('a Vendedor store: one message, and its outbox pass sends no second', async () => {
    const s = await store({ vendedor: true });
    await subscribe(s.host, phone(9));
    expect(await wake(s.id, '11:00')).toBe(1);
    while ((await outboxPass(sql, { lagMs: 0 })) === 200);
    await outboxPass(sql, { lagMs: 0 });
    const turns = await sql`select 1 from agent_mailbox where tenant_id = ${s.id}`;
    expect(turns).toHaveLength(0);
    expect(await notices(s.id)).toHaveLength(1);
  });
});
