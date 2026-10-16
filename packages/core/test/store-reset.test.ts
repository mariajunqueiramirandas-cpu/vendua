import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { join } from 'node:path';
import postgres from 'postgres';
import { createApp } from '../src/app.ts';
import { FakeProvider } from '../src/modules/payments/fake.ts';
import {
  RESET_KEEPS,
  RESET_OWN_STEPS,
  RESET_WIPES,
  unclassified,
  wipePlan,
} from '../src/modules/store-reset.ts';
import { migrate, type Sql } from '../src/platform/db.ts';
import { fakeDnsHost, fakeProviders } from './domain-fakes.ts';

// Staff reset or delete one store from the CRM (modules/store-reset.ts). The API runs as
// vendua_app, so a wipe RLS would quietly skip, or one that reaches another store, shows up here.

const PLATFORM = '00000000-0000-4000-8000-000000000001';

describe.skipIf(!process.env.TEST_DATABASE_URL)('store reset and delete (db)', () => {
  const OWNER_URL = process.env.TEST_DATABASE_URL!;
  const sql = postgres(OWNER_URL, { onnotice: () => {} });
  const appSql = postgres(
    process.env.TEST_APP_DATABASE_URL ??
      OWNER_URL.replace(/\/\/[^@]+@/, '//vendua_app:vendua_app@'),
    { onnotice: () => {} },
  );
  const provider = new FakeProvider();
  const dns = fakeDnsHost();
  const app = createApp({
    sql: appSql,
    sessionSecret: 's',
    controlSecret: 'ctl',
    storeDomain: 'vendua.test',
    paymentProvider: provider,
    domains: fakeProviders({ dnsHost: dns }),
  });
  const nonce = crypto.randomUUID().slice(0, 6);
  const created: string[] = [];

  const call = async (path: string, body: unknown, key = crypto.randomUUID()) => {
    const res = await app.request(`http://core.localhost${path}`, {
      method: 'POST',
      headers: {
        host: 'core.localhost',
        'content-type': 'application/json',
        'x-vendua-control': 'ctl',
        'idempotency-key': key,
      },
      body: JSON.stringify(body),
    });
    return {
      status: res.status,
      replay: res.headers.get('x-idempotent-replay'),
      body: (await res.json()) as any,
    };
  };

  /** a signed-up store with a bit of everything a merchant fills in */
  const store = async (name: string) => {
    const slug = `sr-${nonce}-${name}`;
    const id = await sql.begin(async (t) => {
      const tx = t as unknown as Sql;
      const [row] = await tx<{ id: string }[]>`
        select provision_store(${slug}, ${`Loja ${name}`}, 'bandeira', ${`${slug}.vendua.test`},
          'Dona Ana', ${`229${Math.floor(1e7 + Math.random() * 9e7)}`}, 'ana@example.com') as id`;
      return row!.id;
    });
    created.push(id);
    await sql`
      update store_settings set segment = 'doces', onboarding = '{"from":"signup","step":"menu","finishedAt":"2026-10-01T00:00:00.000Z"}',
        pickup_enabled = true, status_override = null, pix_key = 'ana@example.com',
        tagline = 'os melhores doces', billing_hold = false
      where tenant_id = ${id}`;
    await sql`insert into merchant_users (tenant_id, name, phone, role)
      values (${id}, 'Gerente', ${`219${Math.floor(1e7 + Math.random() * 9e7)}`}, 'manager')`;
    const [cat] = await sql<{ id: string }[]>`
      insert into categories (tenant_id, name, slug) values (${id}, 'Bolos', 'bolos') returning id`;
    await sql`insert into products (tenant_id, category_id, name, slug, base_price_cents)
      values (${id}, ${cat!.id}, 'Bolo de pote', 'bolo-de-pote', 1200)`;
    await sql`insert into delivery_zones (tenant_id, name) values (${id}, 'Centro')`;
    await sql`insert into coupons (tenant_id, code, kind, value) values (${id}, 'DOCE10', 'percent', 10)`;
    await sql`insert into storefront_tokens (tenant_id, version, tokens, source, bundle)
      values (${id}, 1, '{}', 'owner', '_template'), (${id}, 2, '{}', 'site', ${slug})`;
    await sql`insert into store_whatsapp (tenant_id, wanted, state, phone)
      values (${id}, true, 'open', '5522999990000')`;
    await sql`insert into print_pairings (tenant_id, device_code_hash, device_name, expires_at, platform, user_code)
      values (${id}, ${(crypto.randomUUID() + crypto.randomUUID()).replace(/-/g, '').slice(0, 64)}, 'Caixa', now() + interval '1 hour', 'windows',
              ${crypto.randomUUID().replace(/-/g, '').slice(0, 8).toUpperCase()})`;
    await sql`insert into outbox (tenant_id, topic, payload) values (${id}, 'waitlist.restocked', '{}')`;
    return { id, slug };
  };

  const rowsOf = async (tenantId: string, tables: readonly string[]) => {
    const out: Record<string, number> = {};
    for (const t of tables) {
      const [r] = await sql.unsafe(`select count(*)::int as n from "${t}" where tenant_id = $1`, [
        tenantId,
      ]);
      if (r!.n) out[t] = r!.n;
    }
    return out;
  };

  beforeAll(async () => {
    await migrate(sql, join(import.meta.dir, '../db/migrations'));
  });

  afterAll(async () => {
    for (const id of created) await sql`delete from tenants where id = ${id}`;
    await sql`delete from staff_events where data->>'slug' like ${`sr-${nonce}-%`}`;
    await sql.end();
    await appSql.end();
  });

  test('every table holding a store row is kept, wiped or reset by hand — exactly once', async () => {
    const plan = await wipePlan(sql as unknown as Sql);
    expect(unclassified(plan.tables)).toEqual([]);
    const named = [...RESET_KEEPS, ...RESET_WIPES, ...RESET_OWN_STEPS];
    expect(named.filter((t, i) => named.indexOf(t) !== i)).toEqual([]);
    // a name left behind after its table was dropped
    expect(named.filter((t) => !plan.tables.includes(t))).toEqual([]);
    expect([...plan.order].sort()).toEqual([...RESET_WIPES].sort());
  });

  test('no kept table points at a wiped one: a reset never deletes or nulls a kept row', async () => {
    const edges = await sql<{ child: string; parent: string }[]>`
      select ch.relname as child, pa.relname as parent from pg_constraint k
        join pg_class ch on ch.oid = k.conrelid join pg_class pa on pa.oid = k.confrelid
      where k.contype = 'f' and ch.relname = any(${[...RESET_KEEPS, 'store_settings']})
        and pa.relname = any(${[...RESET_WIPES]})`;
    expect([...edges]).toEqual([]);
  });

  test('the slug confirms; a bad id, an unknown store or the platform tenant is a 4xx', async () => {
    const a = await store('confirm');
    expect(
      (await call(`/control/v1/stores/${a.id}/reset`, { confirm: 'outra' })).body.error.code,
    ).toBe('CONFIRM_MISMATCH');
    expect((await call(`/control/v1/stores/${a.id}/delete`, {})).status).toBe(422);
    expect((await call('/control/v1/stores/nope/reset', { confirm: a.slug })).status).toBe(400);
    const unknown = crypto.randomUUID();
    expect((await call(`/control/v1/stores/${unknown}/delete`, { confirm: a.slug })).status).toBe(
      404,
    );
    expect(
      (await call(`/control/v1/stores/${PLATFORM}/reset`, { confirm: '_platform' })).status,
    ).toBe(404);
    expect(
      (await call(`/control/v1/stores/${PLATFORM}/delete`, { confirm: '_platform' })).status,
    ).toBe(404);
    // nothing happened to the store
    expect(await rowsOf(a.id, ['products', 'merchant_users'])).toEqual({
      products: 1,
      merchant_users: 2,
    });
  });

  test('a reset leaves the store as signup did, keeps the account, and only this store', async () => {
    const a = await store('reset');
    const b = await store('bystander');
    const before = await rowsOf(b.id, [...RESET_WIPES, 'storefront_tokens', 'merchant_users']);
    const key = crypto.randomUUID();
    const res = await call(
      `/control/v1/stores/${a.id}/reset`,
      { confirm: ` ${a.slug.toUpperCase()} ` },
      key,
    );
    expect(res.status).toBe(200);
    expect(res.body.rows).toBeGreaterThan(5);

    expect(await rowsOf(a.id, RESET_WIPES)).toEqual({});
    expect(await rowsOf(b.id, [...RESET_WIPES, 'storefront_tokens', 'merchant_users'])).toEqual(
      before,
    );
    const users = await sql`select role from merchant_users where tenant_id = ${a.id}`;
    expect(users.map((u) => u.role)).toEqual(['owner']);
    // the site sob medida's design stays; the owner's edits on the default template go
    const tokens = await sql`select bundle from storefront_tokens where tenant_id = ${a.id}`;
    expect(tokens.map((t) => t.bundle)).toEqual([a.slug]);
    expect(await rowsOf(a.id, ['domains', 'storefront_ops', 'provisionings'])).toEqual({
      domains: 1,
      storefront_ops: 1,
      provisionings: 1,
    });
    // no gateway is alive in tests: Core forgets the login itself
    expect(await rowsOf(a.id, ['store_whatsapp', 'store_wa_auth'])).toEqual({});

    const [s] = await sql`select * from store_settings where tenant_id = ${a.id}`;
    expect({
      paused: s!.status_override,
      pickup: s!.pickup_enabled,
      delivery: s!.delivery_enabled,
      pix: s!.pix_key,
      tagline: s!.tagline,
      segment: s!.segment,
      email: s!.email,
      hold: s!.billing_hold,
      onboarding: s!.onboarding,
    }).toEqual({
      paused: 'paused',
      pickup: false,
      delivery: false,
      pix: null,
      tagline: null,
      segment: 'doces',
      email: 'ana@example.com',
      hold: false,
      onboarding: { from: 'signup', resetAt: res.body.resetAt },
    });
    const [audit] = await sql`select actor_label, action from audit_log where tenant_id = ${a.id}`;
    expect(audit).toEqual({ actor_label: 'Equipe Venduá', action: 'store.reset' });
    const ev =
      await sql`select tenant_id from staff_events where kind = 'store.reset' and data->>'slug' = ${a.slug}`;
    expect(ev.map((e) => e.tenant_id)).toEqual([a.id]);

    const again = await call(`/control/v1/stores/${a.id}/reset`, { confirm: a.slug }, key);
    expect([again.status, again.replay, again.body]).toEqual([200, 'true', res.body]);
  });

  test('with a gateway alive, a reset asks it to log the store out of WhatsApp', async () => {
    const a = await store('gateway');
    const gw = `sr-${nonce}`;
    await sql`insert into wa_gateways (id) values (${gw})`;
    try {
      const res = await call(`/control/v1/stores/${a.id}/reset`, { confirm: a.slug });
      expect(res.status).toBe(200);
      const [wa] = await sql<
        { wanted: boolean; state: string; phone: string | null; wipe_requested_at: Date }[]
      >`
        select wanted, state, phone, wipe_requested_at from store_whatsapp where tenant_id = ${a.id}`;
      expect({ ...wa, wipe_requested_at: wa!.wipe_requested_at.toISOString() }).toEqual({
        wanted: false,
        state: 'off',
        phone: null,
        wipe_requested_at: res.body.resetAt,
      });
    } finally {
      await sql`delete from wa_gateways where id = ${gw}`;
    }
  });

  test('a delete stops Mercado Pago, drops the DNS zones and removes only this store', async () => {
    const a = await store('delete');
    const b = await store('stays');
    const sub = await provider.createSubscription({
      backUrl: 'https://admin.vendua.test/conta',
      externalReference: a.id,
      amountCents: 4990,
    } as never);
    await sql`insert into subscriptions (tenant_id, plan_id, method, provider, status, provider_subscription_id)
      values (${a.id}, 'bandeira', 'card', 'fake', 'active', ${sub.id})`;
    const host = `loja-${nonce}.com.br`;
    const zone = await dns.ensureZone(host);
    await sql`insert into custom_domains (tenant_id, host, verify_token, zone_id)
      values (${a.id}, ${host}, 'tok-0123456789abcdef', ${zone.id})`;

    // Mercado Pago down: nothing is deleted and the same key can try again
    const key = crypto.randomUUID();
    provider.revoked.clear();
    const realUpdate = provider.updateSubscription.bind(provider);
    provider.updateSubscription = async () => {
      throw new Error('mp down');
    };
    const failed = await call(`/control/v1/stores/${a.id}/delete`, { confirm: a.slug }, key);
    provider.updateSubscription = realUpdate;
    expect([failed.status, failed.body.error.code]).toEqual([502, 'BILLING_PROVIDER_ERROR']);
    expect(await rowsOf(a.id, ['products'])).toEqual({ products: 1 });

    const res = await call(`/control/v1/stores/${a.id}/delete`, { confirm: a.slug }, key);
    expect(res.status).toBe(200);
    expect(provider.subscriptions.get(sub.id)!.status).toBe('cancelled');
    expect(dns.zones.has(host)).toBe(false);
    expect(await sql`select 1 from tenants where id = ${a.id}`).toHaveLength(0);
    expect(
      await rowsOf(a.id, [
        ...RESET_WIPES,
        ...RESET_KEEPS.filter((t) => t !== 'staff_events' && t !== 'leads'),
      ]),
    ).toEqual({});
    expect(await rowsOf(b.id, ['products', 'merchant_users'])).toEqual({
      products: 1,
      merchant_users: 2,
    });
    const ev =
      await sql`select tenant_id, data from staff_events where kind = 'store.deleted' and data->>'slug' = ${a.slug}`;
    expect([...ev]).toEqual([
      { tenant_id: null, data: { storeName: 'Loja delete', slug: a.slug, owner: 'Dona Ana' } },
    ]);

    const again = await call(`/control/v1/stores/${a.id}/delete`, { confirm: a.slug }, key);
    expect([again.status, again.replay]).toEqual([200, 'true']);
    expect((await call(`/control/v1/stores/${a.id}/delete`, { confirm: a.slug })).status).toBe(404);
  });
});
