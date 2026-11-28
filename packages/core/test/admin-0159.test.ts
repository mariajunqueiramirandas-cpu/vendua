import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { join } from 'node:path';
import postgres from 'postgres';
import { createApp } from '../src/app.ts';
import { migrate } from '../src/platform/db.ts';

// 0159 in the merchant admin: blocked dates and vehicle extras on the store, how a product is sold
// and how it travels, a copy in another category, and the bulk changes a category's "ajustar" runs.
describe.skipIf(!process.env.TEST_DATABASE_URL)(
  'admin: 0159 settings and category tools (db)',
  () => {
    const sql = postgres(process.env.TEST_DATABASE_URL!, { onnotice: () => {} });
    const codes = new Map<string, string>();
    const app = createApp({
      sql,
      sessionSecret: 's',
      controlSecret: 'ctl',
      cepLookup: async () => null,
      otpSender: async (phone, text) => {
        codes.set(phone, /(\d{6})/.exec(text)![1]!);
      },
    });
    const nonce = crypto.randomUUID().slice(0, 8);
    const slug = `a58-${nonce}`;
    const ownerPhone = `218${String(Date.now()).slice(-8)}`;
    let tenantId = '';
    let doces = '';
    let bebidas = '';
    let idem = 0;
    let owner: (m: string, p: string, b?: unknown) => Promise<{ status: number; body: any }>;

    const call = async (
      method: string,
      path: string,
      body?: unknown,
      h: Record<string, string> = {},
    ) => {
      const res = await app.request(`http://core.localhost${path}`, {
        method,
        headers: {
          host: 'core.localhost',
          'content-type': 'application/json',
          ...(method === 'GET'
            ? {}
            : { 'idempotency-key': `${nonce}-${++idem}`, 'x-vendua-admin': '1' }),
          ...h,
        },
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      });
      return {
        status: res.status,
        body: (await res.json()) as any,
        cookie: res.headers.get('set-cookie'),
      };
    };

    const product = async (s: string, cat: string, extra: Record<string, unknown> = {}) =>
      (
        await sql<{ id: string }[]>`
        insert into products ${sql({ tenant_id: tenantId, category_id: cat, slug: s, name: s, base_price_cents: 1000, ...extra } as never)}
        returning id`
      )[0]!.id;

    beforeAll(async () => {
      await migrate(sql, join(import.meta.dir, '../db/migrations'));
      tenantId = (
        await sql<
          { id: string }[]
        >`insert into tenants (slug, name) values (${slug}, ${slug}) returning id`
      )[0]!.id;
      await sql`
      insert into store_settings (tenant_id, hours, prep_time_minutes, min_order_cents, currency, vocabulary)
      values (${tenantId}, ${sql.json({ timezone: 'America/Sao_Paulo', windows: [] })}, 25, 0, 'BRL', ${sql.json({})})`;
      const cat = async (s: string, sort: number) =>
        (
          await sql<{ id: string }[]>`
          insert into categories (tenant_id, slug, name, sort) values (${tenantId}, ${s}, ${s}, ${sort}) returning id`
        )[0]!.id;
      doces = await cat('doces', 0);
      bebidas = await cat('bebidas', 1);
      await sql`insert into merchant_users (tenant_id, name, phone, role) values (${tenantId}, 'Dona', ${ownerPhone}, 'owner')`;
      await call('POST', '/admin/v1/auth/otp/start', { phone: ownerPhone });
      const r = await call('POST', '/admin/v1/auth/otp/verify', {
        phone: ownerPhone,
        code: codes.get(ownerPhone),
      });
      const cookie = `vendua_admin=${/vendua_admin=([^;]+)/.exec(r.cookie ?? '')![1]!}`;
      owner = (m, p, b) => call(m, `/admin/v1${p}`, b, { cookie });
    });

    afterAll(async () => {
      if (tenantId) await sql`delete from tenants where id = ${tenantId}`;
      await sql.end();
    });

    test('the store: blocked dates (past ones dropped) and vehicle extras', async () => {
      const r = await owner('PATCH', '/store', {
        preorder: { blockedDates: ['2099-12-25', '2000-01-01', '2099-12-24', '2099-12-25'] },
        vehicleFees: { car: 1500, moto: null },
      });
      expect(r.status).toBe(200);
      expect(r.body.preorder.blockedDates).toEqual(['2099-12-24', '2099-12-25']);
      expect(r.body.vehicleFees).toEqual({ car: 1500 });
      expect(
        (await owner('PATCH', '/store', { preorder: { blockedDates: ['25/12'] } })).status,
      ).toBe(422);
      expect((await owner('PATCH', '/store', { vehicleFees: { bike: 100 } })).status).toBe(422);
    });

    test('a product: sold past its stock, travels by car; sold out by stock it stays on sale', async () => {
      const id = await product('bolo', doces, { stock_quantity: 0 });
      const r = await owner('PATCH', `/products/${id}`, {
        preorderWhenSoldOut: true,
        preorderLeadDays: 2,
        deliveryVehicle: 'car',
      });
      expect(r.status).toBe(200);
      expect(r.body.product).toMatchObject({
        preorderWhenSoldOut: true,
        preorderLeadDays: 2,
        deliveryVehicle: 'car',
        stockQuantity: 0,
        liveStatus: 'active',
      });
      expect((await owner('PATCH', `/products/${id}`, { deliveryVehicle: 'truck' })).status).toBe(
        422,
      );
    });

    test('a copy in another category keeps the name, the status and the options', async () => {
      const id = await product('pudim', doces);
      await sql`insert into modifier_groups (tenant_id, product_id, name) values (${tenantId}, ${id}, 'Calda')`;
      const there = await owner('POST', `/products/${id}/duplicate`, { categoryId: bebidas });
      expect(there.status).toBe(201);
      expect(there.body.product).toMatchObject({
        name: 'pudim',
        categoryId: bebidas,
        status: 'active',
      });
      expect(there.body.product.groups).toHaveLength(1);
      // no body, as before: beside the original, hidden, "(cópia)"
      const here = await owner('POST', `/products/${id}/duplicate`);
      expect(here.status).toBe(201);
      expect(here.body.product).toMatchObject({
        name: 'pudim (cópia)',
        categoryId: doces,
        status: 'archived',
      });
      expect(
        (await owner('POST', `/products/${id}/duplicate`, { categoryId: crypto.randomUUID() }))
          .status,
      ).toBe(404);
    });

    test("a category's ajustar: encomenda and transporte for all, each one undone", async () => {
      const a = await product('brigadeiro', doces, { delivery_vehicle: 'moto' });
      const b = await product('beijinho', doces, {
        requires_preorder: true,
        preorder_lead_days: 3,
      });
      const ids = [a, b];
      const pre = await owner('POST', '/products/bulk', {
        ids,
        action: 'preorder',
        mode: 'when_sold_out',
        leadDays: 1,
      });
      expect(pre.status).toBe(200);
      expect(pre.body.updated).toBe(2);
      const rows = async () =>
        sql<{ id: string; r: boolean; w: boolean; d: number; v: string | null }[]>`
        select id, requires_preorder as r, preorder_when_sold_out as w, preorder_lead_days as d,
               delivery_vehicle as v
        from products where id = any(${ids}::uuid[]) order by slug`;
      expect((await rows()).map(({ r, w, d }) => ({ r, w, d }))).toEqual([
        { r: false, w: true, d: 1 },
        { r: false, w: true, d: 1 },
      ]);
      expect(
        (await owner('POST', '/products/bulk', { action: 'revert', items: pre.body.before }))
          .status,
      ).toBe(200);
      expect((await rows()).map(({ r, w, d }) => ({ r, w, d }))).toEqual([
        { r: true, w: false, d: 3 },
        { r: false, w: false, d: 0 },
      ]);

      const car = await owner('POST', '/products/bulk', {
        ids,
        action: 'vehicle',
        deliveryVehicle: 'car',
      });
      expect((await rows()).map((x) => x.v)).toEqual(['car', 'car']);
      await owner('POST', '/products/bulk', { action: 'revert', items: car.body.before });
      expect((await rows()).map((x) => x.v)).toEqual([null, 'moto']);
      expect(
        (await owner('POST', '/products/bulk', { ids, action: 'preorder', mode: 'sometimes' }))
          .status,
      ).toBe(422);
    });

    test('copy several to another category; the undo deletes the copies', async () => {
      const ids = [await product('cafe', doces), await product('cha', doces)];
      const r = await owner('POST', '/products/bulk', { ids, action: 'copy', categoryId: bebidas });
      expect(r.status).toBe(200);
      expect(r.body.created).toHaveLength(2);
      const copies = await sql<{ name: string; category_id: string }[]>`
      select name, category_id from products where id = any(${r.body.created as string[]}::uuid[]) order by name`;
      expect([...copies]).toEqual([
        { name: 'cafe', category_id: bebidas },
        { name: 'cha', category_id: bebidas },
      ]);
      const undo = await owner('POST', '/products/bulk', { ids: r.body.created, action: 'delete' });
      expect(undo.body.updated).toBe(2);
    });
  },
);
