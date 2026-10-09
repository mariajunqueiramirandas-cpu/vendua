import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { join } from 'node:path';
import { Hono } from 'hono';
import postgres from 'postgres';
import { createApp } from '../src/app.ts';
import { mountAgentRuntimeAi } from '../src/agent-host/control-ai.ts';
import { aiAllowanceTx } from '../src/modules/billing/ai-allowance.ts';
import { validateSetting } from '../src/modules/integrations.ts';
import { migrate, withTenant } from '../src/platform/db.ts';

// The CRM's customer fleet (Visão, Lojas, IA): every store's revenue, activity and Duá, read
// across stores under controlTx — and, with the app role, through RLS as in production.

const DAY = 86_400_000;
const T1 = 'abcdef12-2222-4333-8444-5555555555ee';
const route = (over: Record<string, unknown> = {}) => ({
  provider: 'openrouter',
  model: 'anthropic/claude-haiku-4.5',
  zdr: true,
  ...over,
});

describe('validateSetting: agent_runtime.routes and agent_runtime.budgets', () => {
  const field = (key: string, value: unknown) => {
    try {
      validateSetting(key, value);
      return null;
    } catch (e) {
      const err = e as { status: number; details?: { field?: string }; message: string };
      expect(err.status).toBe(422);
      return err;
    }
  };

  test('routes: a full setting passes', () => {
    expect(
      field('agent_runtime.routes', {
        default: {
          fast: [
            route({
              pricing: { inputPerMTok: 1, outputPerMTok: 5, cacheReadPerMTok: 0.1 },
              timeoutMs: 30_000,
            }),
            route({ provider: 'anthropic', model: 'claude-haiku-5-5', effort: 'low' }),
          ],
          strong: [route({ provider: 'gemini', model: 'models/gemini-2.5-pro:latest' })],
        },
        agents: { vendedor: { strong: [route()] }, 'vendedor-onboarding': {} },
        tenants: { [T1]: { fast: [route({ provider: 'openai', model: 'gpt-5-mini' })] } },
      }),
    ).toBeNull();
    expect(field('agent_runtime.routes', {})).toBeNull();
  });

  test('routes: each wrong shape names its field', () => {
    const cases: [unknown, string][] = [
      [[], '*'],
      [{ fallback: {} }, 'fallback'],
      [{ default: { medium: [route()] } }, 'default.medium'],
      [{ default: { fast: route() } }, 'default.fast'],
      [{ default: { fast: Array.from({ length: 6 }, () => route()) } }, 'default.fast'],
      // an empty list would shadow the levels below and leave the agent with no model
      [{ default: { fast: [] } }, 'default.fast'],
      [{ tenants: { [T1]: { strong: [] } } }, `tenants.${T1}.strong`],
      [{ default: { fast: [route({ provider: 'mistral' })] } }, 'default.fast.0.provider'],
      [{ default: { fast: [route({ model: '' })] } }, 'default.fast.0.model'],
      [{ default: { fast: [route({ model: 'a b' })] } }, 'default.fast.0.model'],
      [{ default: { fast: [route({ model: 'x'.repeat(201) })] } }, 'default.fast.0.model'],
      [{ default: { fast: [route({ zdr: 'yes' })] } }, 'default.fast.0.zdr'],
      // anthropic always runs claude-haiku-5-5 at its own price; effort is the choice
      [
        { default: { fast: [route({ provider: 'anthropic', model: 'claude-opus-5-5' })] } },
        'default.fast.0.model',
      ],
      [
        {
          default: {
            fast: [
              route({
                provider: 'anthropic',
                model: 'claude-haiku-5-5',
                pricing: { inputPerMTok: 1, outputPerMTok: 5 },
              }),
            ],
          },
        },
        'default.fast.0.pricing',
      ],
      [
        {
          default: {
            fast: [route({ provider: 'anthropic', model: 'claude-haiku-5-5', effort: 'huge' })],
          },
        },
        'default.fast.0.effort',
      ],
      [{ default: { fast: [route({ effort: 'low' })] } }, 'default.fast.0.effort'],
      [{ default: { fast: [route({ apiKey: 'k' })] } }, 'default.fast.0.apiKey'],
      [{ default: { fast: [route({ timeoutMs: 999 })] } }, 'default.fast.0.timeoutMs'],
      [{ default: { fast: [route({ timeoutMs: 1500.5 })] } }, 'default.fast.0.timeoutMs'],
      [
        { default: { fast: [route({ pricing: { inputPerMTok: 1 } })] } },
        'default.fast.0.pricing.outputPerMTok',
      ],
      [
        { default: { fast: [route({ pricing: { inputPerMTok: 1001, outputPerMTok: 1 } })] } },
        'default.fast.0.pricing.inputPerMTok',
      ],
      [
        { default: { fast: [route({ pricing: { inputPerMTok: 1, outputPerMTok: 1, x: 1 } })] } },
        'default.fast.0.pricing.x',
      ],
      [{ agents: { Vendedor: {} } }, 'agents.Vendedor'],
      [
        { agents: Object.fromEntries(Array.from({ length: 21 }, (_, i) => [`a${i}`, {}])) },
        'agents',
      ],
      [{ tenants: { 'not-a-uuid': {} } }, 'tenants.not-a-uuid'],
      [{ tenants: { [T1.toUpperCase()]: {} } }, `tenants.${T1.toUpperCase()}`],
      [
        { tenants: { [T1]: { strong: [route({ provider: 1 })] } } },
        `tenants.${T1}.strong.0.provider`,
      ],
    ];
    for (const [value, f] of cases)
      expect({ value, field: field('agent_runtime.routes', value)?.details?.field }).toEqual({
        value,
        field: f,
      });
  });

  test('routes: zdr is a per-route choice, but must be a boolean', () => {
    expect(
      field('agent_runtime.routes', { default: { fast: [route({ zdr: false })] } }),
    ).toBeNull();
    const { zdr: _omit, ...noZdr } = route();
    for (const r of [noZdr, route({ zdr: null }), route({ zdr: 1 }), route({ zdr: 'false' })])
      expect(field('agent_runtime.routes', { default: { fast: [r] } })?.details?.field).toBe(
        'default.fast.0.zdr',
      );
  });

  test('budgets: keys with USD a day, per store overrides', () => {
    expect(
      field('agent_runtime.budgets', {
        vendedor: 5,
        crm_agent: 0,
        tenants: { [T1]: { vendedor: 10000 } },
      }),
    ).toBeNull();
    expect(field('agent_runtime.budgets', {})).toBeNull();
    const cases: [unknown, string][] = [
      [null, '*'],
      [{ vendedor: -1 }, 'vendedor'],
      [{ vendedor: 10_001 }, 'vendedor'],
      [{ vendedor: '5' }, 'vendedor'],
      [{ 'Bad Key': 1 }, 'Bad Key'],
      [Object.fromEntries(Array.from({ length: 21 }, (_, i) => [`k${i}`, 1])), '*'],
      [{ tenants: [] }, 'tenants'],
      [{ tenants: { x: { vendedor: 1 } } }, 'tenants.x'],
      [{ tenants: { [T1]: { vendedor: Number.NaN } } }, `tenants.${T1}.vendedor`],
      [{ tenants: { [T1]: 3 } }, `tenants.${T1}`],
    ];
    for (const [value, f] of cases)
      expect({ value, field: field('agent_runtime.budgets', value)?.details?.field }).toEqual({
        value,
        field: f,
      });
  });
});

