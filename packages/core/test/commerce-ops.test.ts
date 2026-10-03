import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { join } from 'node:path';
import postgres from 'postgres';
import { createApp } from '../src/app.ts';
import { addItem } from '../src/modules/cart.ts';
import {
  applyCouponTx,
  clearCouponTx,
  createCartTx,
  parseDeliveryInput,
  quoteDeliveryTx,
  removeLineTx,
  setDeliveryTx,
  setLineQtyTx,
} from '../src/modules/cart-ops.ts';
import { createSacolaLinkTx, createShare, readShare } from '../src/modules/cart-share.ts';
import { getProductById } from '../src/modules/catalog.ts';
import {
  foldText,
  scoreProduct,
  searchCatalog,
  searchTokens,
  singular,
} from '../src/modules/catalog-search.ts';
import { validateCheckoutShape, type CheckoutInput } from '../src/modules/checkout.ts';
import { mintCouponTx } from '../src/modules/coupons.ts';
import { loadOrderView } from '../src/modules/orders.ts';
import { placeOrderTx } from '../src/modules/place-order.ts';
import { renderOrderTicket } from '../src/modules/printing/ticket.ts';
import { migrate, withTenant } from '../src/platform/db.ts';
import { HttpError, claim, claimTx } from '../src/platform/http.ts';

describe('catalog search scoring', () => {
  test('folds accents, case and plurals', () => {
    expect(foldText('Pudim de Café!')).toBe('pudim de cafe');
    expect(singular('pudins')).toBe('pudim');
    expect(singular('pasteis')).toBe('pastel');
    expect(singular('limoes')).toBe('limao');
    expect(singular('paes')).toBe('pao');
    expect(singular('flores')).toBe('flor');
    expect(singular('doces')).toBe('doce');
    expect(singular('gas')).toBe('gas');
    expect(searchTokens('Tem PUDINS de limões?')).toEqual(['pudim', 'limao']);
  });

  test('exact name > prefix > token overlap; field weights; typos; vocabulary', () => {
    const q = (s: string) => searchTokens(s);
    expect(scoreProduct(q('pudim de leite'), { name: 'Pudim de Leite' })).toEqual({
      score: 100,
      matched: 'name',
    });
    expect(scoreProduct(q('pudins'), { name: 'Pudim de Leite' })).toEqual({
      score: 80,
      matched: 'name',
    });
    const overlap = scoreProduct(q('leite'), { name: 'Pudim de Leite' })!;
    expect(overlap.matched).toBe('name');
    expect(overlap.score).toBe(40);
    expect(
      scoreProduct(q('chocolate'), { name: 'Bolo', modifiers: ['Cobertura de chocolate'] }),
    ).toEqual({ score: 25, matched: 'modifier' });
    expect(scoreProduct(q('fofinha'), { name: 'Bolo', description: 'Massa fofinha' })).toEqual({
      score: 20,
      matched: 'description',
    });
    expect(scoreProduct(q('bolos'), { name: 'Formigueiro', category: 'Bolos' })).toEqual({
      score: 30,
      matched: 'category',
    });
    expect(scoreProduct(q('brigadero'), { name: 'Brigadeiro' })!.score).toBe(24);
    expect(scoreProduct(q('sorvete'), { name: 'Brigadeiro' })).toBeNull();
    expect(scoreProduct(q('doces'), { name: 'Brigadeiro' }, new Set(['doce']))).toEqual({
      score: 5,
      matched: 'vocabulary',
    });
    // a word that meets nothing halves a two-word query
    expect(scoreProduct(q('bolo sorvete'), { name: 'Bolo de fubá' })!.score).toBe(20);
  });
});

