import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { join } from 'node:path';
import postgres from 'postgres';
import {
  createGateway,
  Runtime,
  type ModelGateway,
  type ScriptedOutput,
} from '@vendua/agent-runtime';
import { scriptedAdapter } from '@vendua/agent-runtime/testing';
import { createApp } from '../src/app.ts';
import { copilot } from '../src/agent-host/agents/copilot/index.ts';
import { hostHooks } from '../src/agent-host/hooks.ts';
import { pgMemory } from '../src/agent-host/store/memory.ts';
import { PgActorStore } from '../src/agent-host/store/pg-store.ts';
import { proposeTx } from '../src/copilot/actions.ts';
import { copilotTransport } from '../src/copilot/view.ts';
import { HttpError } from '../src/platform/http.ts';
import { migrate, withTenant, type Sql } from '../src/platform/db.ts';
import { addDays, localDateOf, zonedInstant } from '../src/platform/tz.ts';

// ADR 0034: Duá Copilot end to end on Postgres, as vendua_app under RLS — a message from the
// admin, a scripted turn with the real tools, a proposal that changed nothing, the tap that
// applies it through the route's own handler, and everything that must not happen twice.

const OWNER_URL = process.env.TEST_DATABASE_URL;
const APP_URL =
  process.env.TEST_APP_DATABASE_URL ?? OWNER_URL?.replace(/\/\/[^@]+@/, '//vendua_app:vendua_app@');

const call = (name: string, args: Record<string, unknown> = {}) => ({ name, args });
const tools = (...calls: { name: string; args: Record<string, unknown> }[]): ScriptedOutput => ({
  toolCalls: calls as NonNullable<ScriptedOutput['toolCalls']>,
});
const reply = (text: string): ScriptedOutput => tools(call('reply', { text }));

