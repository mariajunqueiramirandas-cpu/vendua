import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { join } from 'node:path';
import postgres from 'postgres';
import { createApp } from '../src/app.ts';
import { migrate, withTenant } from '../src/platform/db.ts';
import {
  parsePlanPatch,
  prepareTodayTx,
  savePlanTx,
  statusCaption,
  statusDayPass,
  statusViewTx,
} from '../src/modules/status-do-dia.ts';

// Status do dia S0/S1 (0124): the day's Status prepared by Core, and a link's `ref` carried to
// the order so the owner sees what each post brought.

describe('status do dia: words and input', () => {
  test('the caption is the owner’s words or "Hoje tem …", then the link', () => {
    expect(statusCaption(null, ['Pão', 'Bolo', 'Café'], 'https://x.br/?ref=abc123')).toBe(
      'Hoje tem Pão, Bolo e Café 😋 Peça pelo link: https://x.br/?ref=abc123',
    );
    expect(statusCaption('  Saiu agora!  ', ['Pão'], 'https://x.br/?ref=abc123')).toBe(
      'Saiu agora! https://x.br/?ref=abc123',
    );
  });

  test('the plan’s fields are bounded; bad ones name their field', () => {
    expect(parsePlanPatch({ postAt: '07:05', days: [5, 1, 1], caption: '  ' })).toEqual({
      postAt: '07:05',
      days: [1, 5],
      caption: null,
    });
    for (const [body, field] of [
      [{ postAt: '25:00' }, 'postAt'],
      [{ days: [7] }, 'days'],
      [{ mode: 'x' }, 'mode'],
      [{ picks: ['nope'] }, 'picks'],
      [{ caption: 'x'.repeat(301) }, 'caption'],
      [{ enabled: 'yes' }, 'enabled'],
    ] as const) {
      try {
        parsePlanPatch(body as Record<string, unknown>);
        throw new Error('accepted');
      } catch (e) {
        expect((e as { details?: { field?: string } }).details?.field).toBe(field);
      }
    }
  });
});

describe.skipIf(!process.env.TEST_DATABASE_URL)('status do dia (db)', () => {
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
    const slug = `sd-${nonce}-${++n}`;
    const [t] = await sql<{ id: string }[]>`
      insert into tenants (slug, name) values (${slug}, ${'Padaria ' + n}) returning id`;
    ids.push(t!.id);
    const host = `${slug}.localhost`;
    await sql`insert into domains (host, tenant_id) values (${host}, ${t!.id})`;
    await sql`
      insert into store_settings (tenant_id, hours, prep_time_minutes, min_order_cents, currency, vocabulary)
      values (${t!.id}, ${sql.json({ timezone: 'America/Sao_Paulo', windows: [{ days: [0, 1, 2, 3, 4, 5, 6], open: '00:00', close: '00:00' }] })},
              25, 0, 'BRL', ${sql.json({})})`;
    const [cat] = await sql<{ id: string }[]>`
      insert into categories (tenant_id, slug, name) values (${t!.id}, 'paes', 'Pães') returning id`;
    const products: string[] = [];
    for (const [name, stock] of [
      ['Pão de queijo', null],
      ['Bolo de fubá', null],
      ['Café', null],
      ['Sonho', 0],
    ] as const) {
      const [p] = await sql<{ id: string }[]>`
        insert into products (tenant_id, category_id, slug, name, base_price_cents, stock_quantity)
        values (${t!.id}, ${cat!.id}, ${name.toLowerCase().replace(/\W+/g, '-')}, ${name}, 1290, ${stock})
        returning id`;
      products.push(p!.id);
    }
    return { id: t!.id, slug, host, products };
  };

  beforeAll(async () => {
    await migrate(sql, join(import.meta.dir, '../db/migrations'));
  });

  afterAll(async () => {
    if (ids.length) await sql`delete from tenants where id = any(${ids}::uuid[])`;
    if (appSql !== sql) await appSql.end();
    await sql.end();
  });

  test('today’s post: three products for sale now, one per day, priced by Core', async () => {
    const s = await store();
    const t = { id: s.id, slug: s.slug, name: 'Padaria' };
    const first = await withTenant(sql, s.id, (tx) => prepareTodayTx(tx, t, 'vendua.test'));
    const again = await withTenant(sql, s.id, (tx) => prepareTodayTx(tx, t, 'vendua.test'));
    expect(again).toBe(first);
    const view = await withTenant(sql, s.id, (tx) => statusViewTx(tx, t, 'vendua.test'));
    const names = view.today!.products.map((p) => p.name);
    // sold out (stock 0) never makes it
    expect(names).toHaveLength(3);
    expect(names).not.toContain('Sonho');
    expect(view.today!.products[0]!.priceLabel).toMatch(/^R\$\s?12,90$/);
    expect(view.today!.caption).toContain(`?ref=${view.today!.ref}`);
    expect(view.today!.products[0]!.url).toContain(`?ref=${view.today!.ref}`);
  });

  test('a pinned pick comes first; the sweep prepares only when due', async () => {
    const s = await store();
    await withTenant(sql, s.id, (tx) =>
      savePlanTx(tx, s.id, {
        enabled: true,
        mode: 'pinned',
        picks: [s.products[2]!],
        postAt: '23:59',
      }),
    );
    // the hour hasn't come (unless the test runs at 23:59 São Paulo)
    const early = new Date('2026-10-13T12:00:00-03:00');
    expect(await statusDayPass(sql, s.id, early)).toBeNull();
    await withTenant(sql, s.id, (tx) => savePlanTx(tx, s.id, { postAt: '00:00' }));
    const post = await statusDayPass(sql, s.id, early);
    expect(post?.products).toBe(3);
    const [row] = await sql<{ product_ids: string[] }[]>`
      select product_ids from status_posts where id = ${post!.id}`;
    expect(row!.product_ids[0]).toBe(s.products[2]!);
    expect(await statusDayPass(sql, s.id, early)).toBeNull();
    await withTenant(sql, s.id, (tx) => savePlanTx(tx, s.id, { enabled: false }));
  });

  test('a link’s ref rides to the order; a bad one is dropped, never a 4xx', async () => {
    const s = await store();
    const place = async (ref: unknown) => {
      const session = await call(s.host, 'POST', '/checkout/v1/session');
      const auth = { authorization: `Bearer ${session.body.sessionToken}` };
      await call(
        s.host,
        'POST',
        '/checkout/v1/cart/items',
        { productId: s.products[0], qty: 1 },
        auth,
      );
      const r = await call(
        s.host,
        'POST',
        '/checkout/v1/checkout',
        {
          customer: { name: 'Bia', phone: '21988887777' },
          delivery: { mode: 'pickup' },
          payment: { method: 'cash' },
          ref,
        },
        auth,
      );
      expect(r.status).toBe(201);
      const [o] = await sql<
        { ref: string | null }[]
      >`select ref from orders where id = ${r.body.order.id}`;
      return o!.ref;
    };
    expect(await place('abc123xyz')).toBe('abc123xyz');
    expect(await place('<script>')).toBeNull();
    expect(await place(42)).toBeNull();
  });
});
