import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { join } from 'node:path';
import postgres from 'postgres';
import { DEFAULT_TOKENS, type PageTemplate } from '@vendua/templates';
import { createApp } from '../src/app.ts';
import type { MerchantNotify } from '../src/admin/context.ts';
import { fleetDeps } from '../src/modules/fleet/deps.ts';
import { migrate } from '../src/platform/db.ts';

// ADR 0040: a saved design belongs to the bundle it was made for, so an owner can switch between
// the site sob medida and the template and get each side's layout and colors, edits kept.
describe.skipIf(!process.env.TEST_DATABASE_URL)('design per bundle (db)', () => {
  const sql = postgres(process.env.TEST_DATABASE_URL!);
  const nonce = crypto.randomUUID().slice(0, 8);
  const slug = `dp-${nonce}`;
  const plain = `dq-${nonce}`;
  const host = `${slug}.localhost`;
  const ownerPhone = `218${String(Date.now()).slice(-8)}`;
  const codes = new Map<string, string>();
  const notify: MerchantNotify = { whatsapp: async () => {}, email: async () => {} };
  const fleet = fleetDeps(sql, {
    storeDomain: 'vendua.test',
    adminHost: null,
    probes: false,
    probeOrigin: null,
    fetch: (async () => new Response('nope', { status: 404 })) as unknown as typeof fetch,
    notify,
  });
  const created: string[] = [];
  fleet.only = created;
  const app = createApp({
    sql,
    sessionSecret: 's',
    controlSecret: 'ctl',
    autoDrain: false,
    storeDomain: 'vendua.test',
    notify,
    fleet,
    otpSender: async (phone, text) => void codes.set(phone, /(\d{6})/.exec(text)![1]!),
  });
  // the template's release sits far in the past: the newest of `_template` stays whatever it is
  const templateRelease = crypto.randomUUID().replace(/-/g, '').slice(0, 20);
  let tenantId = '';
  let plainId = '';
  let seq = 0;

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
          : { 'idempotency-key': `${nonce}-${++seq}`, 'x-vendua-admin': '1' }),
        ...h,
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
  const signIn = async (storeId: string) => {
    await call('POST', '/admin/v1/auth/otp/start', { phone: ownerPhone });
    const r = await call('POST', '/admin/v1/auth/otp/verify', {
      phone: ownerPhone,
      code: codes.get(ownerPhone),
    });
    let cookie = r.cookie;
    if (!r.body.signedIn) {
      const pick = await call('POST', '/admin/v1/auth/select', {
        pickerToken: r.body.pickerToken,
        storeId,
      });
      cookie = pick.cookie;
    }
    const value = /vendua_admin=([^;]+)/.exec(cookie ?? '')![1]!;
    return (method: string, path: string, body?: unknown) =>
      call(method, `/admin/v1${path}`, body, { cookie: `vendua_admin=${value}` });
  };
  const publishOwn = (release: string) =>
    app.request('/control/v1/fleet/releases', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-vendua-control': 'ctl',
        'idempotency-key': `${nonce}-rel-${release}`,
      },
      body: JSON.stringify({
        manifest: {
          manifestVersion: 1,
          release,
          bundle: slug,
          tenant: slug,
          contract: 2,
          kernelVersion: '1.23.0',
          builtAt: new Date().toISOString(),
          commit: 'abc1234',
          entry: 'index.html',
          spaFallback: true,
          files: { 'index.html': { size: 10, sha256: 'a'.repeat(64), type: 'text/html' } },
          budgets: {
            files: 1,
            totalBytes: 10,
            htmlBytes: 10,
            jsBytes: 0,
            cssBytes: 0,
            entryGzipBytes: 0,
          },
          qa: { status: 'passed', checks: [{ id: 'compat', ok: true }] },
          build: {},
        },
        artifactUri: `file:///srv/artifacts/storefronts/${slug}/${release}`,
      }),
    });
  const home = (type: string): PageTemplate => ({
    version: 1,
    page: 'home',
    sections: [{ id: 'top', type, settings: {} }],
  });
  const tokens = (accent: string) => ({
    ...DEFAULT_TOKENS,
    color: { ...DEFAULT_TOKENS.color, accent },
  });
  const ops = async () =>
    (
      await sql<{ bundle: string; bundle_locked: boolean; live_release_id: string | null }[]>`
        select bundle, bundle_locked, live_release_id from storefront_ops where tenant_id = ${tenantId}
      `
    )[0]!;
  const storefrontHome = async () => {
    const res = await app.request(`http://${host}/storefront/v1/state?templates=1`, {
      headers: { host },
    });
    const body = (await res.json()) as { templates: Record<string, PageTemplate> };
    return body.templates.home?.sections[0]?.type ?? null;
  };

  beforeAll(async () => {
    await migrate(sql, join(import.meta.dir, '../db/migrations'));
    const mk = async (s: string) =>
      (
        await sql<{ id: string }[]>`
          insert into tenants (slug, name) values (${s}, ${'Loja ' + s}) returning id
        `
      )[0]!.id;
    tenantId = await mk(slug);
    plainId = await mk(plain);
    created.push(tenantId, plainId);
    await sql`insert into domains (host, tenant_id, is_primary) values (${host}, ${tenantId}, true)`;
    // provisioning gives every store its ops row on the template
    await sql`insert into storefront_ops (tenant_id) values (${tenantId})`;
    for (const id of [tenantId, plainId])
      await sql`
        insert into merchant_users (tenant_id, name, phone, role)
        values (${id}, 'Dona Loja', ${ownerPhone}, 'owner')
      `;
    await sql`
      insert into store_settings (tenant_id, hours, prep_time_minutes, min_order_cents, currency, vocabulary)
      values (${tenantId}, ${sql.json({ timezone: 'America/Sao_Paulo', windows: [] })}, 25, 0, 'BRL', ${sql.json({})})
    `;
    await sql`
      insert into releases (id, bundle, tenant_slug, kernel_version, contract, commit, artifact_uri,
                            manifest, qa_status, qa_report, built_at, published_at, created_at)
      values (${templateRelease}, '_template', 'loja-modelo', '1.23.0', 2, 'abc1234',
              ${`file:///srv/artifacts/storefronts/_template/${templateRelease}`}, ${sql.json({})},
              'passed', ${sql.json({})}, '2000-01-01', '2000-01-01', '2000-01-01')
    `;
  });
  afterAll(async () => {
    await sql`delete from tenants where id in ${sql(created)}`;
    await sql`delete from releases where bundle = ${slug} or id = ${templateRelease}`;
    await sql.end();
  });

  test('each bundle keeps its own layout and colors, and the owner switches between them', async () => {
    const owner = await signIn(tenantId);

    // on the template: the owner's edits are the template's
    expect(
      (await owner('PUT', '/appearance/pages/home', { template: home('store:menu-hero') })).status,
    ).toBe(200);
    expect((await owner('PUT', '/appearance/tokens', { tokens: tokens('#7a1f3d') })).status).toBe(
      200,
    );
    let a = await owner('GET', '/appearance');
    expect(a.body.site).toBeNull();
    expect((await owner('PUT', '/appearance/site', { mode: 'custom' })).status).toBe(409);

    // the store's own bundle is published and adopted, then its design lands on it
    expect((await publishOwn(crypto.randomUUID().replace(/-/g, '').slice(0, 20))).status).toBe(201);
    expect((await ops()).bundle).toBe(slug);
    expect(await storefrontHome()).toBeNull();
    expect(
      (await owner('PUT', '/appearance/pages/home', { template: home('store:hero') })).status,
    ).toBe(200);
    expect((await owner('PUT', '/appearance/tokens', { tokens: tokens('#1f4d7a') })).status).toBe(
      200,
    );
    a = await owner('GET', '/appearance');
    expect(a.body.site).toEqual({ mode: 'custom' });
    expect(
      a.body.pages.find((p: { page: string }) => p.page === 'home').template.sections[0].type,
    ).toBe('store:hero');
    expect(a.body.tokens.tokens.color.accent).toBe('#1f4d7a');

    // to the template: its release goes live and its design comes back
    const sw = await owner('PUT', '/appearance/site', { mode: 'template' });
    expect(sw.status).toBe(200);
    expect(sw.body.site).toEqual({ mode: 'template' });
    expect(await ops()).toMatchObject({
      bundle: '_template',
      bundle_locked: true,
      live_release_id: templateRelease,
    });
    a = await owner('GET', '/appearance');
    expect(a.body.site).toEqual({ mode: 'template' });
    expect(
      a.body.pages.find((p: { page: string }) => p.page === 'home').template.sections[0].type,
    ).toBe('store:menu-hero');
    expect(a.body.tokens.tokens.color.accent).toBe('#7a1f3d');
    expect(await storefrontHome()).toBe('store:menu-hero');
    // history and restore stay within the bundle on screen
    const hist = await owner('GET', '/appearance/pages/home/history');
    expect(hist.body.history).toHaveLength(1);

    // a new build of its own bundle doesn't pull the store back
    expect((await publishOwn(crypto.randomUUID().replace(/-/g, '').slice(0, 20))).status).toBe(201);
    expect((await ops()).bundle).toBe('_template');

    // an edit on the template side stays there
    expect(
      (await owner('PUT', '/appearance/pages/home', { template: home('sdk:store-status') })).status,
    ).toBe(200);

    // back to the site sob medida, exactly as it was, on its newest release
    expect((await owner('PUT', '/appearance/site', { mode: 'custom' })).status).toBe(200);
    expect((await ops()).bundle).toBe(slug);
    expect(await storefrontHome()).toBe('store:hero');
    a = await owner('GET', '/appearance');
    expect(a.body.tokens.tokens.color.accent).toBe('#1f4d7a');
    // and the template keeps its edit for next time
    expect((await owner('PUT', '/appearance/site', { mode: 'template' })).status).toBe(200);
    expect(await storefrontHome()).toBe('sdk:store-status');

    const events = await sql<{ data: { mode: string; slug: string } }[]>`
      select data from staff_events where kind = 'site.mode_changed' and tenant_id = ${tenantId} order by id
    `;
    expect(events.map((e) => e.data.mode)).toEqual(['template', 'custom', 'template']);
    const deps = await sql<{ reason: string }[]>`
      select reason from deployments where tenant_id = ${tenantId} and release_id = ${templateRelease}
    `;
    expect(deps[0]?.reason).toBe('o lojista trocou para o modelo padrão');
  });

  test('a repeat is a no-op, a bad mode is a 422, a store without its own site gets a 409', async () => {
    const owner = await signIn(tenantId);
    const before = await sql`select id from deployments where tenant_id = ${tenantId}`;
    const same = await owner('PUT', '/appearance/site', { mode: 'template' });
    expect(same.status).toBe(200);
    expect(same.body.deployment).toBeNull();
    expect(await sql`select id from deployments where tenant_id = ${tenantId}`).toHaveLength(
      before.length,
    );
    expect((await owner('PUT', '/appearance/site', { mode: 'other' })).status).toBe(422);

    const other = await signIn(plainId);
    expect((await other('GET', '/appearance')).body.site).toBeNull();
    expect((await other('PUT', '/appearance/site', { mode: 'template' })).status).toBe(409);
  });

  test('a row written without a bundle gets the bundle the store runs', async () => {
    await sql`insert into storefront_ops (tenant_id, bundle) values (${plainId}, '_template') on conflict do nothing`;
    await sql`
      insert into storefront_templates (tenant_id, page, version, template, source)
      values (${plainId}, 'home', 1, ${sql.json(home('store:menu-hero') as never)}, 'seed')
    `;
    const [row] = await sql<{ bundle: string }[]>`
      select bundle from storefront_templates where tenant_id = ${plainId} and page = 'home'
    `;
    expect(row!.bundle).toBe('_template');
  });
});