describe.skipIf(!OWNER_URL)('Duá Copilot (db)', () => {
  const sql = postgres(OWNER_URL!, { onnotice: () => {} });
  const appSql = postgres(APP_URL!, { onnotice: () => {} }) as unknown as Sql;
  const codes = new Map<string, string>();
  const app = createApp({
    sql: appSql,
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
  const tenants: string[] = [];
  let idem = 0;

  interface Store {
    tenantId: string;
    ownerId: string;
    owner: string;
    productId: string;
  }

  const request = async (
    method: string,
    path: string,
    body?: unknown,
    headers: Record<string, string> = {},
  ) => {
    const res = await app.request(`http://core.localhost/admin/v1${path}`, {
      method,
      headers: {
        host: 'core.localhost',
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

  async function signIn(phone: string) {
    await request('POST', '/auth/otp/start', { phone });
    const r = await request('POST', '/auth/otp/verify', { phone, code: codes.get(phone) });
    expect(r.body.signedIn).toBe(true);
    return `vendua_admin=${/vendua_admin=([^;]+)/.exec(r.cookie ?? '')![1]!}`;
  }

  let phones = 0;
  const phone = () => `21${String(++phones).padStart(2, '0')}${stamp}`.slice(0, 11);

  async function store(plan = 'pangolim'): Promise<Store> {
    const slug = `cp-${nonce}-${tenants.length}`;
    const [t] = await sql<{ id: string }[]>`
      insert into tenants (slug, name, plan) values (${slug}, 'Quero Pudim', ${plan}) returning id`;
    const tenantId = t!.id;
    tenants.push(tenantId);
    await sql`
      insert into store_settings (tenant_id, hours, prep_time_minutes, min_order_cents, currency, vocabulary, pickup_enabled)
      values (${tenantId}, ${sql.json({ timezone: 'America/Sao_Paulo', windows: [{ days: [0, 1, 2, 3, 4, 5, 6], open: '00:00', close: '00:00' }] })},
              25, 0, 'BRL', ${sql.json({})}, true)`;
    const [c] = await sql<{ id: string }[]>`
      insert into categories (tenant_id, slug, name) values (${tenantId}, 'pudins', 'Pudins') returning id`;
    const [p] = await sql<{ id: string }[]>`
      insert into products (tenant_id, category_id, slug, name, base_price_cents)
      values (${tenantId}, ${c!.id}, 'pudim-de-leite', 'Pudim de Leite', 4500) returning id`;
    const ownerPhone = phone();
    const [u] = await sql<{ id: string }[]>`
      insert into merchant_users (tenant_id, name, phone, role)
      values (${tenantId}, 'Rita Souza', ${ownerPhone}, 'owner') returning id`;
    return { tenantId, ownerId: u!.id, owner: await signIn(ownerPhone), productId: p!.id };
  }

  function runtime(script: ScriptedOutput[]) {
    const adapter = scriptedAdapter(script);
    const gateway: ModelGateway = createGateway({
      adapters: [adapter],
      routes: { routes: async () => [{ provider: 'scripted', model: 't', zdr: true }] },
    });
    const rt = new Runtime<Sql>({
      agents: [copilot],
      store: new PgActorStore(appSql),
      gateway,
      transports: [copilotTransport],
      owner: `w-${Math.random()}`,
      memory: pgMemory,
      hooks: hostHooks(),
      clock: { now: () => new Date(Date.now() + 60_000), sleep: async () => {} },
    });
    return { rt, adapter };
  }

  async function settle(rt: Runtime<Sql>, tenantId: string) {
    for (let i = 0; i < 20; i++) {
      await sql`update agent_actors set next_wake_at = null where tenant_id <> ${tenantId} and agent_id = 'copilot'`;
      if ((await rt.pump('interactive', { limit: 10, perTenantCap: 10 })) === 0) break;
    }
  }

  const as = (cookie: string) => (method: string, path: string, body?: unknown) =>
    request(method, path, body, { cookie });

  const status = async (tenantId: string) =>
    (
      await sql<{ status_override: string | null; resumes_at: Date | null }[]>`
        select status_override, resumes_at from store_settings where tenant_id = ${tenantId}`
    )[0]!;

  const audits = (tenantId: string, action: string) =>
    sql<{ actor_label: string; summary: string }[]>`
      select actor_label, summary from audit_log where tenant_id = ${tenantId} and action = ${action}`;

  /** proposeTx as the tools call it, in a tenant tx. */
  const propose = (s: Store, kind: Parameters<typeof proposeTx>[1]['kind'], input: unknown) =>
    withTenant(appSql, s.tenantId, (tx) =>
      proposeTx(tx, {
        tenant: { id: s.tenantId, slug: 'x', name: 'Quero Pudim', status: 'active' },
        merchant: {
          userId: s.ownerId,
          sessionId: '',
          name: 'Rita Souza',
          phone: '',
          role: 'owner',
        },
        turnId: `t-${Math.random()}`,
        kind,
        input,
      }),
    );

  // one signed-in store for most tests: the sign-in limit is per address
  let shared: Store;

  beforeAll(async () => {
    await migrate(sql, join(import.meta.dir, '../db/migrations'));
    shared = await store();
  });

  afterAll(async () => {
    for (const t of tenants) await sql`delete from tenants where id = ${t}`;
    await (appSql as unknown as { end: () => Promise<void> }).end();
    await sql.end();
  });

  test('only Pangolim has it; attendants never do', async () => {
    const bandeira = await store('bandeira');
    const locked = await as(bandeira.owner)('GET', '/copilot');
    expect(locked.status).toBe(403);
    expect(locked.body.error.code).toBe('PLAN_REQUIRED');
    expect(locked.body.error.details.feature).toBe('copilot');
    const send = await as(bandeira.owner)('POST', '/copilot/messages', { text: 'oi' });
    expect(send.status).toBe(403);

    const s = shared;
    const attendantPhone = phone();
    await sql`insert into merchant_users (tenant_id, name, phone, role)
      values (${s.tenantId}, 'Caio', ${attendantPhone}, 'attendant')`;
    const caio = await signIn(attendantPhone);
    expect((await as(caio)('GET', '/copilot')).status).toBe(403);
    expect((await as(s.owner)('GET', '/copilot')).status).toBe(200);
  });

  test('a message is one mailbox row for the copilot, in the same transaction', async () => {
    const s = shared;
    const bad = await as(s.owner)('POST', '/copilot/messages', {
      text: 'oi',
      screen: 'https://evil.example/',
    });
    expect(bad.status).toBe(422);
    const r = await as(s.owner)('POST', '/copilot/messages', {
      text: 'Como estão as vendas hoje?',
      screen: '/pedidos',
    });
    expect(r.status).toBe(201);
    expect(r.body.busy).toBe(true);
    expect(r.body.items).toHaveLength(1);
    const rows = await sql<{ source: string; dedupe_key: string; subject_id: string }[]>`
      select m.source, m.dedupe_key, a.subject_id from agent_mailbox m
      join agent_actors a on a.id = m.actor_id
      where m.tenant_id = ${s.tenantId} and a.agent_id = 'copilot'`;
    expect(rows).toHaveLength(1);
    expect(rows[0]!.source).toBe(`admin:${s.ownerId}`);
    expect(rows[0]!.dedupe_key).toBe(`copilot:${r.body.items[0].id}`);
    expect(rows[0]!.subject_id).toBe(s.ownerId);
  });

  test('a coupon’s end is the store’s own day, and one already past is refused', async () => {
    const s = shared;
    await as(s.owner)('DELETE', '/copilot');
    const tz = 'America/Sao_Paulo';
    const day = addDays(localDateOf(new Date(), tz), 10);
    const ymd = `${day.year}-${String(day.month).padStart(2, '0')}-${String(day.day).padStart(2, '0')}`;
    const { rt, adapter } = runtime([
      tools(
        call('propose_coupon', {
          code: 'ontem10',
          kind: 'percent',
          value: 10,
          endsAt: new Date(Date.now() - 60_000).toISOString(),
        }),
      ),
      tools(call('propose_coupon', { code: 'pudim10', kind: 'percent', value: 10, endsAt: ymd })),
      // a date that doesn't exist is refused, never rolled into another day
      tools(
        call('propose_coupon', { code: 'fev31', kind: 'percent', value: 10, endsAt: '2030-02-31' }),
      ),
      // asked again for the same code: the newer card retires the older one
      tools(call('propose_coupon', { code: 'PUDIM10', kind: 'percent', value: 15 })),
      reply('Preparei o cupom. Confere no cartão e confirma.'),
    ]);
    await as(s.owner)('POST', '/copilot/messages', { text: 'cria um cupom de 10% por 10 dias' });
    await settle(rt, s.tenantId);
    expect(JSON.stringify(adapter.requests.at(1))).toContain('Essa validade já passou');
    const rows = await sql<{ input: { code: string; endsAt: string }; status: string }[]>`
      select input, status from copilot_actions
      where tenant_id = ${s.tenantId} and kind = 'coupon.create' order by created_at, id`;
    expect(rows.map((r) => [r.input.code, r.status])).toEqual([
      ['PUDIM10', 'expired'],
      ['PUDIM10', 'proposed'],
    ]);
    // a bare date is the end of that day in the store's calendar, never UTC midnight
    expect(rows[0]!.input.endsAt).toBe(zonedInstant(tz, day, 23 * 60 + 59).toISOString());
    // the ledger names the card; its values stay on the card, and the tap is how it applies
    expect(JSON.stringify(adapter.requests.at(3))).toContain('que existe');
    const told = JSON.stringify(adapter.requests.at(2));
    expect(told).toContain('o cartão \\"Criar um cupom\\" já mostra cada valor');
    expect(told).toContain('tocando em Confirmar');
    expect(told).not.toContain('Agora não');
    await as(s.owner)('DELETE', '/copilot');
  });

  test('a newer card retires an open one that touches the same thing, and only that', async () => {
    const s = shared;
    await as(s.owner)('DELETE', '/copilot');
    const a = await propose(s, 'product.update', {
      productId: s.productId,
      availability: 'sold_out_today',
    });
    const b = await propose(s, 'product.update', { productId: s.productId, priceCents: 4990 });
    // sold out + stock overlaps the first card; the price card stands
    const c = await propose(s, 'product.update', {
      productId: s.productId,
      availability: 'sold_out',
      stockQuantity: 0,
    });
    // a percentage over this product overlaps the price card
    const d = await propose(s, 'products.price', { productIds: [s.productId], percent: 10 });
    const status = async (id: string) =>
      (await sql<{ status: string }[]>`select status from copilot_actions where id = ${id}`)[0]!
        .status;
    expect([
      await status(a.id),
      await status(b.id),
      await status(c.id),
      await status(d.id),
    ]).toEqual(['expired', 'expired', 'proposed', 'proposed']);
    await as(s.owner)('DELETE', '/copilot');
  });

  test('a turn reads through the admin routes and proposes a pause that changes nothing', async () => {
    const s = shared;
    await as(s.owner)('DELETE', '/copilot');
    const { rt, adapter } = runtime([
      tools(call('store_now')),
      tools(call('propose_pause', { minutes: 30, message: 'Cozinha cheia, voltamos já!' })),
      reply('Preparei a pausa. Confere no cartão e confirma.'),
    ]);
    await as(s.owner)('POST', '/copilot/messages', {
      text: 'Pausa a loja por meia hora, a cozinha tá lotada',
      screen: '/',
    });
    await settle(rt, s.tenantId);

    // store_now answered with Core's figures, not typed numbers
    const toolResult = JSON.stringify(adapter.requests.at(1));
    expect(toolResult).toContain('{{hoje.vendas}}');

    const view = (await as(s.owner)('GET', '/copilot')).body;
    expect(view.busy).toBe(false);
    expect(view.items.map((i: any) => i.type)).toEqual(['message', 'message', 'action']);
    expect(view.items[1].author).toBe('dua');
    const card = view.items[2];
    expect(card).toMatchObject({
      kind: 'store.pause',
      title: 'Pausar a loja',
      status: 'proposed',
      money: false,
      canDecide: true,
    });
    expect(card.lines[0]).toEqual({
      label: 'Loja',
      from: 'Aberta, aceitando pedidos',
      to: 'Pausada',
    });
    expect(card.lines[2].to).toBe('Cozinha cheia, voltamos já!');

    // the dry run rolled back: still open, no audit row
    expect((await status(s.tenantId)).status_override).toBeNull();
    expect(await audits(s.tenantId, 'store.pause')).toHaveLength(0);

    // the tap applies it through POST /store/pause's own handler, named for the person
    const res = await as(s.owner)('POST', `/copilot/actions/${card.id}`, { decision: 'confirm' });
    expect(res.status).toBe(200);
    const applied = res.body.items.find((i: any) => i.id === card.id);
    expect(applied.status).toBe('applied');
    expect(applied.done).toMatch(/^Loja pausada até (hoje|amanhã) às \d{2}:\d{2}$/);
    expect(applied.canDecide).toBe(false);
    const st = await status(s.tenantId);
    expect(st.status_override).toBe('paused');
    const mins = (st.resumes_at!.getTime() - Date.now()) / 60_000;
    expect(mins).toBeGreaterThan(28);
    expect(mins).toBeLessThanOrEqual(30);
    const rows = await audits(s.tenantId, 'store.pause');
    expect(rows).toHaveLength(1);
    expect(rows[0]!.actor_label).toBe('Rita Souza pelo Duá');

    // a second tap (another key) and a replay of the first change nothing
    const again = await as(s.owner)('POST', `/copilot/actions/${card.id}`, { decision: 'confirm' });
    expect(again.status).toBe(200);
    expect(await audits(s.tenantId, 'store.pause')).toHaveLength(1);
  });

  test('every read tool answers from its route, with figures instead of typed amounts', async () => {
    const s = shared;
    await as(s.owner)('DELETE', '/copilot');
    const [cart] = await sql<{ id: string }[]>`
      insert into carts (tenant_id, session_hash) values (${s.tenantId}, ${`cp-${nonce}`}) returning id`;
    const [o] = await sql<{ id: string }[]>`
      insert into orders (tenant_id, cart_id, number, customer, customer_phone, delivery, payment,
                          state, subtotal_cents, total_cents, placed_at)
      values (${s.tenantId}, ${cart!.id}, 41, ${sql.json({ name: 'Bia Lima', phone: '21999990000' })},
              '21999990000', ${sql.json({ mode: 'pickup' })},
              ${sql.json({ provider: 'sandbox', method: 'pix', status: 'paid' })},
              'preparing', 9000, 9000, now())
      returning id`;
    await sql`
      insert into order_items (tenant_id, order_id, product_id, slug, name, qty, unit_price_cents,
                               modifiers, combo, line_total_cents, sort)
      values (${s.tenantId}, ${o!.id}, ${s.productId}, 'pudim-de-leite', 'Pudim de Leite', 2, 4500,
              '[]', '[]', 9000, 0)`;
    await as(s.owner)('POST', '/coupons', { code: 'LEITE5', kind: 'fixed', value: 500 });
    const { rt } = runtime([
      tools(
        call('store_now'),
        call('sales_report', { period: '7d', detail: 'completo' }),
        call('find_orders', { number: 41 }),
        call('find_orders', { state: 'active' }),
        call('menu', {}),
        call('menu', { query: 'leite' }),
        call('coupons'),
        call('top_customers'),
        call('kitchen_today'),
        call('store_settings'),
      ),
      reply('Tudo certo por aqui.'),
    ]);
    await as(s.owner)('POST', '/copilot/messages', { text: 'Me dá um panorama da loja' });
    await settle(rt, s.tenantId);

    const returned = await sql<{ name: string; ok: boolean; content: string }[]>`
      select e.payload ->> 'name' as name, (e.payload ->> 'ok')::boolean as ok,
             e.payload ->> 'content' as content
      from agent_events e join agent_actors a on a.id = e.actor_id
      where e.tenant_id = ${s.tenantId} and a.agent_id = 'copilot' and e.type = 'tool.returned'
        and e.payload ->> 'name' <> 'reply'
      order by e.seq`;
    expect(returned).toHaveLength(10);
    for (const r of returned)
      expect({ name: r.name, ok: r.ok }).toEqual({ name: r.name, ok: true });
    const out = Object.fromEntries(returned.map((r) => [r.name, r.content]));
    const all = returned.map((r) => r.content).join('\n');
    // amounts and times are ledger references, never typed
    expect(all).not.toMatch(/R\$\s*\d/);
    expect(out.store_now).toContain('Hoje até agora: {{hoje.vendas}} em 1 pedidos');
    expect(out.sales_report).toContain('Faturamento: {{rel.faturamento}}');
    const order = returned.find(
      (r) => r.name === 'find_orders' && r.content.startsWith('Pedido #41'),
    );
    expect(order?.content).toContain('2× Pudim de Leite');
    expect(order?.content).toContain(`(/pedidos/${o!.id})`);
    expect(out.menu).toMatch(/^## Pudins\n\w+ · Pudim de Leite · \{\{\w+\.preco\}\} · à venda$/m);
    expect(out.coupons).toContain('LEITE5');
    expect(out.top_customers).toContain('Bia · 1 pedidos');
    expect(out.top_customers).not.toContain('21999990000');
    expect(out.store_settings).toContain('Horário da semana: {{loja.horario}}');

    const view = (await as(s.owner)('GET', '/copilot')).body;
    expect(view.items.at(-1)).toMatchObject({ author: 'dua', text: 'Tudo certo por aqui.' });
  });

  test('the same confirm request replayed is stored, not re-applied', async () => {
    const s = shared;
    const p = await propose(s, 'product.update', { productId: s.productId, priceCents: 4990 });
    expect(p.lines).toEqual([{ label: 'Preço', from: 'R$ 45,00', to: 'R$ 49,90' }]);
    const { base_price_cents: before } = (
      await sql<{ base_price_cents: number }[]>`
      select base_price_cents from products where id = ${s.productId}`
    )[0]!;
    expect(before).toBe(4500);
    const headers = { cookie: s.owner, 'idempotency-key': `${nonce}-same` };
    const a = await request('POST', `/copilot/actions/${p.id}`, { decision: 'confirm' }, headers);
    const b = await request('POST', `/copilot/actions/${p.id}`, { decision: 'confirm' }, headers);
    expect(a.status).toBe(200);
    expect(b.status).toBe(200);
    const { base_price_cents: after } = (
      await sql<{ base_price_cents: number }[]>`
      select base_price_cents from products where id = ${s.productId}`
    )[0]!;
    expect(after).toBe(4990);
    expect(await audits(s.tenantId, 'product.update')).toHaveLength(1);
    const card = b.body.items.find((i: any) => i.id === p.id);
    expect(card).toMatchObject({
      status: 'applied',
      money: true,
      done: 'Pudim de Leite atualizado',
    });
  });

  test('a card never applies to values nobody saw', async () => {
    const s = shared;
    const p = await propose(s, 'products.price', { productIds: [s.productId], percent: 10 });
    // the price moves on the Cardápio screen before the tap
    await as(s.owner)('PATCH', `/products/${s.productId}`, { priceCents: 6000 });
    const r = await as(s.owner)('POST', `/copilot/actions/${p.id}`, { decision: 'confirm' });
    const card = r.body.items.find((i: any) => i.id === p.id);
    expect(card.status).toBe('failed');
    expect(card.error).toMatch(/^Isso mudou desde que o Duá preparou o cartão/);
    const { base_price_cents } = (
      await sql<{ base_price_cents: number }[]>`
        select base_price_cents from products where id = ${s.productId}`
    )[0]!;
    expect(base_price_cents).toBe(6000);

    // unchanged since the proposal: it applies, with the store's own rounding
    const q = await propose(s, 'products.price', { productIds: [s.productId], percent: 5 });
    expect(q.lines).toEqual([{ label: 'Pudim de Leite', from: 'R$ 60,00', to: 'R$ 63,00' }]);
    await as(s.owner)('POST', `/copilot/actions/${q.id}`, { decision: 'confirm' });
    const after = (
      await sql<{ base_price_cents: number }[]>`
        select base_price_cents from products where id = ${s.productId}`
    )[0]!;
    expect(after.base_price_cents).toBe(6300);
  });

  test('a stale pause or resume card never undoes a newer pause', async () => {
    const s = shared;
    await sql`update store_settings set status_override = null, resumes_at = null where tenant_id = ${s.tenantId}`;
    const short = await propose(s, 'store.pause', { minutes: 30 });
    // the owner pauses "até retomar" on the home screen before tapping the older card
    await as(s.owner)('POST', '/store/pause', { for: 'indefinite' });
    const a = await as(s.owner)('POST', `/copilot/actions/${short.id}`, { decision: 'confirm' });
    expect(a.body.items.find((i: any) => i.id === short.id).status).toBe('failed');
    expect(await status(s.tenantId)).toEqual({ status_override: 'paused', resumes_at: null });

    const resume = await propose(s, 'store.resume', {});
    await as(s.owner)('POST', '/store/pause', { for: 'minutes', minutes: 60 });
    const b = await as(s.owner)('POST', `/copilot/actions/${resume.id}`, { decision: 'confirm' });
    expect(b.body.items.find((i: any) => i.id === resume.id).status).toBe('failed');
    expect((await status(s.tenantId)).status_override).toBe('paused');
    await sql`update store_settings set status_override = null, resumes_at = null where tenant_id = ${s.tenantId}`;
  });

  test('a price card survives a product renamed meanwhile', async () => {
    const s = shared;
    const [c] = await sql<{ id: string }[]>`
      select id from categories where tenant_id = ${s.tenantId} limit 1`;
    const ids = (
      await sql<{ id: string }[]>`
        insert into products (tenant_id, category_id, slug, name, base_price_cents)
        values (${s.tenantId}, ${c!.id}, ${`a-${nonce}`}, 'Brigadeiro', 1000),
               (${s.tenantId}, ${c!.id}, ${`b-${nonce}`}, 'Cocada', 2000)
        returning id`
    ).map((r) => r.id);
    const p = await propose(s, 'products.price', { productIds: ids, percent: 10 });
    expect(p.lines.map((l) => l.label)).toEqual(['Brigadeiro', 'Cocada']);
    await sql`update products set name = 'Torta' where id = ${ids[0]!}`;
    const r = await as(s.owner)('POST', `/copilot/actions/${p.id}`, { decision: 'confirm' });
    expect(r.body.items.find((i: any) => i.id === p.id).status).toBe('applied');
    const prices = await sql<{ base_price_cents: number }[]>`
      select base_price_cents from products where id = any(${ids}::uuid[]) order by base_price_cents`;
    expect(prices.map((x) => x.base_price_cents)).toEqual([1100, 2200]);
  });

  test('an impossible date is a 400 on the route and a tool error for Duá', async () => {
    const s = shared;
    const bad = await as(s.owner)('GET', '/reports?from=2026-02-31&to=2026-03-02');
    expect(bad.status).toBe(400);
    const orders = await as(s.owner)('GET', '/orders?from=2026-02-30');
    expect(orders.status).toBe(400);
    await as(s.owner)('DELETE', '/copilot');
    const { rt } = runtime([
      tools(call('sales_report', { from: '2026-02-31', to: '2026-03-02' })),
      reply('Essa data não existe. Qual período você quer?'),
    ]);
    await as(s.owner)('POST', '/copilot/messages', { text: 'vendas de 31/02 a 02/03' });
    await settle(rt, s.tenantId);
    const view = (await as(s.owner)('GET', '/copilot')).body;
    expect(view.items.at(-1).text).toBe('Essa data não existe. Qual período você quer?');
  });

  test('declined and expired cards never apply', async () => {
    const s = shared;
    const declined = await propose(s, 'store.operations', { prepTimeMinutes: 40 });
    const d = await as(s.owner)('POST', `/copilot/actions/${declined.id}`, { decision: 'decline' });
    expect(d.body.items.find((i: any) => i.id === declined.id).status).toBe('declined');
    await as(s.owner)('POST', `/copilot/actions/${declined.id}`, { decision: 'confirm' });

    const late = await propose(s, 'store.operations', { prepTimeMinutes: 50 });
    await sql`update copilot_actions set expires_at = now() - interval '1 minute' where id = ${late.id}`;
    expect(
      (await as(s.owner)('GET', '/copilot')).body.items.find((i: any) => i.id === late.id).status,
    ).toBe('expired');
    const e = await as(s.owner)('POST', `/copilot/actions/${late.id}`, { decision: 'confirm' });
    expect(e.body.items.find((i: any) => i.id === late.id).status).toBe('expired');

    const { prep_time_minutes } = (
      await sql<{ prep_time_minutes: number }[]>`
      select prep_time_minutes from store_settings where tenant_id = ${s.tenantId}`
    )[0]!;
    expect(prep_time_minutes).toBe(25);
  });

  test('what the store refuses is refused when proposed, and recorded when confirmed', async () => {
    const s = shared;
    // a code already taken: the dry run hits the route's 409, nothing is proposed
    await as(s.owner)('POST', '/coupons', { code: 'PUDIM10', kind: 'percent', value: 10 });
    const taken = await propose(s, 'coupon.create', {
      code: 'PUDIM10',
      kind: 'percent',
      value: 10,
    }).catch((e) => e);
    expect(taken).toBeInstanceOf(HttpError);
    expect(taken.code).toBe('COUPON_EXISTS');

    // taken between the proposal and the tap: the card says why, the claim stores it
    const p = await propose(s, 'coupon.create', { code: 'VOLTA10', kind: 'percent', value: 10 });
    expect(p.lines.slice(0, 2)).toEqual([
      { label: 'Código', from: null, to: 'VOLTA10' },
      { label: 'Desconto', from: null, to: '10% de desconto' },
    ]);
    expect(
      await sql`select 1 from coupons where tenant_id = ${s.tenantId} and code = 'VOLTA10'`,
    ).toHaveLength(0);
    await as(s.owner)('POST', '/coupons', { code: 'VOLTA10', kind: 'fixed', value: 500 });
    const r = await as(s.owner)('POST', `/copilot/actions/${p.id}`, { decision: 'confirm' });
    expect(r.status).toBe(200);
    const card = r.body.items.find((i: any) => i.id === p.id);
    expect(card.status).toBe('failed');
    expect(card.error).toBe('Já existe um cupom com esse código.');
    const coupons = await sql<{ kind: string }[]>`
      select kind from coupons where tenant_id = ${s.tenantId} and code = 'VOLTA10'`;
    expect(coupons.map((c) => c.kind)).toEqual(['fixed']);
  });

  test("a card is its person's: other people and other stores get a 404", async () => {
    const s = shared;
    const p = await propose(s, 'store.resume', {});
    const managerPhone = phone();
    await sql`insert into merchant_users (tenant_id, name, phone, role)
      values (${s.tenantId}, 'Lia', ${managerPhone}, 'manager')`;
    const lia = await signIn(managerPhone);
    expect((await as(lia)('GET', '/copilot')).body.items).toEqual([]);
    const other = await as(lia)('POST', `/copilot/actions/${p.id}`, { decision: 'confirm' });
    expect(other.status).toBe(404);
    const elsewhere = await store();
    const far = await as(elsewhere.owner)('POST', `/copilot/actions/${p.id}`, {
      decision: 'confirm',
    });
    expect(far.status).toBe(404);
    expect(
      (await as(s.owner)('POST', `/copilot/actions/not-a-uuid`, { decision: 'confirm' })).status,
    ).toBe(400);
  });

  test('a special day merges into the list as it is when confirmed', async () => {
    const s = shared;
    const p = await propose(s, 'store.special_day', {
      date: '2099-12-25',
      closed: true,
      label: 'Natal',
    });
    expect(p.lines[1]).toEqual({ label: 'Funcionamento', from: 'Horário normal', to: 'Fechada' });
    // the merchant adds another day meanwhile: confirming keeps it
    await as(s.owner)('PATCH', '/store', {
      specialDays: [{ date: '2099-12-31', closed: false, open: '10:00', close: '14:00' }],
    });
    await as(s.owner)('POST', `/copilot/actions/${p.id}`, { decision: 'confirm' });
    const { special_days } = (
      await sql<{ special_days: { date: string }[] }[]>`
      select special_days from store_settings where tenant_id = ${s.tenantId}`
    )[0]!;
    expect(special_days.map((d: { date: string }) => d.date)).toEqual(['2099-12-25', '2099-12-31']);
  });

  test('a reply is written once per step, and a new conversation forgets', async () => {
    const s = shared;
    const msg = {
      actorId: crypto.randomUUID(),
      tenantId: s.tenantId,
      subject: { kind: 'copilot', id: s.ownerId },
      turnId: 'turn-1',
      step: 1,
      text: 'Oi!',
      cards: [],
    };
    const fenced = (fn: (tx: Sql) => Promise<unknown>) =>
      withTenant(appSql, s.tenantId, (tx) => fn(tx));
    await fenced((tx) => copilotTransport.send({ host: tx } as never, msg as never));
    await fenced((tx) => copilotTransport.send({ host: tx } as never, msg as never));
    expect(
      await sql`select 1 from copilot_messages where tenant_id = ${s.tenantId} and turn_id = 'turn-1'`,
    ).toHaveLength(1);

    await propose(s, 'store.operations', { demand: 'high' });
    const cleared = await as(s.owner)('DELETE', '/copilot');
    expect(cleared.body).toMatchObject({ items: [], busy: false });
    expect(await sql`select 1 from copilot_actions where tenant_id = ${s.tenantId}`).toHaveLength(
      0,
    );
  });
});
