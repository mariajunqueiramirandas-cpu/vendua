import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { join } from 'node:path';
import postgres from 'postgres';
import fixture from './fixtures/menu-import/instadelivery.json';
import { createApp } from '../src/app.ts';
import { migrate } from '../src/platform/db.ts';
import { runImages, runReads, sweepImports } from '../src/modules/menu-import/jobs.ts';

// Menu import end to end on the test database (docs/menu-import.md §8): paste → read →
// preview → apply (add and replace) → photos re-hosted; tenancy, idempotency, expiry, limits.
// The platform is a fake fetch serving the synthetic fixture — no live calls.
describe.skipIf(!process.env.TEST_DATABASE_URL)('menu import (db)', () => {
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
  const stamp = String(Date.now()).slice(-7);
  const phones = { owner: `2191${stamp}`, manager: `2192${stamp}`, other: `2193${stamp}` };
  const tenants: string[] = [];
  let tenantId = '';
  let idem = 0;

  // 1×1 PNG: decodable by the real image pipeline
  const png = Uint8Array.from(
    atob(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
    ),
    (c) => c.charCodeAt(0),
  );
  const API = 'https://app.instadelivery.com.br/api/stores/by-slug/';
  const hits: string[] = [];
  const fakeFetch = async (url: string): Promise<Response> => {
    hits.push(url);
    if (url === `${API}doceriaexemplo` || url === `${API}outraloja`)
      return new Response(JSON.stringify(fixture), {
        headers: { 'content-type': 'application/json' },
      });
    if (url.startsWith(API)) return new Response('{"message":"not found"}', { status: 404 });
    if (url.endsWith('/exemplo-10.jpeg')) return new Response('gone', { status: 404 });
    if (url.startsWith('https://instadelivery-public.nyc3.cdn.digitaloceanspaces.com/'))
      return new Response(png, { headers: { 'content-type': 'image/png' } });
    return new Response('?', { status: 500 });
  };
  const deps = { sql, fetch: fakeFetch };

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
  const signIn = async (phone: string) => {
    await call('POST', '/admin/v1/auth/otp/start', { phone });
    const r = await call('POST', '/admin/v1/auth/otp/verify', { phone, code: codes.get(phone) });
    expect(r.body.signedIn).toBe(true);
    const cookie = `vendua_admin=${/vendua_admin=([^;]+)/.exec(r.cookie ?? '')![1]!}`;
    return (method: string, path: string, body?: unknown, h: Record<string, string> = {}) =>
      call(method, `/admin/v1${path}`, body, { cookie, ...h });
  };
  type As = Awaited<ReturnType<typeof signIn>>;
  let owner: As;
  let manager: As;
  let stranger: As;

  const newTenant = async (slug: string) => {
    const id = (
      await sql<
        { id: string }[]
      >`insert into tenants (slug, name) values (${slug}, 'Loja nova') returning id`
    )[0]!.id;
    tenants.push(id);
    await sql`insert into domains (host, tenant_id) values (${`${slug}.localhost`}, ${id})`;
    await sql`
      insert into store_settings (tenant_id, hours, prep_time_minutes, min_order_cents, currency, vocabulary)
      values (${id}, ${sql.json({ timezone: 'America/Sao_Paulo', windows: [] })}, 30, 0, 'BRL', ${sql.json({})})
    `;
    await sql`
      insert into storefront_templates (tenant_id, page, version, template, source)
      values (${id}, 'home', 1, ${sql.json({
        version: 1,
        page: 'home',
        sections: [
          { id: 'hero', type: 'store:menu-hero' },
          { id: 'menu', type: 'store:menu' },
        ],
      })}, 'seed')
    `;
    return id;
  };

  beforeAll(async () => {
    await migrate(sql, join(import.meta.dir, '../db/migrations'));
    tenantId = await newTenant(`mi-${nonce}`);
    const otherId = await newTenant(`mi2-${nonce}`);
    await sql`insert into merchant_users (tenant_id, name, phone, role) values (${tenantId}, 'Dona', ${phones.owner}, 'owner')`;
    await sql`insert into merchant_users (tenant_id, name, phone, role) values (${tenantId}, 'Gerente', ${phones.manager}, 'manager')`;
    await sql`insert into merchant_users (tenant_id, name, phone, role) values (${otherId}, 'Outra', ${phones.other}, 'owner')`;
    owner = await signIn(phones.owner);
    manager = await signIn(phones.manager);
    stranger = await signIn(phones.other);
    // a product the merchant already had, to see "add" keep it and "replace" archive it
    const cat = (
      await sql<{ id: string }[]>`
        insert into categories (tenant_id, slug, name, sort) values (${tenantId}, 'bolos', 'Bolos', 0) returning id
      `
    )[0]!.id;
    await sql`
      insert into products (tenant_id, category_id, slug, name, base_price_cents, sort)
      values (${tenantId}, ${cat}, 'bolo-de-cenoura', 'Bolo de cenoura', 3000, 0)
    `;
  });

  afterAll(async () => {
    for (const id of tenants) await sql`delete from tenants where id = ${id}`;
    await sql.end();
  });

  let importId = '';

  test('links we cannot read answer stable 4xx, before anything is stored', async () => {
    expect((await manager('POST', '/imports', {})).status).toBe(422);
    expect((await manager('POST', '/imports', { url: 'x'.repeat(501) })).status).toBe(422);
    const unsupported = await manager('POST', '/imports', { url: 'https://minha-loja.com.br' });
    expect(unsupported.status).toBe(422);
    expect(unsupported.body.error.code).toBe('IMPORT_UNSUPPORTED');
    const goomer = await manager('POST', '/imports', { url: 'https://pizzaria.goomer.app' });
    expect(goomer.body.error).toMatchObject({ code: 'IMPORT_UNSUPPORTED' });
    expect(goomer.body.error.details?.platform ?? goomer.body.error.platform).toBe('goomer');
    const anota = await manager('POST', '/imports', { url: 'https://pedido.anota.ai/loja/x' });
    expect(anota.status).toBe(422);
    expect(anota.body.error.code).toBe('IMPORT_BLOCKED');
    const n = await sql`select count(*)::int as n from menu_imports where tenant_id = ${tenantId}`;
    expect(n[0]!.n).toBe(0);
  });

  test('paste → 202 reading; one in flight per store', async () => {
    const r = await manager('POST', '/imports', { url: 'instadelivery.com.br/doceriaexemplo' });
    expect(r.status).toBe(202);
    expect(r.body.platform).toBe('instadelivery');
    importId = r.body.id;
    const again = await owner('POST', '/imports', {
      url: 'https://instadelivery.com.br/outraloja',
    });
    expect(again.status).toBe(409);
    expect(again.body.error.code).toBe('IMPORT_IN_PROGRESS');
    const g = await manager('GET', `/imports/${importId}`);
    expect(g.body).toMatchObject({ status: 'reading', preview: null, counts: null });
  });

  test('the job reads it: ready, with counts, preview and what did not come over', async () => {
    await runReads(deps);
    expect(hits).toContain(`${API}doceriaexemplo`);
    const g = await manager('GET', `/imports/${importId}`);
    expect(g.status).toBe(200);
    expect(g.body.status).toBe('ready');
    expect(g.body.counts).toMatchObject({ categories: 2, products: 10, hidden: 3, pix: true });
    expect(g.body.preview.categories.map((c: any) => c.name)).toEqual(['BOLOS', 'AÇAÍ']);
    const acai = g.body.preview.categories[1].products[0];
    expect(acai).toMatchObject({ name: 'Açaí no copo', priceCents: 1490, status: 'active' });
    expect(g.body.lost.map((l: any) => l.code)).toEqual(
      expect.arrayContaining(['hidden_items', 'loyalty', 'pizza_pricing']),
    );
    // the raw payload is never stored
    const raw = await sql`select doc::text as doc from menu_imports where id = ${importId}`;
    expect(raw[0]!.doc).not.toContain('sk_live');
    // a manager sees which Pix key, the owner sees the key
    expect(g.body.preview.payments.pix.key).not.toBe('exemplo@vendua.test');
    expect((await owner('GET', `/imports/${importId}`)).body.preview.payments.pix.key).toBe(
      'exemplo@vendua.test',
    );
  });

  test("another store's import is a 404; a malformed id a 400", async () => {
    expect((await stranger('GET', `/imports/${importId}`)).status).toBe(404);
    expect(
      (await stranger('POST', `/imports/${importId}/apply`, { mode: 'add', sections: [] })).status,
    ).toBe(404);
    expect((await manager('GET', '/imports/nope')).status).toBe(400);
    expect((await manager('GET', `/imports/${crypto.randomUUID()}`)).status).toBe(404);
  });

  test('Pagamentos is the owner’s: a manager ticking it is a 403', async () => {
    const r = await manager('POST', `/imports/${importId}/apply`, {
      mode: 'add',
      sections: ['payments'],
    });
    expect(r.status).toBe(403);
    expect(
      (await manager('POST', `/imports/${importId}/apply`, { mode: 'merge', sections: [] })).status,
    ).toBe(422);
    expect(
      (await manager('POST', `/imports/${importId}/apply`, { mode: 'add', sections: ['x'] }))
        .status,
    ).toBe(422);
  });

  let applyKey = '';
  test('apply (add, every section) writes the catalog and settings once', async () => {
    applyKey = `${nonce}-apply`;
    const r = await owner(
      'POST',
      `/imports/${importId}/apply`,
      { mode: 'add', sections: ['profile', 'hours', 'delivery', 'payments'] },
      { 'idempotency-key': applyKey },
    );
    expect(r.status).toBe(200);
    expect(r.body.status).toBe('applied');
    expect(r.body.result).toMatchObject({
      categories: { created: 1, reused: 1 },
      products: 10,
      hidden: 3,
      archived: 0,
      images: 12,
    });

    const cats = await sql<{ name: string; description: string | null }[]>`
      select name, description from categories where tenant_id = ${tenantId} order by sort
    `;
    // "BOLOS" lands in the existing "Bolos"; AÇAÍ is new and sorts after
    expect(cats.map((c) => c.name)).toEqual(['Bolos', 'AÇAÍ']);
    expect(cats[0]!.description).toBe('Feitos no dia');

    const prods = await sql<
      {
        name: string;
        slug: string;
        base_price_cents: number;
        compare_at_price_cents: number | null;
        status: string;
        tags: string[];
        stock_quantity: number | null;
        requires_preorder: boolean;
        availability_schedule: unknown;
      }[]
    >`select * from products where tenant_id = ${tenantId} order by name`;
    const p = new Map(prods.map((x) => [x.name + (x.slug.endsWith('-2') ? ' (2)' : ''), x]));
    expect(prods).toHaveLength(11);
    // the old "Bolo de cenoura" stays; the imported one gets the next slug
    expect(p.get('Bolo de cenoura (2)')).toMatchObject({
      base_price_cents: 3500,
      tags: ['Mais vendido'],
      stock_quantity: 4,
      status: 'active',
    });
    expect(p.get('Bolo de fubá')).toMatchObject({
      base_price_cents: 2890,
      compare_at_price_cents: 3200,
    });
    expect(p.get('Bolo encomenda')!.requires_preorder).toBe(true);
    expect(p.get('Torta só de sábado')!.availability_schedule).toEqual({
      windows: [{ days: [6], from: '10:00', to: '14:00' }],
      outside: 'unavailable',
    });
    for (const hidden of ['Bolo de pote duplo', 'Item estranho', 'Promo misteriosa'])
      expect(p.get(hidden)!.status).toBe('archived');

    const groups = await sql<
      {
        name: string;
        min_select: number;
        max_select: number;
        pricing_rule: string;
        required: boolean;
      }[]
    >`
      select g.name, g.min_select, g.max_select, g.pricing_rule, g.required from modifier_groups g
      join products p on p.id = g.product_id where p.tenant_id = ${tenantId} and p.name = 'Pizza doce'
    `;
    expect([...groups]).toEqual([
      {
        name: 'Escolha 2 sabores',
        min_select: 1,
        max_select: 2,
        pricing_rule: 'most_expensive',
        required: true,
      },
    ]);
    const opts = await sql<{ name: string; price_delta_cents: number; max_qty: number }[]>`
      select m.name, m.price_delta_cents, m.max_qty from modifiers m
      join modifier_groups g on g.id = m.group_id join products p on p.id = g.product_id
      where p.tenant_id = ${tenantId} and p.name = 'Açaí no copo' order by g.sort, m.sort
    `;
    expect(opts.map((o) => [o.name, o.price_delta_cents, o.max_qty])).toEqual([
      ['300 ml', 0, 1],
      ['500 ml', 500, 1],
      ['700 ml', 1000, 1],
      ['Leite em pó', 250, 2],
      ['Granola', 200, 1],
      ['Paçoca', 0, 1],
    ]);

    const s = (await sql`select * from store_settings where tenant_id = ${tenantId}`)[0]!;
    expect(s).toMatchObject({
      tagline: 'Doces e bolos',
      whatsapp: '21999990000',
      instagram: '@doceria.exemplo',
      min_order_cents: 2000,
      prep_time_minutes: 25,
      pickup_enabled: true,
      delivery_enabled: true,
      pix_key: 'exemplo@vendua.test',
      pix_key_type: 'email',
      pix_beneficiary: 'Fulana T B S Exemplo',
      pix_city: 'Cidade Exemplo',
    });
    expect(s.payment_methods).toEqual(['cash', 'pix', 'card_on_delivery', 'meal_voucher']);
    expect(s.hours.windows).toHaveLength(4);
    expect(s.promo.title).toBe('Seja bem-vindo(a) à Doceria Exemplo!');
    // the logo is only queued: no source CDN URL is ever written
    expect(s.logo_url).toBeNull();
    const t = (await sql`select name from tenants where id = ${tenantId}`)[0]!;
    expect(t.name).toBe('Doceria Exemplo');
    const zones =
      await sql`select name, fee_cents, neighborhoods from delivery_zones where tenant_id = ${tenantId} order by fee_cents`;
    expect(zones.map((z) => [z.fee_cents, z.neighborhoods])).toEqual([
      [500, ['Centro', 'Jardim']],
      [850, ['Vila Nova']],
    ]);
    const tok =
      await sql`select tokens, source from storefront_tokens where tenant_id = ${tenantId} order by version desc limit 1`;
    expect(tok[0]!.source).toBe(`import:${importId}`);
    expect(tok[0]!.tokens.color.accent).toMatch(/^#[0-9A-F]{6}$/);
    const audit =
      await sql`select action, summary from audit_log where tenant_id = ${tenantId} and action = 'menu.import'`;
    expect(audit[0]!.summary).toContain('Instadelivery');
  });

  test('a double tap applies once: the same key replays, another key is a 409', async () => {
    const replay = await owner(
      'POST',
      `/imports/${importId}/apply`,
      { mode: 'add', sections: ['profile', 'hours', 'delivery', 'payments'] },
      { 'idempotency-key': applyKey },
    );
    expect(replay.status).toBe(200);
    const again = await owner('POST', `/imports/${importId}/apply`, { mode: 'add', sections: [] });
    expect(again.status).toBe(409);
    expect(again.body.error.code).toBe('IMPORT_NOT_READY');
    const n = await sql`select count(*)::int as n from products where tenant_id = ${tenantId}`;
    expect(n[0]!.n).toBe(11);
  });

  test('photos, logo and cover are re-hosted; a failed photo is reported, never linked', async () => {
    await runImages(deps);
    const media = await sql<{ url: string; sort: number; name: string }[]>`
      select m.url, m.sort, p.name from product_media m join products p on p.id = m.product_id
      where m.tenant_id = ${tenantId} order by p.name, m.sort
    `;
    expect(media.length).toBe(9);
    expect(media.every((m) => m.url.startsWith(`/v1/media/${tenantId}/`))).toBe(true);
    expect(media.filter((m) => m.name === 'Bolo de cenoura').map((m) => m.sort)).toEqual([0, 1]);
    const s = (await sql`select logo_url from store_settings where tenant_id = ${tenantId}`)[0]!;
    expect(s.logo_url).toStartWith(`/v1/media/${tenantId}/`);
    const home = await sql`
      select template from storefront_templates where tenant_id = ${tenantId} and page = 'home'
      order by version desc limit 1
    `;
    expect(home[0]!.template.sections[0].settings.cover).toStartWith(`/v1/media/${tenantId}/`);
    const anySource = await sql`
      select 1 from product_media where tenant_id = ${tenantId} and url like '%digitaloceanspaces%'
    `;
    expect(anySource).toHaveLength(0);
    const g = await owner('GET', `/imports/${importId}`);
    expect(g.body.images).toMatchObject({ total: 12, done: 12, failed: 1, finished: true });
    expect(g.body.lost).toEqual(
      expect.arrayContaining([
        { scope: 'product', subject: 'Item estranho', code: 'photo_failed' },
      ]),
    );
    // the media is served
    const served = await app.request(`http://core.localhost${media[0]!.url}`, {
      headers: { host: 'core.localhost' },
    });
    expect(served.status).toBe(200);
  });

  test('replace archives the old menu instead of deleting it', async () => {
    const r = await owner('POST', '/imports', { url: 'https://instadelivery.com.br/outraloja' });
    expect(r.status).toBe(202);
    await runReads(deps);
    const before =
      await sql`select count(*)::int as n from products where tenant_id = ${tenantId} and status <> 'archived'`;
    const a = await owner('POST', `/imports/${r.body.id}/apply`, { mode: 'replace', sections: [] });
    expect(a.status).toBe(200);
    expect(a.body.result.archived).toBe(before[0]!.n);
    const live = await sql<{ n: number }[]>`
      select count(*)::int as n from products where tenant_id = ${tenantId} and status <> 'archived'
    `;
    expect(live[0]!.n).toBe(7);
    const all = await sql`select count(*)::int as n from products where tenant_id = ${tenantId}`;
    expect(all[0]!.n).toBe(21);
  });

  test('a store that is not there fails NOT_FOUND; a stale preview expires', async () => {
    const r = await manager('POST', '/imports', { url: 'https://instadelivery.com.br/naoexiste' });
    expect(r.status).toBe(202);
    await runReads(deps);
    const g = await manager('GET', `/imports/${r.body.id}`);
    expect(g.body).toMatchObject({ status: 'failed', errorCode: 'NOT_FOUND' });

    const s = await manager('POST', '/imports', {
      url: 'https://instadelivery.com.br/doceriaexemplo',
    });
    await runReads(deps);
    await sql`update menu_imports set read_at = now() - interval '25 hours' where id = ${s.body.id}`;
    await sweepImports(sql);
    const e = await manager('GET', `/imports/${s.body.id}`);
    expect(e.body).toMatchObject({ status: 'expired', preview: null });
    const late = await manager('POST', `/imports/${s.body.id}/apply`, {
      mode: 'add',
      sections: [],
    });
    expect(late.status).toBe(409);
  });

  test('five an hour per store', async () => {
    const r = await manager('POST', '/imports', {
      url: 'https://instadelivery.com.br/doceriaexemplo',
    });
    expect(r.status).toBe(202);
    expect((await manager('POST', `/imports/${r.body.id}/discard`)).body.status).toBe('expired');
    const sixth = await manager('POST', '/imports', {
      url: 'https://instadelivery.com.br/doceriaexemplo',
    });
    expect(sixth.status).toBe(429);
    expect(sixth.body.error.code).toBe('IMPORT_RATE_LIMITED');
    const list = await manager('GET', '/imports');
    expect(list.body.imports).toHaveLength(5);
  });
});