describe.skipIf(!process.env.TEST_DATABASE_URL)('commerce ops (db)', () => {
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
  const slug = `co-${nonce}`;
  const host = `${slug}.localhost`;
  const ownerPhone = `219${String(Date.now() + 11).slice(-8)}`;
  let tenantId = '';
  let idem = 0;
  const ids: Record<string, string> = {};
  const tx = <T>(fn: (tx: postgres.Sql) => Promise<T>) =>
    withTenant(sql as never, tenantId, fn as never) as Promise<T>;
  const code = async (p: Promise<unknown>) => {
    try {
      await p;
    } catch (err) {
      if (err instanceof HttpError)
        return { status: err.status, code: err.code, details: err.details };
      throw err;
    }
    return null;
  };

  const call = async (
    method: string,
    path: string,
    body?: unknown,
    headers: Record<string, string> = {},
    at = host,
  ) => {
    const res = await app.request(`http://${at}${path}`, {
      method,
      headers: {
        host: at,
        'content-type': 'application/json',
        ...(method === 'GET'
          ? {}
          : { 'idempotency-key': `${nonce}-${++idem}`, 'x-vendua-admin': '1' }),
        ...headers,
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
    const ct = res.headers.get('content-type') ?? '';
    return {
      status: res.status,
      body: (ct.includes('json') ? await res.json() : await res.text()) as any,
      cookie: res.headers.get('set-cookie'),
    };
  };
  const signIn = async (phone: string) => {
    const admin = (method: string, path: string, body?: unknown, h: Record<string, string> = {}) =>
      call(method, path, body, h, 'core.localhost');
    expect((await admin('POST', '/admin/v1/auth/otp/start', { phone })).status).toBe(200);
    const r = await admin('POST', '/admin/v1/auth/otp/verify', { phone, code: codes.get(phone) });
    expect(r.status).toBe(200);
    const value = /vendua_admin=([^;]+)/.exec(r.cookie ?? '')![1]!;
    return (method: string, path: string, body?: unknown) =>
      admin(method, `/admin/v1${path}`, body, { cookie: `vendua_admin=${value}` });
  };

  const newCart = async (lines: [string, number][] = []) =>
    tx(async (t) => {
      const { cartId } = await createCartTx(t, tenantId, 's');
      for (const [p, qty] of lines)
        await addItem(t, tenantId, cartId, { productId: ids[p]!, qty }, getProductById);
      return cartId;
    });
  const checkout = (
    method: CheckoutInput['payment']['method'],
    extra: Partial<CheckoutInput['payment']> = {},
    phone = '21999990000',
  ): CheckoutInput => ({
    customer: { name: 'Ana Teste', phone },
    delivery: { mode: 'pickup' },
    payment: { method, ...extra },
  });

  beforeAll(async () => {
    await migrate(sql, join(import.meta.dir, '../db/migrations'));
    tenantId = (
      await sql<
        { id: string }[]
      >`insert into tenants (slug, name) values (${slug}, ${'Loja ' + slug}) returning id`
    )[0]!.id;
    await sql`insert into domains (host, tenant_id) values (${host}, ${tenantId})`;
    await sql`
      insert into store_settings (tenant_id, hours, prep_time_minutes, min_order_cents, currency, vocabulary, city)
      values (${tenantId}, ${sql.json({ timezone: 'America/Sao_Paulo', windows: [{ days: [0, 1, 2, 3, 4, 5, 6], open: '00:00', close: '00:00' }] })},
              25, 0, 'BRL', ${sql.json({ itemSingular: 'doce', itemPlural: 'doces' })}, 'Saquarema')
    `;
    await sql`
      insert into delivery_zones (tenant_id, name, neighborhoods, fee_cents, min_order_cents, eta_min_minutes, eta_max_minutes)
      values (${tenantId}, 'Centro', ${sql.json(['Centro'])}, 500, 0, 30, 50)
    `;
    await sql`insert into merchant_users (tenant_id, name, phone, role) values (${tenantId}, 'Dona', ${ownerPhone}, 'owner')`;
    const cat = async (s: string, name: string) =>
      (
        await sql<
          { id: string }[]
        >`insert into categories (tenant_id, slug, name) values (${tenantId}, ${s}, ${name}) returning id`
      )[0]!.id;
    const doces = await cat('doces', 'Doces');
    const bolos = await cat('bolos', 'Bolos');
    const prod = async (
      s: string,
      name: string,
      price: number,
      extra: Record<string, unknown> = {},
    ) =>
      (ids[s] = (
        await sql<{ id: string }[]>`
          insert into products ${sql({ tenant_id: tenantId, category_id: doces, slug: s, name, base_price_cents: price, ...extra } as never)}
          returning id
        `
      )[0]!.id);
    await prod('brigadeiro', 'Brigadeiro', 500);
    await prod('pudim-leite', 'Pudim de Leite', 2000);
    await prod('pudim-cafe', 'Pudim de Café', 2000, { stock_quantity: 0 });
    await prod('pudim-coco', 'Pudim de Coco', 2000);
    await prod('limao', 'Bolo de limão', 4000, {
      category_id: bolos,
      description: 'Massa fofinha',
      dietary: ['vegano'],
    });
    const group = (
      await sql<{ id: string }[]>`
        insert into modifier_groups (tenant_id, product_id, name, min_select, max_select)
        values (${tenantId}, ${ids.limao!}, 'Cobertura', 0, 1) returning id
      `
    )[0]!.id;
    await sql`
      insert into modifiers (tenant_id, group_id, name, price_delta_cents)
      values (${tenantId}, ${group}, 'Cobertura de chocolate', 300)
    `;
  });

  afterAll(async () => {
    if (tenantId) await sql`delete from tenants where id = ${tenantId}`;
    await sql.end();
  });

  test('claimTx: stores, replays, refuses reuse and in-flight keys, rolls back with the tx', async () => {
    let runs = 0;
    const run = async () => ({ status: 201, body: { n: ++runs } });
    const first = await tx((t) => claimTx(t, tenantId, `${nonce}-a`, 'fp1', run));
    expect(first).toEqual({ status: 201, body: { n: 1 }, replayed: false });
    const again = await tx((t) => claimTx(t, tenantId, `${nonce}-a`, 'fp1', run));
    expect(again).toEqual({ status: 201, body: { n: 1 }, replayed: true });
    expect(runs).toBe(1);
    expect(await code(tx((t) => claimTx(t, tenantId, `${nonce}-a`, 'fp2', run)))).toMatchObject({
      status: 422,
      code: 'IDEMPOTENCY_KEY_REUSED',
    });
    expect(await code(tx((t) => claimTx(t, tenantId, '', 'fp1', run)))).toMatchObject({
      status: 400,
      code: 'IDEMPOTENCY_KEY_REQUIRED',
    });

    // a failure rolls back the work and the key together: a retry runs again
    let cartId = '';
    const failed = await code(
      tx((t) =>
        claimTx(t, tenantId, `${nonce}-b`, 'fp1', async () => {
          cartId = (await createCartTx(t, tenantId, 's')).cartId;
          throw new HttpError(422, 'BAD_REQUEST', 'nope');
        }),
      ),
    );
    expect(failed?.code).toBe('BAD_REQUEST');
    expect((await sql`select 1 from carts where id = ${cartId}`).length).toBe(0);
    expect(
      (
        await sql`select 1 from idempotency_keys where tenant_id = ${tenantId} and key = ${`${nonce}-b`}`
      ).length,
    ).toBe(0);
    expect((await tx((t) => claimTx(t, tenantId, `${nonce}-b`, 'fp1', run))).replayed).toBe(false);

    // a live claim by another owner (claim()'s first tx committed, its work not yet)
    await sql`
      insert into idempotency_keys (tenant_id, key, owner, fingerprint)
      values (${tenantId}, ${`${nonce}-c`}, ${crypto.randomUUID()}, null)
    `;
    expect(await code(tx((t) => claimTx(t, tenantId, `${nonce}-c`, 'fp1', run)))).toMatchObject({
      status: 409,
      code: 'IDEMPOTENCY_IN_PROGRESS',
    });

    // claim() and claimTx share the key space
    const viaClaim = await claim(sql as never, tenantId, `${nonce}-d`, 'fp1', async () => ({
      status: 200,
      body: { ok: true },
    }));
    expect(viaClaim.replayed).toBe(false);
    expect((await tx((t) => claimTx<unknown>(t, tenantId, `${nonce}-d`, 'fp1', run))).body).toEqual(
      {
        ok: true,
      },
    );
    expect(
      (
        await claim(sql as never, tenantId, `${nonce}-d`, 'fp1', async () => ({
          status: 500,
          body: {},
        }))
      ).replayed,
    ).toBe(true);
  });

  test('cart ops: qty, remove, delivery, quote, coupons; bad ids are 4xx', async () => {
    const cartId = await newCart([['brigadeiro', 2]]);
    const line = (await tx((t) => sql`select id from cart_items where cart_id = ${cartId}`))[0]!
      .id as string;
    const three = await tx((t) => setLineQtyTx(t, tenantId, cartId, line, 3));
    expect(three.items[0]!.qty).toBe(3);
    expect(three.totals.subtotalCents).toBe(1500);
    expect(await code(tx((t) => setLineQtyTx(t, tenantId, cartId, line, 100)))).toMatchObject({
      status: 422,
      code: 'INVALID_QTY',
    });
    expect(await code(tx((t) => setLineQtyTx(t, tenantId, cartId, 'nope', 1)))).toMatchObject({
      status: 400,
      code: 'BAD_REQUEST',
    });
    expect(
      await code(tx((t) => setLineQtyTx(t, tenantId, crypto.randomUUID(), line, 1))),
    ).toMatchObject({ status: 404, code: 'CART_NOT_FOUND' });
    expect(await code(tx((t) => removeLineTx(t, tenantId, cartId, "x'; --")))).toMatchObject({
      status: 400,
    });
    expect((await tx((t) => setLineQtyTx(t, tenantId, cartId, line, 0))).items).toHaveLength(0);
    await tx((t) =>
      addItem(t, tenantId, cartId, { productId: ids.brigadeiro!, qty: 1 }, getProductById),
    );
    const again = (await tx((t) => sql`select id from cart_items where cart_id = ${cartId}`))[0]!
      .id as string;
    expect((await tx((t) => removeLineTx(t, tenantId, cartId, again))).items).toHaveLength(0);
    await tx((t) =>
      addItem(t, tenantId, cartId, { productId: ids['pudim-leite']!, qty: 1 }, getProductById),
    );

    expect(
      await code(Promise.resolve().then(() => parseDeliveryInput({ mode: 'drone' }))),
    ).toMatchObject({ status: 422, code: 'INVALID_DELIVERY' });
    expect(
      await code(Promise.resolve().then(() => parseDeliveryInput({ mode: 'delivery', cep: '12' }))),
    ).toMatchObject({ code: 'INVALID_DELIVERY' });
    expect(await code(Promise.resolve().then(() => parseDeliveryInput(null)))).toMatchObject({
      code: 'INVALID_DELIVERY',
    });
    const delivery = parseDeliveryInput({
      mode: 'delivery',
      neighborhood: 'Centro',
      street: 'Rua A',
      number: '10',
      cep: '28990-000',
    });
    expect(delivery.cep).toBe('28990000');
    const withFee = await tx((t) => setDeliveryTx(t, tenantId, cartId, delivery, null));
    expect(withFee.totals.deliveryFeeCents).toBe(500);
    expect(withFee.totals.totalCents).toBe(2500);

    const quote = await tx((t) =>
      quoteDeliveryTx(t, tenantId, { neighborhood: 'centro' }, { cartId }),
    );
    expect(quote).toMatchObject({ eligible: true, zoneName: 'Centro', feeCents: 500 });
    expect(quote.eligible && quote.totals?.totalCents).toBe(2500);
    expect(await tx((t) => quoteDeliveryTx(t, tenantId, { neighborhood: 'Lua' }))).toEqual({
      eligible: false,
      reason: 'OUT_OF_ZONE',
    });
    expect(await code(tx((t) => quoteDeliveryTx(t, tenantId, { lat: 200, lng: 0 })))).toMatchObject(
      { status: 422, code: 'INVALID_DELIVERY' },
    );

    const coupon = await tx((t) =>
      mintCouponTx(
        t,
        tenantId,
        { code: `off${nonce}`.slice(0, 20), kind: 'fixed', value: 300 },
        'merchant',
      ),
    );
    const applied = await tx((t) => applyCouponTx(t, tenantId, cartId, coupon.code.toLowerCase()));
    expect(applied.coupon?.code).toBe(coupon.code);
    expect(applied.totals.discountCents).toBe(300);
    expect(await code(tx((t) => applyCouponTx(t, tenantId, cartId, 'NOPE123')))).toMatchObject({
      status: 422,
      code: 'COUPON_NOT_FOUND',
    });
    expect(await code(tx((t) => applyCouponTx(t, tenantId, cartId, '!!')))).toMatchObject({
      status: 422,
      code: 'INVALID_COUPON',
    });
    // a personal coupon needs the phone a proven token vouches for
    const mine = await tx((t) =>
      mintCouponTx(t, tenantId, { kind: 'fixed', value: 100, phone: '21911112222' }, 'agent'),
    );
    expect(
      await code(tx((t) => applyCouponTx(t, tenantId, cartId, mine.code, '21911112222'))),
    ).toMatchObject({ code: 'COUPON_NOT_YOURS' });
    expect(
      (await tx((t) => applyCouponTx(t, tenantId, cartId, mine.code, '21911112222', '21911112222')))
        .coupon?.code,
    ).toBe(mine.code);
    expect((await tx((t) => clearCouponTx(t, tenantId, cartId))).coupon).toBeNull();
  });

  test('the HTTP cart routes still answer through the ops', async () => {
    const s = await call('POST', '/checkout/v1/session');
    expect(s.status).toBe(201);
    const auth = { authorization: `Bearer ${s.body.sessionToken}` };
    const add = await call('POST', '/checkout/v1/cart/items', { productId: ids.brigadeiro }, auth);
    const itemId = add.body.cart.items[0].id;
    const patched = await call('PATCH', `/checkout/v1/cart/items/${itemId}`, { qty: 4 }, auth);
    expect(patched.body.cart.items[0].qty).toBe(4);
    expect((await call('PATCH', '/checkout/v1/cart/items/bad', { qty: 1 }, auth)).status).toBe(400);
    const del = await call('POST', '/checkout/v1/cart/delivery', { mode: 'pickup' }, auth);
    expect(del.body.cart.delivery.mode).toBe('pickup');
    const q = await call('POST', '/checkout/v1/quote', { neighborhood: 'Centro' }, auth);
    expect(q.body).toMatchObject({
      eligible: true,
      feeCents: 500,
      totals: { subtotalCents: 2000 },
    });
    expect(
      (await call('DELETE', `/checkout/v1/cart/items/${itemId}`, undefined, auth)).body.cart.items,
    ).toHaveLength(0);
  });

  test('cash change: stored, shown, printed; refused below the total, over the cap, off cash', async () => {
    const cartId = await newCart([['pudim-leite', 1]]);
    const refuse = (body: CheckoutInput) =>
      code(tx((t) => placeOrderTx(t, tenantId, cartId, body, new Date())));
    expect(await refuse(checkout('cash', { changeForCents: 1999 }))).toMatchObject({
      status: 422,
      code: 'INVALID_CHANGE',
      details: { field: 'payment.changeForCents', minCents: 2000, maxCents: 1_000_000 },
    });
    expect(await refuse(checkout('cash', { changeForCents: 1_000_001 }))).toMatchObject({
      code: 'INVALID_CHANGE',
    });
    expect(await refuse(checkout('pix', { changeForCents: 5000 }))).toMatchObject({
      code: 'INVALID_CHANGE',
    });
    expect(
      await code(
        Promise.resolve().then(() =>
          validateCheckoutShape(checkout('cash', { changeForCents: 50.5 })),
        ),
      ),
    ).toMatchObject({ status: 422, code: 'INVALID_CHANGE' });
    validateCheckoutShape(checkout('cash', { changeForCents: 5000 }));
    validateCheckoutShape(checkout('cash', { changeForCents: null }));

    const orderId = await tx((t) =>
      placeOrderTx(t, tenantId, cartId, checkout('cash', { changeForCents: 5000 }), new Date()),
    );
    const row = (
      await sql`select payment, source, thread_id from orders where id = ${orderId}`
    )[0]!;
    expect(row.payment.changeForCents).toBe(5000);
    expect(row.source).toBe('storefront');
    expect(row.thread_id).toBeNull();
    const ev = (await sql`select meta from order_events where order_id = ${orderId}`)[0]!;
    expect(ev.meta.via).toBe('storefront');
    const view = await tx((t) => loadOrderView(t, tenantId, orderId));
    expect(view.payment.changeForCents).toBe(5000);
    const ticket = renderOrderTicket(
      view,
      { name: 'Loja', timezone: 'America/Sao_Paulo' },
      { paper: 80, codepage: 'cp850', copies: 1, cut: false },
      new Date(),
    );
    expect(Buffer.from(ticket).toString('latin1')).toContain('Troco para R$ 50,00');

    const plain = await newCart([['brigadeiro', 1]]);
    const exact = await tx((t) => placeOrderTx(t, tenantId, plain, checkout('cash'), new Date()));
    const v2 = await tx((t) => loadOrderView(t, tenantId, exact));
    expect(v2.payment.changeForCents).toBeNull();
    const t2 = renderOrderTicket(
      v2,
      { name: 'Loja', timezone: 'America/Sao_Paulo' },
      { paper: 80, codepage: 'cp850', copies: 1, cut: false },
      new Date(),
    );
    expect(Buffer.from(t2).toString('latin1')).not.toContain('Troco');
  });

  test('an order sold in a conversation records its source and thread', async () => {
    const thread = (
      await sql<{ id: string }[]>`
        insert into shopper_threads (tenant_id, channel, address, phone)
        values (${tenantId}, 'test', ${`t-${nonce}`}, '21977776666') returning id
      `
    )[0]!.id;
    const cartId = await newCart([['pudim-coco', 3]]);
    const orderId = await tx((t) =>
      placeOrderTx(t, tenantId, cartId, checkout('pix'), new Date(), undefined, {
        source: 'whatsapp_agent',
        threadId: thread,
      }),
    );
    const row = (await sql`select source, thread_id from orders where id = ${orderId}`)[0]!;
    expect(row).toEqual({ source: 'whatsapp_agent', thread_id: thread });
    const ev = (await sql`select meta from order_events where order_id = ${orderId}`)[0]!;
    expect(ev.meta).toEqual({ via: 'whatsapp_agent' });
  });

  test('searchCatalog: folding, availability first, then sales; dietary on the summary', async () => {
    const names = async (q: string) =>
      (await tx((t) => searchCatalog(t, tenantId, q))).map((h) => h.product.name);
    // pudim de coco sold 3 (previous test): it leads the available pudins; café is sold out
    expect(await names('pudins')).toEqual(['Pudim de Coco', 'Pudim de Leite', 'Pudim de Café']);
    expect(await names('PUDIM DE CAFÉ')).toEqual([
      // the exact name is sold out: what can be sold comes first
      'Pudim de Coco',
      'Pudim de Leite',
      'Pudim de Café',
    ]);
    expect((await names('brigadero'))[0]).toBe('Brigadeiro');
    const lemon = await tx((t) => searchCatalog(t, tenantId, 'limões'));
    expect(lemon[0]!.product.name).toBe('Bolo de limão');
    expect(lemon[0]!.product.dietary).toEqual(['vegano']);
    expect((await tx((t) => searchCatalog(t, tenantId, 'chocolate')))[0]!.matched).toBe('modifier');
    expect((await tx((t) => searchCatalog(t, tenantId, 'fofinha')))[0]!.matched).toBe(
      'description',
    );
    const all = await tx((t) => searchCatalog(t, tenantId, 'doces', { limit: 50 }));
    expect(all.length).toBe(5);
    expect(all.at(-1)!.product.name).toBe('Pudim de Café');
    expect(await tx((t) => searchCatalog(t, tenantId, 'de', {}))).toEqual([]);
    expect((await tx((t) => searchCatalog(t, tenantId, 'pudim', { limit: 1 }))).length).toBe(1);
    expect(await code(tx((t) => searchCatalog(t, tenantId, 'x'.repeat(101))))).toMatchObject({
      status: 422,
    });
  });

  test('searchCatalog: a dietary restriction filters on what the store stated', async () => {
    const names = async (q: string) =>
      (await tx((t) => searchCatalog(t, tenantId, q))).map((h) => h.product.name);
    await sql`update products set dietary = '{sem_lactose}' where id = ${ids['pudim-coco']!}`;
    // says "lactose" in its text and is tagged as containing it: never a "sem lactose" answer
    await sql`update products set dietary = '{contem_lactose}', description = 'Leva lactose'
      where id = ${ids['pudim-leite']!}`;
    expect(await names('pudim sem lactose')).toEqual(['Pudim de Coco']);
    expect(await names('tem algo sem lactose?')).toEqual(['Pudim de Coco']);
    expect(await names('Vegana')).toEqual(['Bolo de limão']);
    expect(await names('bolo vegetariano')).toEqual(['Bolo de limão']);
    expect(await names('sem glúten')).toEqual([]);
  });

  test('a sacola link opens once; a share link keeps working', async () => {
    const cartId = await newCart([['brigadeiro', 2]]);
    const thread = (
      await sql<{ id: string }[]>`
        insert into shopper_threads (tenant_id, channel, address)
        values (${tenantId}, 'test', ${`s-${nonce}`}) returning id
      `
    )[0]!.id;
    const link = await tx((t) => createSacolaLinkTx(t, tenantId, cartId, thread, 30));
    expect(new Date(link.expiresAt).getTime() - Date.now()).toBeLessThan(31 * 60_000);
    const row = (
      await sql`select single_use, thread_id from cart_shares where code = ${link.code}`
    )[0]!;
    expect(row).toEqual({ single_use: true, thread_id: thread });
    expect(await code(tx((t) => createSacolaLinkTx(t, tenantId, cartId, 'x', 30)))).toMatchObject({
      status: 400,
    });

    // the storefront's ?cart=CODE import, unchanged
    const s = await call('POST', '/checkout/v1/session');
    const auth = { authorization: `Bearer ${s.body.sessionToken}` };
    const opened = await call('POST', '/checkout/v1/cart/import', { shareCode: link.code }, auth);
    expect(opened.status).toBe(200);
    expect(opened.body.cart.items[0].qty).toBe(2);
    const twice = await call('POST', '/checkout/v1/cart/import', { shareCode: link.code }, auth);
    expect(twice.status).toBe(404);
    expect(twice.body.error.code).toBe('SHARE_NOT_FOUND');

    const share = await tx((t) => createShare(t, tenantId, cartId));
    expect((await tx((t) => readShare(t, tenantId, share.code))).length).toBe(1);
    expect((await tx((t) => readShare(t, tenantId, share.code))).length).toBe(1);
  });

  test('mintCouponTx: generated codes, collisions without aborting the tx, bounds', async () => {
    await tx(async (t) => {
      const a = await mintCouponTx(
        t,
        tenantId,
        { prefix: 'volta', kind: 'percent', value: 10, validDays: 7, perPhoneLimit: 1 },
        'agent',
      );
      expect(a.code).toMatch(/^VOLTA-[A-HJ-NP-Z2-9]{6}$/);
      expect(a.source).toBe('agent');
      expect(new Date(a.ends_at!).getTime()).toBeGreaterThan(Date.now() + 6 * 86_400_000);
      const dup = await code(
        mintCouponTx(t, tenantId, { code: a.code, kind: 'fixed', value: 100 }, 'merchant'),
      );
      expect(dup).toMatchObject({ status: 409, code: 'COUPON_EXISTS' });
      // the tx is still usable after the collision
      const b = await mintCouponTx(t, tenantId, { kind: 'free_delivery', value: 0 }, 'agent');
      expect(b.code).toMatch(/^[A-HJ-NP-Z2-9]{6}$/);
    });
    expect(
      await code(tx((t) => mintCouponTx(t, tenantId, { kind: 'percent', value: 101 }, 'agent'))),
    ).toMatchObject({ status: 422 });
    expect(
      await code(
        tx((t) =>
          mintCouponTx(t, tenantId, { prefix: 'NO WAY!', kind: 'fixed', value: 1 }, 'agent'),
        ),
      ),
    ).toMatchObject({ status: 422 });
  });

  test('admin products read and write dietary tags', async () => {
    const owner = await signIn(ownerPhone);
    const cat = (await sql`select id from categories where tenant_id = ${tenantId} limit 1`)[0]!.id;
    const created = await owner('POST', '/products', {
      name: 'Cookie vegano',
      categoryId: cat,
      priceCents: 800,
      dietary: ['vegano', 'contem_gluten', 'vegano'],
    });
    expect(created.status).toBe(201);
    expect(created.body.product.dietary).toEqual(['contem_gluten', 'vegano']);
    const id = created.body.product.id;
    const bad = await owner('PATCH', `/products/${id}`, { dietary: ['sem_acucar'] });
    expect(bad.status).toBe(422);
    const patched = await owner('PATCH', `/products/${id}`, { dietary: ['sem_lactose'] });
    expect(patched.status).toBe(200);
    expect((await owner('GET', `/products/${id}`)).body.product.dietary).toEqual(['sem_lactose']);
    await sql`delete from products where id = ${id}`;
  });

  test('LGPD forget erases conversations, their agent and memory, and wa rows', async () => {
    const owner = await signIn(ownerPhone);
    const phone = '21988881234';
    // one conversation under the number without its 9th digit, a store with no orders from it
    const thread = (
      await sql<{ id: string }[]>`
        insert into shopper_threads (tenant_id, channel, address, phone, profile_name)
        values (${tenantId}, 'whatsapp', '552188881234@s.whatsapp.net', '2188881234', 'Ana')
        returning id
      `
    )[0]!.id;
    const msg = (
      await sql<{ id: string }[]>`
        insert into shopper_messages (tenant_id, thread_id, author, kind, body)
        values (${tenantId}, ${thread}, 'shopper', 'audio', 'oi') returning id
      `
    )[0]!.id;
    await sql`
      insert into shopper_media (tenant_id, message_id, mime, bytes)
      values (${tenantId}, ${msg}, 'audio/ogg', ${Buffer.from([1, 2, 3])})
    `;
    await sql`
      insert into store_wa_messages (tenant_id, kind, jid, body, shopper_message_id)
      values (${tenantId}, 'chat', '552188881234@s.whatsapp.net', 'olá', ${msg})
    `;
    await sql`
      insert into store_wa_messages (tenant_id, kind, phone, body)
      values (${tenantId}, 'test', ${phone}, 'teste')
    `;
    await sql`insert into store_wa_optouts (tenant_id, phone) values (${tenantId}, ${phone})`;
    await sql`
      insert into agent_actors (tenant_id, agent_id, subject_kind, subject_id, lane)
      values (${tenantId}, 'vendedor', 'shopper_thread', ${thread}, 'interactive')
    `;
    await sql`
      insert into agent_memory (tenant_id, scope, key, value, confidence, provenance)
      values (${tenantId}, ${`shopper_thread:${thread}`}, 'likes', ${sql.json({ v: 'coco' })}, 0.9, 'test')
    `;
    await sql`
      insert into agent_incentives (tenant_id, thread_id, phone, reason, value_cents)
      values (${tenantId}, ${thread}, ${phone}, 'recovery', 500)
    `;
    // an order under the number, its cart holding an address
    const cartId = await newCart([['brigadeiro', 1]]);
    await tx((t) =>
      setDeliveryTx(
        t,
        tenantId,
        cartId,
        parseDeliveryInput({ mode: 'delivery', neighborhood: 'Centro', address: 'Rua B, 1' }),
        null,
      ),
    );
    const delivered: CheckoutInput = {
      ...checkout('cash', {}, phone),
      delivery: { mode: 'delivery', neighborhood: 'Centro', address: 'Rua B, 1' },
    };
    await tx((t) => placeOrderTx(t, tenantId, cartId, delivered, new Date()));

    const f = await owner('POST', `/customers/${phone}/forget`, { confirm: '1234' });
    expect(f.status).toBe(200);
    expect(f.body).toEqual({ anonymized: 1, conversations: 1 });
    expect((await sql`select 1 from shopper_threads where id = ${thread}`).length).toBe(0);
    expect((await sql`select 1 from shopper_messages where thread_id = ${thread}`).length).toBe(0);
    expect((await sql`select 1 from shopper_media where tenant_id = ${tenantId}`).length).toBe(0);
    expect(
      (
        await sql`select 1 from agent_actors where tenant_id = ${tenantId} and subject_id = ${thread}`
      ).length,
    ).toBe(0);
    expect(
      (await sql`select 1 from agent_memory where scope = ${`shopper_thread:${thread}`}`).length,
    ).toBe(0);
    expect((await sql`select 1 from store_wa_messages where tenant_id = ${tenantId}`).length).toBe(
      0,
    );
    expect(
      (await sql`select phone from agent_incentives where tenant_id = ${tenantId}`)[0]!.phone,
    ).toBeNull();
    expect((await sql`select delivery from carts where id = ${cartId}`)[0]!.delivery).toBeNull();
    expect((await sql`select 1 from store_wa_optouts where tenant_id = ${tenantId}`).length).toBe(
      1,
    );

    // a number with only a conversation can be forgotten; one with nothing is 404
    await sql`
      insert into shopper_threads (tenant_id, channel, address, phone)
      values (${tenantId}, 'whatsapp', '5521955554321@s.whatsapp.net', '21955554321')
    `;
    const only = await owner('POST', '/customers/21955554321/forget', { confirm: '4321' });
    expect(only.body).toEqual({ anonymized: 0, conversations: 1 });
    expect((await owner('POST', '/customers/21955554321/forget', { confirm: '4321' })).status).toBe(
      404,
    );
  });
});
