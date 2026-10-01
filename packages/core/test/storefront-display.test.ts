import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import postgres from 'postgres';
import { createApp } from '../src/app.ts';
import { migrate } from '../src/platform/db.ts';
import { localParts } from '../src/platform/tz.ts';

// What Core serves so no client re-derives it: the store's head, hours and contacts, a line's
// price before it is added, kits' "a partir de", and the admin's view of the storefront.
describe.skipIf(!process.env.TEST_DATABASE_URL)('storefront display fields (db)', () => {
  const sql = postgres(process.env.TEST_DATABASE_URL!, { onnotice: () => {} });
  const codes = new Map<string, string>();
  const app = createApp({
    sql,
    sessionSecret: 's',
    controlSecret: 'ctl',
    autoDrain: false,
    cepLookup: async () => null,
    storeDomain: 'vendua.test',
    otpSender: async (phone, text) => {
      codes.set(phone, /(\d{6})/.exec(text)![1]!);
    },
  });
  const nonce = crypto.randomUUID().slice(0, 8);
  const slug = `sd-${nonce}`;
  const host = `${slug}.localhost`;
  const ownerPhone = `219${String(Date.now() + 71).slice(-8)}`;
  let tenantId = '';
  let idem = 0;
  const request = async (
    h: string,
    method: string,
    path: string,
    body?: unknown,
    headers: Record<string, string> = {},
  ) => {
    const res = await app.request(`http://${h}${path}`, {
      method,
      headers: {
        host: h,
        'content-type': 'application/json',
        ...(method === 'GET'
          ? {}
          : { 'idempotency-key': `${nonce}-${++idem}`, 'x-vendua-admin': '1' }),
        ...headers,
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
    return {
      status: res.status,
      body: (await res.json()) as any,
      cookie: res.headers.get('set-cookie'),
    };
  };
  const call = (method: string, path: string, body?: unknown, headers?: Record<string, string>) =>
    request(host, method, path, body, headers);
  let cookie = '';
  const admin = (method: string, path: string, body?: unknown) =>
    request('core.localhost', method, `/admin/v1${path}`, body, { cookie });
  const listed = async (id: string) =>
    (await call('GET', '/storefront/v1/catalog')).body.categories
      .flatMap((c: any) => c.products)
      .find((p: any) => p.id === id);

  const tz = 'America/Sao_Paulo';
  const today = localParts(new Date(), tz);
  const pad = (n: number) => String(n).padStart(2, '0');
  const isoDay = (offsetDays: number) => {
    const p = localParts(new Date(Date.now() + offsetDays * 86_400_000), tz);
    return `${p.year}-${pad(p.month)}-${pad(p.day)}`;
  };
  const tomorrow = (today.weekday + 1) % 7;
  const DAY_PLURAL = ['domingos', 'segundas', 'terças', 'quartas', 'quintas', 'sextas', 'sábados'];
  let categoryId = '';
  let acai = '';
  let acaiSlug = '';
  let size: { p: string; g: string } = { p: '', g: '' };

  beforeAll(async () => {
    await migrate(sql, join(import.meta.dir, '../db/migrations'));
    tenantId = (
      await sql<
        { id: string }[]
      >`insert into tenants (slug, name) values (${slug}, 'Doceria Teste') returning id`
    )[0]!.id;
    await sql`insert into domains (host, tenant_id) values (${host}, ${tenantId})`;
    // 00:00–00:00 runs past midnight: open at any minute, closing at the next local midnight
    await sql`
      insert into store_settings (tenant_id, hours, prep_time_minutes, min_order_cents, currency, vocabulary,
                                  tagline, whatsapp, instagram, logo_url, special_days)
      values (${tenantId}, ${sql.json({ timezone: tz, windows: [{ days: [0, 1, 2, 3, 4, 5, 6], open: '00:00', close: '00:00' }] })},
              25, 0, 'BRL', ${sql.json({})}, 'Doces de vó', '(22) 98144-8322', '@doce.ria',
              ${`/v1/media/${tenantId}/logo.webp`},
              ${sql.json([
                { date: isoDay(30), closed: true, label: 'Feriado' },
                { date: isoDay(-2), closed: true },
                { date: isoDay(0), closed: false, open: '00:00', close: '00:00', label: 'Hoje' },
                { date: isoDay(1), closed: false, open: '10:00', close: '14:00' },
              ])})
    `;
    await sql`insert into merchant_users (tenant_id, name, phone, role) values (${tenantId}, 'Ana', ${ownerPhone}, 'owner')`;
    await request('core.localhost', 'POST', '/admin/v1/auth/otp/start', { phone: ownerPhone });
    const r = await request('core.localhost', 'POST', '/admin/v1/auth/otp/verify', {
      phone: ownerPhone,
      code: codes.get(ownerPhone),
    });
    cookie = `vendua_admin=${/vendua_admin=([^;]+)/.exec(r.cookie ?? '')![1]!}`;
    categoryId = (await admin('POST', '/categories', { name: 'Doces' })).body.category.id;
    const created = (
      await admin('POST', '/products', { name: 'Açaí', categoryId, priceCents: 1500 })
    ).body.product;
    acai = created.id;
    acaiSlug = created.slug;
    const put = await admin('PUT', `/products/${acai}/options`, {
      groups: [
        {
          name: 'Tamanho',
          minSelect: 1,
          maxSelect: 1,
          options: [
            { name: '300 ml', priceDeltaCents: 100 },
            { name: '500 ml', priceDeltaCents: 400 },
          ],
        },
        {
          name: 'Extras',
          minSelect: 0,
          maxSelect: 3,
          options: [{ name: 'Leite em pó', priceDeltaCents: 250, maxQty: 2 }],
        },
      ],
    });
    expect(put.status).toBe(200);
    const opts = put.body.product.groups[0].options;
    size = { p: opts[0].id, g: opts[1].id };
  });

  afterAll(async () => {
    if (tenantId) await sql`delete from tenants where id = ${tenantId}`;
    await sql.end();
  });

  test('/store: closesAt, publicUrl, upcoming special days, contacts in their one form', async () => {
    const r = await call('GET', '/storefront/v1/store');
    expect(r.status).toBe(200);
    expect(r.body.status).toBe('open');
    expect(Date.parse(r.body.closesAt)).toBeGreaterThan(Date.now());
    // a dev host isn't public: the platform host, which the resolver routes too
    expect(r.body.publicUrl).toBe(`https://${slug}.vendua.test`);
    expect(r.body.hours.timezone).toBe(tz);
    expect(r.body.hours.specialDays).toEqual([
      { date: isoDay(0), closed: false, open: '00:00', close: '00:00', label: 'Hoje' },
      { date: isoDay(1), closed: false, open: '10:00', close: '14:00' },
      { date: isoDay(30), closed: true, label: 'Feriado' },
    ]);
    // a row written before 0072 reads through the same rule
    expect(r.body.whatsapp).toBe('5522981448322');
    expect(r.body.instagram).toBe('doce.ria');
  });

  test('/surfaces and /state carry closesAt; ?design=1 adds the head for the edge', async () => {
    const plain = await call('GET', '/storefront/v1/surfaces');
    expect(plain.body.store.status).toBe('open');
    expect(Date.parse(plain.body.store.closesAt)).toBeGreaterThan(Date.now());
    expect(plain.body.meta).toBeUndefined();
    const state = await call('GET', '/storefront/v1/state');
    expect(state.body.store.closesAt).toBe(plain.body.store.closesAt);

    const design = await call('GET', '/storefront/v1/surfaces?design=1');
    expect(design.body.meta).toEqual({
      title: 'Doceria Teste — Doces de vó',
      description: 'Doces de vó',
      image: `https://${slug}.vendua.test/v1/media/${tenantId}/logo.webp`,
      url: `https://${slug}.vendua.test`,
      siteName: 'Doceria Teste',
    });
    await sql`update store_settings set tagline = null, description = 'Feito à mão', logo_url = 'https://cdn.example/l.png' where tenant_id = ${tenantId}`;
    const bare = await call('GET', '/storefront/v1/surfaces?design=1');
    expect(bare.body.meta).toMatchObject({
      title: 'Doceria Teste',
      description: 'Feito à mão',
      image: 'https://cdn.example/l.png',
    });
  });

  test('line quote: priced by the same path add-to-cart freezes', async () => {
    const quote = (qs: string) => call('GET', `/storefront/v1/products/${acaiSlug}/quote?${qs}`);
    const extra = (await admin('GET', `/products/${acai}`)).body.product.groups[1].options[0].id;
    const q = await quote(`qty=2&modifiers=${size.g},${extra}:2`);
    expect(q.status).toBe(200);
    expect(q.body).toEqual({ qty: 2, unitPriceCents: 1500 + 400 + 500, lineTotalCents: 4800 });

    const missing = await quote('qty=1');
    expect(missing.status).toBe(422);
    expect(missing.body.error.code).toBe('MODIFIER_REQUIRED');
    for (const qs of ['qty=0', 'qty=100', 'qty=x', 'modifiers=nope', `modifiers=${size.g}:z`]) {
      const bad = await quote(qs);
      expect(bad.status).toBe(422);
      expect(bad.body.error.code).toBe('BAD_REQUEST');
    }
    expect((await quote(`modifiers=${crypto.randomUUID()}`)).body.error.code).toBe(
      'INVALID_MODIFIER',
    );
    const none = await call('GET', '/storefront/v1/products/nao-existe/quote');
    expect(none.status).toBe(404);
    expect(none.body.error.code).toBe('PRODUCT_NOT_FOUND');

    // add-to-cart answers what this call added, at the quote's price
    const session = await call('POST', '/checkout/v1/session');
    const auth = { authorization: `Bearer ${session.body.sessionToken}` };
    const add = (qty: number) =>
      call(
        'POST',
        '/checkout/v1/cart/items',
        { productId: acai, qty, modifiers: [{ id: size.g }, { id: extra, qty: 2 }] },
        auth,
      );
    const first = await add(2);
    expect(first.status).toBe(200);
    const line = first.body.cart.items[0];
    expect(first.body.added).toEqual({
      itemId: line.id,
      qty: 2,
      unitPriceCents: q.body.unitPriceCents,
      lineTotalCents: q.body.lineTotalCents,
    });
    expect(line.unitPriceCents).toBe(q.body.unitPriceCents);
    // merged into the same line after a price change: `added` is this call's quantity, at the
    // line's frozen price (checkout reprices), never a price the cart doesn't show
    await sql`update products set base_price_cents = 1700 where id = ${acai}`;
    const again = await add(1);
    expect(again.body.added).toEqual({
      itemId: line.id,
      qty: 1,
      unitPriceCents: 2400,
      lineTotalCents: 2400,
    });
    expect(again.body.cart.items[0]).toMatchObject({ qty: 3, unitPriceCents: 2400 });
    await sql`update products set base_price_cents = 1500 where id = ${acai}`;
  });

  test('kits: "a partir de" is the cheapest valid set of available picks', async () => {
    const make = async (name: string, priceCents: number) =>
      (await admin('POST', '/products', { name, categoryId, priceCents })).body.product.id;
    const [a, b, c, kit] = [
      await make('Brigadeiro', 300),
      await make('Beijinho', 300),
      await make('Trufa', 600),
      await make('Caixa 2 doces', 2000),
    ];
    const put = await admin('PUT', `/products/${kit}/kit`, {
      slots: [
        {
          name: 'Doces',
          minSelect: 2,
          maxSelect: 2,
          qtyPerItem: 1,
          items: [
            { productId: a, priceDeltaCents: 0 },
            { productId: b, priceDeltaCents: 150 },
            { productId: c, priceDeltaCents: 400 },
          ],
        },
      ],
    });
    expect(put.status).toBe(200);
    expect((await listed(kit)).fromPriceCents).toBe(2150);
    // the cheapest pick sells out: the next two set the floor
    await sql`update products set stock_quantity = 0 where id = ${a}`;
    const p = await listed(kit);
    expect(p.fromPriceCents).toBe(2550);
    const detail = (await call('GET', `/storefront/v1/products/${p.slug}`)).body.product;
    expect(detail.fromPriceCents).toBe(2550);
    const slotId = detail.comboSlots[0].id;
    const quote = await call(
      'GET',
      `/storefront/v1/products/${p.slug}/quote?combo=${slotId}:${b},${slotId}:${c}:1`,
    );
    expect(quote.body).toEqual({ qty: 1, unitPriceCents: 2550, lineTotalCents: 2550 });
    const soldOut = await call(
      'GET',
      `/storefront/v1/products/${p.slug}/quote?combo=${slotId}:${a},${slotId}:${b}`,
    );
    expect(soldOut.body.error.code).toBe('COMBO_ITEM_SOLD_OUT');
    // one pick left: the kit can't be filled, no from-price
    await sql`update products set stock_quantity = 0 where id = ${b}`;
    expect((await listed(kit)).fromPriceCents).toBeNull();
    await sql`update products set stock_quantity = null where id = any(${[a, b]}::uuid[])`;
  });

  test("admin catalog: Core's live status and low stock; the product's storefront face", async () => {
    await sql`update products set stock_quantity = 2, low_stock_threshold = 5 where id = ${acai}`;
    const make = async (name: string) =>
      (await admin('POST', '/products', { name, categoryId, priceCents: 900 })).body.product.id;
    const gone = await make('Esgotado');
    const old = await make('Antigo');
    await sql`update products set stock_quantity = 0 where id = ${gone}`;
    await sql`update products set status = 'archived' where id = ${old}`;
    const rows = (await admin('GET', '/catalog')).body.categories.flatMap((c: any) => c.products);
    const row = (id: string) => rows.find((p: any) => p.id === id);
    expect(row(acai)).toMatchObject({ status: 'active', liveStatus: 'active', lowStock: true });
    expect(row(gone)).toMatchObject({ status: 'active', liveStatus: 'sold_out', lowStock: false });
    expect(row(old)).toMatchObject({ status: 'archived', liveStatus: 'archived' });

    const detail = (await admin('GET', `/products/${acai}`)).body.product;
    expect(detail.storefront).toEqual({
      status: 'active',
      basePriceCents: 1500,
      compareAtPriceCents: null,
      fromPriceCents: 1600,
      promoLabel: null,
      availabilityLabel: null,
      lowStock: true,
      availabilityScheduleLabel: null,
      promoScheduleLabel: null,
    });
    // only tomorrow, and a promotion tomorrow: sold out now, both schedules in Core's words
    const patched = await admin('PATCH', `/products/${acai}`, {
      availabilitySchedule: { windows: [{ days: [tomorrow] }] },
      promoSchedule: {
        priceCents: 1200,
        windows: [{ days: [tomorrow], from: '18:00', to: '20:00' }],
      },
    });
    expect(patched.status).toBe(200);
    const label = `Só ${DAY_PLURAL[tomorrow]}`;
    expect(patched.body.product.storefront).toMatchObject({
      status: 'sold_out',
      basePriceCents: 1500,
      availabilityLabel: label,
      availabilityScheduleLabel: label,
      promoLabel: `${label}, 18h–20h`,
      promoScheduleLabel: `${label}, 18h–20h`,
    });
    // the storefront serves the very same face
    const shop = await listed(acai);
    expect(shop).toMatchObject({
      status: 'sold_out',
      availabilityLabel: label,
      promoLabel: `${label}, 18h–20h`,
      fromPriceCents: 1600,
      lowStock: true,
    });
    const archived = (await admin('GET', `/products/${old}`)).body.product.storefront;
    expect(archived.status).toBe('archived');
  });

  test('admin PATCH /store writes contacts in their one form', async () => {
    const ok = await admin('PATCH', '/store', {
      profile: {
        whatsapp: '+55 (21) 99999-0000',
        instagram: 'https://www.instagram.com/doce.ria/',
      },
    });
    expect(ok.status).toBe(200);
    expect(ok.body.profile).toMatchObject({ whatsapp: '5521999990000', instagram: 'doce.ria' });
    const row = (
      await sql`select whatsapp, instagram from store_settings where tenant_id = ${tenantId}`
    )[0]!;
    expect(row).toEqual({ whatsapp: '5521999990000', instagram: 'doce.ria' });
    for (const [field, value] of [
      ['whatsapp', '2299'],
      ['instagram', 'doce ria'],
    ] as const) {
      const bad = await admin('PATCH', '/store', { profile: { [field]: value } });
      expect(bad.status).toBe(422);
      expect(bad.body.error.details.field).toBe(field);
    }
    const cleared = await admin('PATCH', '/store', { profile: { whatsapp: '', instagram: null } });
    expect(cleared.body.profile).toMatchObject({ whatsapp: null, instagram: null });
  });

  test('migration 0072 backfills older rows to the same form, idempotently', async () => {
    const body = readFileSync(
      join(import.meta.dir, '../db/migrations/0072_store_contact_normalise.sql'),
      'utf8',
    );
    const cases: [string | null, string | null, string | null, string | null][] = [
      ['(22) 98144-8322', '5522981448322', '@doce.ria', 'doce.ria'],
      [
        '+55 22 98144-8322',
        '5522981448322',
        'https://www.instagram.com/doce.ria/?igshid=x',
        'doce.ria',
      ],
      ['022 3344-5566', '552233445566', 'instagram.com/doce.ria', 'doce.ria'],
      ['5522981448322', '5522981448322', 'doce.ria', 'doce.ria'],
      // not a handle once stripped: left as typed (the read side serves it as null)
      ['2299', '2299', '@', '@'],
      ['ramal 12', 'ramal 12', 'https://linktr.ee/doce', 'https://linktr.ee/doce'],
      [null, null, 'facebook.com/doce', 'facebook.com/doce'],
      [null, null, 'doce ria', 'doce ria'],
      [null, null, ' HTTP://Instagram.com/Doce ', 'Doce'],
    ];
    // a temporary store_settings shadows the real one in this transaction only: the
    // migration runs over these rows alone, never over other tests' stores
    const out = await sql.begin(async (tx) => {
      await tx`create temp table store_settings (tenant_id uuid primary key, whatsapp text, instagram text) on commit drop`;
      for (const [i, [w, , ig]] of cases.entries())
        await tx`insert into store_settings values (${`00000000-0000-4000-8000-${String(i).padStart(12, '0')}`}, ${w}, ${ig})`;
      await tx.unsafe(body);
      const once = await tx`select whatsapp, instagram from store_settings order by tenant_id`;
      await tx.unsafe(body);
      const twice = await tx`select whatsapp, instagram from store_settings order by tenant_id`;
      return { once: [...once], twice: [...twice] };
    });
    expect(out.once).toEqual(cases.map(([, whatsapp, , instagram]) => ({ whatsapp, instagram })));
    expect(out.twice).toEqual(out.once);
  });
});