describe.skipIf(!process.env.TEST_DATABASE_URL)('control customers (db)', () => {
  const OWNER_URL = process.env.TEST_DATABASE_URL!;
  const sql = postgres(OWNER_URL, { onnotice: () => {} });
  // the API runs as vendua_app, so a cross-store read that RLS would hide shows up here
  const appSql = postgres(
    process.env.TEST_APP_DATABASE_URL ??
      OWNER_URL.replace(/\/\/[^@]+@/, '//vendua_app:vendua_app@'),
    { onnotice: () => {} },
  );
  const app = createApp({
    sql: appSql,
    sessionSecret: 's',
    controlSecret: 'ctl',
    autoDrain: false,
    cepLookup: async () => null,
    storeDomain: 'vendua.test',
  });
  const nonce = crypto.randomUUID().slice(0, 6);
  const created: string[] = [];
  let idem = 0;
  let savedSettings: { key: string; value: unknown }[] = [];

  const call = async (method: string, path: string, body?: unknown, staff = true) => {
    const res = await app.request(`http://core.localhost${path}`, {
      method,
      headers: {
        host: 'core.localhost',
        'content-type': 'application/json',
        ...(staff ? { 'x-vendua-control': 'ctl' } : {}),
        ...(method === 'GET' ? {} : { 'idempotency-key': `cc-${nonce}-${++idem}` }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    return { status: res.status, body: (await res.json()) as any };
  };

  const ago = (ms: number) => new Date(Date.now() - ms);

  const store = async (
    name: string,
    plan: string,
    sub: { status: string; trialEndsAt?: Date } | null,
    createdAgo = 0,
  ) => {
    const slug = `cc-${nonce}-${name}`;
    const phone = `219${String(Date.now() + created.length * 13).slice(-8)}`;
    const id = (
      await sql<{ id: string }[]>`
        select provision_store(${slug}, ${'Loja ' + name}, ${plan}, ${`${slug}.vendua.test`},
                               'Bia Dona', ${phone}, 'bia@example.com') as id
      `
    )[0]!.id;
    created.push(id);
    await sql`update tenants set created_at = ${ago(createdAgo)} where id = ${id}`;
    if (sub) {
      // a trial's allowance counts from the subscription's start
      await sql`
        insert into subscriptions (tenant_id, plan_id, method, status, provider, payer_email,
                                   current_period_start, current_period_end, trial_ends_at,
                                   created_at)
        values (${id}, ${plan}, 'pix', ${sub.status}, 'fake', 'bia@example.com', now(),
                now() + interval '30 days', ${sub.trialEndsAt ?? null}, ${ago(createdAgo)})
      `;
      await sql`update store_settings set billing_hold = false, status_override = null where tenant_id = ${id}`;
    }
    return { id, slug };
  };

  let orderNo = 0;
  const order = async (tenantId: string, cents: number, placedAt: Date, state = 'delivered') => {
    const cart = (
      await sql<{ id: string }[]>`
        insert into carts (tenant_id, session_hash) values (${tenantId}, ${`cc-${nonce}-${++orderNo}`})
        returning id
      `
    )[0]!.id;
    await sql`
      insert into orders (tenant_id, cart_id, number, customer, customer_phone, delivery, payment,
                          state, subtotal_cents, total_cents, placed_at)
      values (${tenantId}, ${cart}, ${orderNo}, ${sql.json({ name: 'Ana', phone: '21999990000' })},
              '21999990000', ${sql.json({ mode: 'pickup' })},
              ${sql.json({ provider: 'sandbox', method: 'pix', status: 'paid' })},
              ${state}, ${cents}, ${cents}, ${placedAt})
    `;
  };

  const conversations = (
    tenantId: string,
    source: string,
    n: number,
    credit: string | null = null,
  ) =>
    sql`
      insert into ai_conversations (tenant_id, subject_key, source, started_at, credit_id)
      select ${tenantId}, ${`cc-${nonce}-`} || g || ${source}, ${source}, now() - interval '1 minute',
             ${credit}::uuid
      from generate_series(1, ${n}) g
    `;

  let seq = 0;
  const responded = async (
    tenantId: string,
    provider: string,
    model: string,
    costUsd: number,
    at: Date,
  ) => {
    const actor = (
      await sql<{ id: string }[]>`
        insert into agent_actors (tenant_id, agent_id, subject_kind, subject_id, lane)
        values (${tenantId}, 'vendedor', 'shopper_thread', ${`cc-${nonce}`}, 'interactive')
        on conflict (tenant_id, agent_id, subject_kind, subject_id) do update set updated_at = now()
        returning id
      `
    )[0]!.id;
    await sql`
      insert into agent_events (tenant_id, actor_id, seq, type, payload, version, at)
      values (${tenantId}, ${actor}, ${++seq}, 'model.responded',
              ${sql.json({
                tier: 'fast',
                provider,
                model,
                usage: { inputTokens: 1000, outputTokens: 100, costUsd },
              })}, 'v_test', ${at})
    `;
  };

  let A: { id: string; slug: string };
  let B: { id: string; slug: string };
  let C: { id: string; slug: string };
  let D: { id: string; slug: string };
  let E: { id: string; slug: string };
  let openInvoiceId: string;

  beforeAll(async () => {
    await migrate(sql, join(import.meta.dir, '../db/migrations'));
    savedSettings = await sql<{ key: string; value: unknown }[]>`
      select key, value from control_settings
      where key in ('agent_runtime.routes', 'agent_runtime.budgets')
    `;
    // A: Bandeira, paying, selling, a pack, Duá in use, WhatsApp in error
    A = await store('a', 'bandeira', { status: 'active' }, 40 * DAY);
    await order(A.id, 1000, ago(3600_000));
    await order(A.id, 2500, ago(2 * DAY));
    await order(A.id, 4000, ago(10 * DAY));
    await order(A.id, 9900, ago(5 * DAY), 'cancelled');
    await order(A.id, 7000, ago(45 * DAY));
    openInvoiceId = (
      await sql<{ id: string }[]>`
        insert into invoices (tenant_id, number, plan_id, amount_cents, period_start, period_end,
                              method, status, provider, due_at)
        values (${A.id}, 1, 'bandeira', 16900, now(), now() + interval '30 days', 'pix', 'open',
                'fake', now() + interval '3 days')
        returning id
      `
    )[0]!.id;
    const packInvoice = (
      await sql<{ id: string }[]>`
        insert into invoices (tenant_id, number, plan_id, amount_cents, period_start, period_end,
                              method, status, provider, due_at, paid_at, kind, ai_pack_id,
                              ai_conversations)
        values (${A.id}, 2, 'bandeira', 3990, now() - interval '1 day', now() - interval '1 day',
                'pix', 'paid', 'fake', now(), now(), 'ai_pack', 'ai_100', 100)
        returning id
      `
    )[0]!.id;
    const credit = (
      await sql<{ id: string }[]>`
        insert into ai_credits (tenant_id, invoice_id, conversations, expires_at)
        values (${A.id}, ${packInvoice}, 100, now() + interval '20 days') returning id
      `
    )[0]!.id;
    await conversations(A.id, 'plan', 2);
    await conversations(A.id, 'pack', 1, credit);
    await responded(A.id, 'anthropic', `claude-cc-${nonce}`, 0.01, ago(3600_000));
    await responded(A.id, 'openrouter', `or-cc-${nonce}`, 0.02, ago(2 * DAY));
    await responded(A.id, 'openrouter', `or-cc-${nonce}`, 0.5, ago(10 * DAY));
    // inside a rolling 30 days, but on the São Paulo day before the charts' first bar
    await responded(A.id, 'openrouter', `or-cc-${nonce}`, 0.004, ago(30 * DAY - 60_000));
    await sql`
      insert into store_whatsapp (tenant_id, wanted, state, detail, state_changed_at)
      values (${A.id}, true, 'error', 'socket_closed', now() - interval '2 hours')
    `;
    await sql`
      insert into print_devices (tenant_id, name, platform, last_seen_at)
      values (${A.id}, 'Balcão', 'windows', now() - interval '5 minutes')
    `;
    await sql`update merchant_users set last_seen_at = now() where tenant_id = ${A.id}`;

    // B: Mirim past due, quiet for weeks
    B = await store('b', 'mirim', { status: 'past_due' }, 20 * DAY);
    // C: Bandeira trial ending in 3 days, its 50 trial conversations spent
    C = await store(
      'c',
      'bandeira',
      { status: 'trialing', trialEndsAt: new Date(Date.now() + 3 * DAY) },
      DAY,
    );
    await conversations(C.id, 'trial', 50);
    // D: Pangolim cancelled
    D = await store('d', 'pangolim', { status: 'cancelled' }, 60 * DAY);
    // E: Mirim, paying but suspended
    E = await store('e', 'mirim', { status: 'active' });
    await sql`update tenants set status = 'suspended' where id = ${E.id}`;
    await order(E.id, 1500, ago(DAY));
  });

  afterAll(async () => {
    await sql`delete from control_settings where key in ('agent_runtime.routes', 'agent_runtime.budgets')`;
    for (const s of savedSettings)
      await sql`insert into control_settings (key, value) values (${s.key}, ${sql.json(s.value as never)})`;
    if (created.length) await sql`delete from tenants where id in ${sql(created)}`;
    await appSql.end();
    await sql.end();
  });

  test('staff only: without the staff credential every read is a 404', async () => {
    for (const p of [
      '/control/v1/customers',
      '/control/v1/customers/overview',
      `/control/v1/customers/${created[0]}`,
      '/control/v1/ai/models',
      '/control/v1/ai/usage?days=7',
    ])
      expect((await call('GET', p, undefined, false)).status).toBe(404);
  });

  test('store_fleet_facts() answers only the control session, never a store', async () => {
    const asStore = await withTenant(
      appSql,
      created[0]!,
      (tx) => tx`select * from store_fleet_facts()`,
    );
    expect(asStore.length).toBe(0);
    const bare = await appSql`select * from store_fleet_facts()`;
    expect(bare.length).toBe(0);
  });

  test('bad and unknown ids: 400 for a non-uuid, 404 NOT_FOUND for an unknown store', async () => {
    const bad = await call('GET', '/control/v1/customers/not-a-uuid');
    expect(bad.status).toBe(400);
    const missing = await call('GET', `/control/v1/customers/${crypto.randomUUID()}`);
    expect(missing.status).toBe(404);
    expect(missing.body.error.code).toBe('NOT_FOUND');
  });

  test('the list: plan, MRR, orders, AI, channels and risk per store', async () => {
    const res = await call('GET', '/control/v1/customers');
    expect(res.status).toBe(200);
    expect(typeof res.body.asOf).toBe('string');
    const by = new Map<string, any>(res.body.stores.map((s: any) => [s.id, s]));
    const a = by.get(A.id);
    expect(a).toMatchObject({
      slug: A.slug,
      name: 'Loja a',
      status: 'active',
      url: `https://${A.slug}.vendua.test`,
      plan: { id: 'bandeira', name: 'Venduá Bandeira', priceCents: 16900 },
      subscription: { status: 'active', method: 'pix', trialEndsAt: null },
      mrrCents: 16900,
      openInvoice: { id: openInvoiceId, number: 1, amountCents: 16900, kind: 'period' },
      orders: { count30d: 3, gmv30dCents: 7500 },
      ai: { included: true, period: 'month', limit: 250, used: 2, packRemaining: 99 },
      whatsapp: { state: 'error' },
      printing: { devices: 1 },
      storefront: { probe: 'unknown', openIncidents: 0 },
      risk: ['whatsapp_down'],
    });
    expect(a.ai.remaining).toBe(248 + 99);
    expect(a.ai.spend30dUsd).toBeCloseTo(0.53, 6);
    expect(new Date(a.orders.lastAt).getTime()).toBeGreaterThan(Date.now() - 2 * 3600_000);
    expect(a.adminLastSeenAt).not.toBeNull();
    expect(new Date(a.createdAt).toISOString()).toBe(a.createdAt);

    expect(by.get(B.id)).toMatchObject({
      mrrCents: 6990,
      plan: { id: 'mirim' },
      ai: { included: false, period: null, limit: 0, remaining: 0 },
      orders: { count30d: 0, gmv30dCents: 0, lastAt: null },
      whatsapp: null,
      printing: null,
      risk: ['past_due', 'no_orders_14d', 'admin_idle_14d'],
    });
    expect(by.get(C.id)).toMatchObject({
      mrrCents: 0,
      subscription: { status: 'trialing' },
      ai: { included: true, period: 'trial', limit: 50, used: 50, remaining: 0 },
      risk: ['ai_exhausted', 'trial_ending'],
    });
    expect(by.get(D.id)).toMatchObject({ mrrCents: 0, risk: ['cancelled'] });
    expect(by.get(E.id)).toMatchObject({
      mrrCents: 6990,
      status: 'suspended',
      risk: ['suspended'],
    });
  });

  test('allowance parity: the list and the detail say what aiAllowanceTx says', async () => {
    const list = await call('GET', '/control/v1/customers');
    for (const s of [A, B, C, D, E]) {
      const want = await withTenant(appSql, s.id, (tx) => aiAllowanceTx(tx, s.id));
      const row = list.body.stores.find((r: any) => r.id === s.id);
      const { spend30dUsd: _, ...ai } = row.ai;
      expect({ id: s.slug, ...ai }).toEqual({
        id: s.slug,
        included: want.included,
        period: want.period,
        limit: want.limit,
        used: want.used,
        packRemaining: want.packRemaining,
        remaining: want.remaining,
      });
      const detail = await call('GET', `/control/v1/customers/${s.id}`);
      expect(detail.body.ai).toEqual(JSON.parse(JSON.stringify(want)));
    }
  });

  test('billing/stores?tenant= reads one store, whatever the list cap', async () => {
    const one = await call('GET', `/control/v1/billing/stores?tenant=${A.id.toUpperCase()}`);
    expect(one.status).toBe(200);
    expect(one.body.stores).toHaveLength(1);
    expect(one.body.stores[0]).toMatchObject({ tenantId: A.id });
    expect(one.body.stores[0].openInvoice).toMatchObject({ id: openInvoiceId });
    expect((await call('GET', '/control/v1/billing/stores?tenant=nope')).status).toBe(400);
  });

  test('the detail: daily series, invoices, admins, printers, WhatsApp and storefront', async () => {
    const res = await call('GET', `/control/v1/customers/${A.id.toUpperCase()}`);
    expect(res.status).toBe(200);
    const d = res.body;
    expect(d.store.id).toBe(A.id);
    expect(d.daily).toHaveLength(30);
    expect(d.daily.reduce((n: number, x: any) => n + x.orders, 0)).toBe(3);
    expect(d.daily.reduce((n: number, x: any) => n + x.gmvCents, 0)).toBe(7500);
    expect(d.daily.reduce((n: number, x: any) => n + x.conversations, 0)).toBe(3);
    expect(d.daily.reduce((n: number, x: any) => n + x.aiUsd, 0)).toBeCloseTo(0.53, 6);
    // the KPI is the sum of its bars
    expect(d.store.ai.spend30dUsd).toBeCloseTo(0.53, 6);
    expect(d.daily[0].day < d.daily[29].day).toBe(true);
    expect(d.daily[29].day).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(d.ai.packExpiresAt).not.toBeNull();
    expect(d.ai.resetsAt).not.toBeNull();
    expect(d.invoices.map((i: any) => i.number).sort()).toEqual([1, 2]);
    expect(d.invoices.find((i: any) => i.number === 2)).toMatchObject({
      kind: 'ai_pack',
      status: 'paid',
      amountCents: 3990,
    });
    expect(d.users).toHaveLength(1);
    expect(d.users[0]).toMatchObject({ name: 'Bia Dona', role: 'owner' });
    expect(d.printers).toEqual([
      { id: expect.any(String), name: 'Balcão', lastSeenAt: expect.any(String) },
    ]);
    expect(d.whatsapp).toMatchObject({ state: 'error', connectedAt: null });
    expect(d.storefront).toEqual({
      probe: 'unknown',
      lastProbeAt: null,
      openIncidents: 0,
      kernel: null,
    });
  });

  test('the overview: revenue, activity, AI and stores at risk', async () => {
    const [ov, list] = await Promise.all([
      call('GET', '/control/v1/customers/overview'),
      call('GET', '/control/v1/customers'),
    ]);
    expect(ov.status).toBe(200);
    const o = ov.body;
    const stores: any[] = list.body.stores;
    const sum = (f: (s: any) => number) => stores.reduce((n, s) => n + f(s), 0);
    expect(o.revenue.mrrCents).toBe(sum((s) => s.mrrCents));
    expect(o.revenue.byPlan.reduce((n: number, b: any) => n + b.mrrCents, 0)).toBe(
      o.revenue.mrrCents,
    );
    expect(o.revenue.byPlan.find((b: any) => b.planId === 'mirim').stores).toBeGreaterThanOrEqual(
      2,
    );
    expect(o.revenue.payingStores).toBeGreaterThanOrEqual(3);
    expect(o.revenue.pastDue).toBeGreaterThanOrEqual(1);
    expect(o.revenue.openInvoices.count).toBeGreaterThanOrEqual(1);
    expect(o.revenue.openInvoices.amountCents).toBeGreaterThanOrEqual(16900);
    expect(o.revenue.trialsEndingSoon).toContainEqual({
      id: C.id,
      slug: C.slug,
      name: 'Loja c',
      plan: 'Venduá Bandeira',
      trialEndsAt: expect.any(String),
    });
    expect(o.revenue.cancelled30d).toBeGreaterThanOrEqual(1);
    expect(o.revenue.newStores30d).toBe(
      stores.filter((s) => Date.now() - Date.parse(s.createdAt) <= 30 * DAY).length,
    );
    expect(o.activity.daily).toHaveLength(30);
    expect(o.activity.orders30d).toBe(sum((s) => s.orders.count30d));
    expect(o.activity.gmv30dCents).toBe(sum((s) => s.orders.gmv30dCents));
    expect(o.activity.daily.reduce((n: number, d: any) => n + d.orders, 0)).toBe(
      o.activity.orders30d,
    );
    expect(o.activity.daily.reduce((n: number, d: any) => n + d.gmvCents, 0)).toBe(
      o.activity.gmv30dCents,
    );
    // a suspended store that sold isn't counted, so "x de y ativas" never exceeds y
    expect(o.activity.activeStores30d).toBe(
      stores.filter((s) => s.status === 'active' && s.orders.count30d > 0).length,
    );
    expect(o.activity.activeStores30d).toBeLessThanOrEqual(o.totals.active);
    expect(o.ai.conversationsThisMonth).toBeGreaterThanOrEqual(53);
    expect(o.ai.byModel).toContainEqual({
      provider: 'openrouter',
      model: `or-cc-${nonce}`,
      calls: 2,
      usd: expect.closeTo(0.52, 6),
    });
    expect(o.ai.exhaustedStores).toBeGreaterThanOrEqual(1);
    expect(o.ai.top.find((t: any) => t.id === A.id)).toMatchObject({ used: 2, limit: 250 });
    // "lojas que mais conversam": ranked by conversations, spend only breaks ties
    const used = o.ai.top.map((t: any) => t.used);
    expect(used).toEqual([...used].sort((a, b) => b - a));
    expect(o.atRisk.length).toBeLessThanOrEqual(20);
    expect(o.atRisk.every((r: any) => r.risk.length > 0 && r.risk[0] !== 'cancelled')).toBe(true);
    expect(o.totals.stores).toBe(stores.length);
    expect(o.totals.active + o.totals.suspended).toBe(stores.length);
  });

  test('ai/usage: calls, spend and conversations per store and model over 7 or 30 days', async () => {
    expect((await call('GET', '/control/v1/ai/usage?days=8')).status).toBe(422);
    expect((await call('GET', '/control/v1/ai/usage?days=abc')).status).toBe(422);
    const put = await call('PUT', '/control/v1/settings/agent_runtime.budgets', {
      value: { vendedor: 2, tenants: { [A.id]: { vendedor: 5 } } },
    });
    expect(put.status).toBe(200);
    const bad = await call('PUT', '/control/v1/settings/agent_runtime.budgets', {
      value: { vendedor: -2 },
    });
    expect(bad.status).toBe(422);
    expect(bad.body.error.details.field).toBe('vendedor');

    const week = await call('GET', '/control/v1/ai/usage?days=7');
    expect(week.status).toBe(200);
    expect(week.body.days).toBe(7);
    const a7 = week.body.byStore.find((s: any) => s.id === A.id);
    expect(a7).toEqual({
      id: A.id,
      slug: A.slug,
      name: 'Loja a',
      calls: 2,
      usd: expect.closeTo(0.03, 6),
      conversations: 3,
      used: 2,
      limit: 250,
      remaining: 347,
      dailyLimitUsd: 5,
    });
    expect(week.body.byModel).toContainEqual({
      provider: 'openrouter',
      model: `or-cc-${nonce}`,
      calls: 1,
      usd: expect.closeTo(0.02, 6),
    });
    const month = await call('GET', '/control/v1/ai/usage?days=30');
    const a30 = month.body.byStore.find((s: any) => s.id === A.id);
    expect(a30).toMatchObject({ calls: 3, usd: expect.closeTo(0.53, 6) });
    expect(month.body.byStore.find((s: any) => s.id === C.id)).toMatchObject({
      conversations: 50,
      used: 50,
      limit: 50,
      remaining: 0,
      dailyLimitUsd: 2,
    });
    // B has no Vendedor and no use: it isn't listed
    expect(month.body.byStore.find((s: any) => s.id === B.id)).toBeUndefined();
    const t = month.body.totals;
    expect(t.calls).toBe(month.body.byModel.reduce((n: number, m: any) => n + m.calls, 0));
    expect(t.usd).toBeCloseTo(
      month.body.byModel.reduce((n: number, m: any) => n + m.usd, 0),
      6,
    );
    expect(t.inputTokens).toBeGreaterThanOrEqual(3000);
    expect(t.outputTokens).toBeGreaterThanOrEqual(300);
    expect(t.conversations).toBeGreaterThanOrEqual(53);
  });

  test('ai/models: routes and where they come from, provider keys (never their values), agents', async () => {
    await sql`delete from control_settings where key = 'agent_runtime.routes'`;
    const env = {
      ANTHROPIC_API_KEY: 'sk-secret-value',
      AGENT_MODEL_ROUTES: JSON.stringify({ default: { fast: [route()] } }),
    };
    const get = async (e = env) => {
      const h = new Hono();
      mountAgentRuntimeAi({ app: h, sql: appSql, controlGate: () => {}, env: e });
      const res = await h.request('http://core.localhost/control/v1/ai/models');
      const text = await res.text();
      expect(text).not.toContain('sk-secret-value');
      return JSON.parse(text);
    };
    const fromEnv = await get();
    expect(fromEnv.routesSource).toBe('env');
    expect(fromEnv.routes).toEqual({ default: { fast: [route()] } });
    expect(fromEnv.providers).toEqual([
      { id: 'anthropic', configured: true, secretName: 'ANTHROPIC_API_KEY' },
      { id: 'openrouter', configured: false, secretName: 'OPENROUTER_API_KEY' },
      { id: 'openai', configured: false, secretName: 'OPENAI_API_KEY' },
      { id: 'gemini', configured: false, secretName: 'GEMINI_API_KEY' },
    ]);
    expect(fromEnv.agents).toContainEqual({
      id: 'vendedor',
      label: 'Duá com os clientes',
      hint: 'responde os clientes no WhatsApp da loja',
      budgetKey: 'vendedor',
      defaultTier: 'fast',
    });
    expect(fromEnv.agents).toContainEqual({
      id: 'vendedor-onboarding',
      label: 'Duá na entrevista com o dono',
      hint: 'conversa com o dono da loja no treino inicial',
      budgetKey: 'vendedor',
      defaultTier: 'fast',
    });
    expect(
      (await get({ ANTHROPIC_API_KEY: 'sk-secret-value', AGENT_MODEL_ROUTES: '{' })).routesSource,
    ).toBe('none');
    expect((await get({} as typeof env)).routes).toEqual({});

    const value = {
      default: { strong: [route({ provider: 'anthropic', model: 'claude-haiku-5-5' })] },
    };
    const saved = await call('PUT', '/control/v1/settings/agent_runtime.routes', { value });
    expect(saved.status).toBe(200);
    const refused = await call('PUT', '/control/v1/settings/agent_runtime.routes', {
      value: { default: { fast: [route({ zdr: 'no' })] } },
    });
    expect(refused.status).toBe(422);
    const fromSettings = await get();
    expect(fromSettings.routesSource).toBe('settings');
    expect(fromSettings.routes).toEqual(value);
    const viaApp = await call('GET', '/control/v1/ai/models');
    expect(viaApp.status).toBe(200);
    expect(viaApp.body.routesSource).toBe('settings');
  });
});
