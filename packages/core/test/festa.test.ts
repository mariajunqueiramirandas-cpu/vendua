import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { join } from 'node:path';
import postgres from 'postgres';
import { createApp } from '../src/app.ts';
import { capacityOn, parseCapacity } from '../src/modules/encomenda-capacity.ts';
import { eveReminderPass } from '../src/modules/party.ts';
import { migrate, withTenant } from '../src/platform/db.ts';
import { partyTool } from '../src/agent-host/agents/vendedor/tools-party.ts';

// Festa calculada F0 + F1 (0126): party profiles turn guests into an ordinary cart, a day's
// encomendas have a ceiling checkout enforces, and the day before the store says so.

describe('encomenda capacity: rules', () => {
  test('a date’s own entry wins over its weekday; null is no ceiling', () => {
    const cap = { days: [null, 2, 2, 2, 2, 3, 4], dates: { '2026-11-14': 1, '2026-11-15': null } };
    // 2026-11-14 is a Saturday (weekday 6 → 4), its date says 1
    expect(capacityOn(cap, '2026-11-14')).toBe(1);
    expect(capacityOn(cap, '2026-11-21')).toBe(4);
    // Sunday has none; a date can lift a weekday's
    expect(capacityOn(cap, '2026-11-15')).toBeNull();
    expect(capacityOn(null, '2026-11-14')).toBeNull();
  });

  test('bad input names the field', () => {
    for (const v of [[1], { days: [1, 2] }, { days: [1, 2, 3, 4, 5, 6, -1] }, { dates: { x: 1 } }])
      expect(() => parseCapacity(v)).toThrow();
    expect(parseCapacity({ days: [null, 1, 1, 1, 1, 1, 1] })).toEqual({
      days: [null, 1, 1, 1, 1, 1, 1],
    });
  });
});

describe.skipIf(!process.env.TEST_DATABASE_URL)('festa calculada (db)', () => {
  const sql = postgres(process.env.TEST_DATABASE_URL!, { onnotice: () => {} });
  const appSql = process.env.TEST_APP_DATABASE_URL
    ? postgres(process.env.TEST_APP_DATABASE_URL, { onnotice: () => {} })
    : sql;
  const app = createApp({
    sql: appSql,
    sessionSecret: 's',
    controlSecret: 'ctl',
    cepLookup: async () => null,
    otpSender: async () => {},
  });
  const nonce = crypto.randomUUID().slice(0, 8);
  const ids: string[] = [];
  let idem = 0;
  let n = 0;

  const call = async (host: string, method: string, path: string, body?: unknown, h = {}) => {
    const res = await app.request(`http://${host}${path}`, {
      method,
      headers: {
        host,
        'content-type': 'application/json',
        ...(method === 'GET' ? {} : { 'idempotency-key': `${nonce}-${++idem}` }),
        ...h,
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
    return { status: res.status, body: (await res.json()) as any };
  };

  const store = async () => {
    const slug = `fe-${nonce}-${++n}`;
    const [t] = await sql<{ id: string }[]>`
      insert into tenants (slug, name) values (${slug}, ${'Doceria ' + n}) returning id`;
    ids.push(t!.id);
    const host = `${slug}.localhost`;
    await sql`insert into domains (host, tenant_id) values (${host}, ${t!.id})`;
    await sql`
      insert into store_settings (tenant_id, hours, prep_time_minutes, min_order_cents, currency,
                                  vocabulary, preorder_payment_methods)
      values (${t!.id}, ${sql.json({ timezone: 'America/Sao_Paulo', windows: [{ days: [0, 1, 2, 3, 4, 5, 6], open: '00:00', close: '00:00' }] })},
              25, 0, 'BRL', ${sql.json({})}, ${sql.json(['cash'])})`;
    const [cat] = await sql<{ id: string }[]>`
      insert into categories (tenant_id, slug, name) values (${t!.id}, 'festa', 'Festa') returning id`;
    const p: Record<string, string> = {};
    for (const [key, name, price] of [
      ['coxinha', 'Coxinha (cento)', 9000],
      ['kibe', 'Kibe (cento)', 8500],
      ['brigadeiro', 'Brigadeiro (cento)', 12000],
      ['bolo', 'Bolo para 25', 15000],
    ] as const) {
      const [row] = await sql<{ id: string }[]>`
        insert into products (tenant_id, category_id, slug, name, base_price_cents)
        values (${t!.id}, ${cat!.id}, ${key}, ${name}, ${price}) returning id`;
      p[key] = row!.id;
    }
    const [prof] = await sql<{ id: string }[]>`
      insert into party_profiles (tenant_id, name, child_factor_bps, min_guests, max_guests)
      values (${t!.id}, 'Aniversário', 5000, 10, 300) returning id`;
    let sort = 0;
    const group = async (name: string, milli: number, picks: [string, number][]) => {
      const [g] = await sql<{ id: string }[]>`
        insert into party_groups (tenant_id, profile_id, name, per_guest_milli, max_choices, sort)
        values (${t!.id}, ${prof!.id}, ${name}, ${milli}, 3, ${sort++}) returning id`;
      for (const [key, units] of picks)
        await sql`
          insert into party_group_products (tenant_id, profile_id, group_id, product_id, units_per_sale)
          values (${t!.id}, ${prof!.id}, ${g!.id}, ${p[key]!}, ${units})`;
      return g!.id;
    };
    const salgados = await group('Salgados', 15000, [
      ['coxinha', 100],
      ['kibe', 100],
    ]);
    const doces = await group('Docinhos', 4000, [['brigadeiro', 100]]);
    const bolo = await group('Bolo', 1000, [['bolo', 25]]);
    return { id: t!.id, host, p, profileId: prof!.id, salgados, doces, bolo };
  };

  const session = async (host: string) => {
    const s = await call(host, 'POST', '/checkout/v1/session');
    return { authorization: `Bearer ${s.body.sessionToken}` };
  };

  beforeAll(async () => {
    await migrate(sql, join(import.meta.dir, '../db/migrations'));
  });

  afterAll(async () => {
    if (ids.length) await sql`delete from tenants where id = any(${ids}::uuid[])`;
    if (appSql !== sql) await appSql.end();
    await sql.end();
  });

  test('the shopper sees the active profiles; the quote rounds up to whole sales', async () => {
    const s = await store();
    const menu = await call(s.host, 'GET', '/storefront/v1/party');
    expect(menu.status).toBe(200);
    expect(menu.body.profiles).toHaveLength(1);
    expect(menu.body.profiles[0].groups.map((g: any) => g.name)).toEqual([
      'Salgados',
      'Docinhos',
      'Bolo',
    ]);
    const q = await call(s.host, 'POST', '/checkout/v1/party/quote', {
      profileId: s.profileId,
      adults: 30,
      children: 20,
      choices: {
        [s.salgados]: [s.p.coxinha, s.p.kibe],
        [s.doces]: [s.p.brigadeiro],
        [s.bolo]: [s.p.bolo],
      },
    });
    expect(q.status).toBe(200);
    // 30 adults + 20 children at half = 40 guests: 600 salgados, 160 docinhos, 40 slices
    expect(q.body.quote.guests).toBe(40);
    expect(q.body.quote.lines.map((l: any) => [l.name, l.qty, l.units])).toEqual([
      ['Coxinha (cento)', 3, 300],
      ['Kibe (cento)', 3, 300],
      ['Brigadeiro (cento)', 2, 200],
      ['Bolo para 25', 2, 50],
    ]);
    expect(q.body.quote.lines[0].reason).toBe('300 de 600 salgados · 3 × 100');
  });

  test('a product that asks for a choice never reaches the calculator', async () => {
    const s = await store();
    await sql`insert into modifier_groups (tenant_id, product_id, name, required, min_select, max_select)
              values (${s.id}, ${s.p.kibe!}, 'Recheio', true, 1, 1)`;
    const menu = await call(s.host, 'GET', '/storefront/v1/party');
    const salgados = menu.body.profiles[0].groups.find((g: any) => g.id === s.salgados);
    expect(salgados.products.map((x: any) => x.productId)).toEqual([s.p.coxinha]);
    const q = await call(s.host, 'POST', '/checkout/v1/party/quote', {
      profileId: s.profileId,
      adults: 20,
      choices: { [s.salgados]: [s.p.kibe], [s.doces]: [s.p.brigadeiro], [s.bolo]: [s.p.bolo] },
    });
    expect([q.status, q.body.error.code]).toEqual([422, 'INVALID_PARTY']);
  });

  test('bad quotes are stable 4xx', async () => {
    const s = await store();
    const base = {
      profileId: s.profileId,
      adults: 30,
      children: 0,
      choices: { [s.salgados]: [s.p.coxinha], [s.doces]: [s.p.brigadeiro], [s.bolo]: [s.p.bolo] },
    };
    const quote = (b: unknown) => call(s.host, 'POST', '/checkout/v1/party/quote', b);
    expect((await quote({ ...base, adults: 2 })).body.error.code).toBe('INVALID_PARTY');
    expect((await quote({ ...base, profileId: 'nope' })).body.error.code).toBe('INVALID_PARTY');
    expect((await quote({ ...base, profileId: crypto.randomUUID() })).status).toBe(404);
    // a required group left empty
    const { [s.bolo]: _drop, ...noCake } = base.choices;
    expect((await quote({ ...base, choices: noCake })).body.error.details.groupId).toBe(s.bolo);
    // a product from another group
    expect(
      (await quote({ ...base, choices: { ...base.choices, [s.bolo]: [s.p.coxinha] } })).body.error
        .code,
    ).toBe('INVALID_PARTY');
    // 300 guests × 15 salgados in one product = 45 centos fits; 50 per guest doesn't
    await sql`update party_groups set per_guest_milli = 50000 where id = ${s.salgados}`;
    const big = await quote({ ...base, adults: 300 });
    expect([big.status, big.body.error.code]).toEqual([422, 'PARTY_TOO_BIG']);
  });

  test('the cart becomes the party, needs a date, and the order freezes its units', async () => {
    const s = await store();
    const auth = await session(s.host);
    await call(s.host, 'POST', '/checkout/v1/cart/items', { productId: s.p.kibe, qty: 1 }, auth);
    const built = await call(
      s.host,
      'POST',
      '/checkout/v1/cart/party',
      {
        profileId: s.profileId,
        adults: 40,
        choices: { [s.salgados]: [s.p.coxinha], [s.doces]: [s.p.brigadeiro], [s.bolo]: [s.p.bolo] },
      },
      auth,
    );
    expect(built.status).toBe(200);
    // what was in the bag gave way to the party
    const lines = built.body.cart.items.map((i: any) => [i.productId, i.qty]);
    expect(lines).toHaveLength(3);
    expect(lines).toEqual(
      expect.arrayContaining([
        [s.p.coxinha, 6],
        [s.p.brigadeiro, 2],
        [s.p.bolo, 2],
      ]),
    );
    expect(built.body.cart.party).toEqual({ profileId: s.profileId, adults: 40, children: 0 });
    expect(built.body.cart.schedule.required).toBe(true);
    // Core's money: 6 × 90 + 2 × 120 + 2 × 150
    expect(built.body.cart.totals.subtotalCents).toBe(108_000);
    const order = {
      customer: { name: 'Bia', phone: '21988887777' },
      delivery: { mode: 'pickup' },
      payment: { method: 'cash' },
    };
    const noDate = await call(s.host, 'POST', '/checkout/v1/checkout', order, auth);
    expect(noDate.body.error.code).toBe('SCHEDULE_REQUIRED');
    const date = built.body.cart.schedule.dates[3];
    const ok = await call(
      s.host,
      'POST',
      '/checkout/v1/checkout',
      { ...order, scheduledFor: date },
      auth,
    );
    expect(ok.status).toBe(201);
    const [row] = await sql<
      { party: any }[]
    >`select party from orders where id = ${ok.body.order.id}`;
    expect(row!.party.groups).toEqual(
      expect.arrayContaining([
        { groupId: s.salgados, units: 600 },
        { groupId: s.doces, units: 200 },
        { groupId: s.bolo, units: 50 },
      ]),
    );
  });

  test('a full day leaves the dates and checkout refuses it: orders a day, pieces a day', async () => {
    const s = await store();
    const place = async (date?: string) => {
      const auth = await session(s.host);
      const b = await call(
        s.host,
        'POST',
        '/checkout/v1/cart/party',
        {
          profileId: s.profileId,
          adults: 20,
          choices: {
            [s.salgados]: [s.p.coxinha],
            [s.doces]: [s.p.brigadeiro],
            [s.bolo]: [s.p.bolo],
          },
        },
        auth,
      );
      const day = date ?? b.body.cart.schedule.dates[2];
      const r = await call(
        s.host,
        'POST',
        '/checkout/v1/checkout',
        {
          customer: { name: 'Bia', phone: '21988887777' },
          delivery: { mode: 'pickup' },
          payment: { method: 'cash' },
          scheduledFor: day,
        },
        auth,
      );
      return { r, day, dates: b.body.cart.schedule.dates as string[] };
    };
    const first = await place();
    expect(first.r.status).toBe(201);
    // that date takes one order
    await sql`update store_settings set encomenda_capacity = ${sql.json({ dates: { [first.day]: 1 } })}
              where tenant_id = ${s.id}`;
    const second = await place(first.day);
    expect(second.dates).not.toContain(first.day);
    expect([second.r.status, second.r.body.error.code]).toEqual([409, 'DATE_FULL']);
    // pieces a day: 300 salgados were booked on the next date; a ceiling of 500 refuses 300 more
    await sql`update store_settings set encomenda_capacity = null where tenant_id = ${s.id}`;
    await sql`update party_groups set daily_cap_units = 500 where id = ${s.salgados}`;
    const day = first.dates[4]!;
    expect((await place(day)).r.status).toBe(201);
    const over = await place(day);
    expect([over.r.status, over.r.body.error.details.groupId]).toEqual([409, s.salgados]);
  });

  test('the Vendedor lists the parties and quotes with Core’s numbers', async () => {
    const s = await store();
    const book = new Map<string, { kind: string; id: string }>();
    const ctx = (tx: unknown) =>
      ({
        tx,
        tenantId: s.id,
        alias: (kind: string, id: string) => {
          for (const [a, v] of book) if (v.kind === kind && v.id === id) return a;
          const a = `${kind[0]}${book.size + 1}`;
          book.set(a, { kind, id });
          return a;
        },
        resolve: (a: string, kind: string) => {
          const v = book.get(a);
          if (!v || v.kind !== kind) throw new Error(`unknown ${a}`);
          return v.id;
        },
      }) as never;
    const run = (input: unknown) =>
      withTenant(sql, s.id, (tx) => (partyTool as any).run(ctx(tx), input)) as Promise<{
        content: string;
      }>;
    const opts = await run({ action: 'options' });
    expect(opts.content).toContain('Aniversário (10–300 pessoas; criança conta 50%)');
    const alias = (kind: string, id: string) =>
      [...book].find(([, v]) => v.kind === kind && v.id === id)![0];
    const q = await run({
      action: 'quote',
      festa: alias('festa', s.profileId),
      adults: 40,
      picks: [
        { group: alias('grupo', s.salgados), products: [alias('product', s.p.coxinha!)] },
        { group: alias('grupo', s.doces), products: [alias('product', s.p.brigadeiro!)] },
        { group: alias('grupo', s.bolo), products: [alias('product', s.p.bolo!)] },
      ],
    });
    expect(q.content).toContain('Para 40 pessoas:');
    expect(q.content).toContain('6× ');
    expect(q.content).toContain('(600 salgados · 6 × 100)');
  });

  test('the day before, the store reminds each encomenda once', async () => {
    const s = await store();
    await sql`insert into store_whatsapp (tenant_id, wanted, state) values (${s.id}, true, 'open')`;
    const auth = await session(s.host);
    const b = await call(
      s.host,
      'POST',
      '/checkout/v1/cart/party',
      {
        profileId: s.profileId,
        adults: 20,
        choices: { [s.salgados]: [s.p.coxinha], [s.doces]: [s.p.brigadeiro], [s.bolo]: [s.p.bolo] },
      },
      auth,
    );
    const day = b.body.cart.schedule.dates[2] as string;
    const ok = await call(
      s.host,
      'POST',
      '/checkout/v1/checkout',
      {
        customer: { name: 'Bia Souza', phone: '21988887777' },
        delivery: { mode: 'pickup' },
        payment: { method: 'cash' },
        scheduledFor: day,
      },
      auth,
    );
    expect(ok.status).toBe(201);
    await sql`update orders set placed_at = now() - interval '2 days' where id = ${ok.body.order.id}`;
    // 10h São Paulo on the day before
    const eve = new Date(`${day}T13:00:00Z`);
    eve.setUTCDate(eve.getUTCDate() - 1);
    const early = new Date(eve.getTime() - 3 * 3600_000);
    expect(await eveReminderPass(sql, s.id, early)).toBe(0);
    expect(await eveReminderPass(sql, s.id, eve)).toBe(1);
    expect(await eveReminderPass(sql, s.id, eve)).toBe(0);
    const [m] = await sql<{ body: string }[]>`
      select body from store_wa_messages where order_id = ${ok.body.order.id} and event = 'reminder_eve'`;
    expect(m!.body).toContain(`Oi, Bia! Amanhã (${day.slice(8, 10)}/${day.slice(5, 7)})`);
    // the store can turn it off
    await sql`update store_settings set encomenda_reminder = false where tenant_id = ${s.id}`;
    await sql`delete from store_wa_messages where order_id = ${ok.body.order.id} and event = 'reminder_eve'`;
    expect(await eveReminderPass(sql, s.id, eve)).toBe(0);
  });
});
