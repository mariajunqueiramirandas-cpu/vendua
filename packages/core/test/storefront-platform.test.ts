import { afterAll, describe, expect, test } from 'bun:test';
import { join } from 'node:path';
import postgres from 'postgres';
import { defineTemplateMigration, type PageTemplate } from '@vendua/templates';
import { createApp } from '../src/app.ts';
import { withTenant } from '../src/platform/db.ts';
import { migrate } from '../src/platform/db.ts';
import {
  rollbackTemplateMigration,
  runTemplateMigration,
} from '../src/modules/storefront-platform.ts';

// DB-backed — opt-in via TEST_DATABASE_URL.
describe.skipIf(!process.env.TEST_DATABASE_URL)('storefront platform (db)', () => {
  const sql = postgres(process.env.TEST_DATABASE_URL!);
  const app = createApp({ sql, sessionSecret: 's', controlSecret: 'ctl', autoDrain: false });
  const nonce = crypto.randomUUID().slice(0, 8);
  const slug = `sp-${nonce}`;
  const host = `${slug}.localhost`;
  let tenantId = '';

  const setup = async () => {
    if (tenantId) return;
    await migrate(sql, join(import.meta.dir, '../db/migrations'));
    tenantId = (
      await sql<
        { id: string }[]
      >`insert into tenants (slug, name) values (${slug}, ${slug}) returning id`
    )[0]!.id;
    await sql`insert into domains (host, tenant_id) values (${host}, ${tenantId})`;
    await sql`
      insert into store_settings (tenant_id, hours, prep_time_minutes, min_order_cents, currency, vocabulary)
      values (${tenantId}, ${sql.json({ timezone: 'America/Sao_Paulo', windows: [{ days: [0, 1, 2, 3, 4, 5, 6], open: '00:00', close: '00:00' }] })}, 25, 0, 'BRL', ${sql.json({})})
    `;
  };
  afterAll(async () => {
    if (tenantId) await sql`delete from tenants where id = ${tenantId}`;
    await sql.end();
  });

  const ctl = (method: string, path: string, body?: unknown, idem?: string) =>
    app.request(path, {
      method,
      headers: {
        'content-type': 'application/json',
        'x-vendua-control': 'ctl',
        ...(idem ? { 'idempotency-key': `${nonce}-${idem}` } : {}),
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
  const pub = (method: string, path: string, body?: unknown, extra: Record<string, string> = {}) =>
    app.request(`http://${host}${path}`, {
      method,
      headers: { host, 'content-type': 'application/json', ...extra },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });

  const product: PageTemplate = {
    version: 1,
    page: 'product',
    sections: [
      { id: 'panel', type: 'sdk:purchase-panel', settings: { variant: 'split' } },
      { id: 'story', type: 'store:story', settings: { title: 'Da cozinha' } },
    ],
  };

  test('templates: versioned writes, removal tombstones, rollback, delivery in state', async () => {
    await setup();
    const put1 = await ctl(
      'PUT',
      `/control/v1/storefronts/${slug}/templates/product`,
      { template: product },
      't1',
    );
    expect(put1.status).toBe(200);
    expect(((await put1.json()) as { version: number }).version).toBe(1);

    // same idempotency key replays, no second version
    const replay = await ctl(
      'PUT',
      `/control/v1/storefronts/${slug}/templates/product`,
      { template: product },
      't1',
    );
    expect(replay.headers.get('x-idempotent-replay')).toBe('true');

    // stale expectVersion is a conflict, not a silent overwrite
    const stale = await ctl(
      'PUT',
      `/control/v1/storefronts/${slug}/templates/product`,
      { template: product, expectVersion: 0 },
      't-stale',
    );
    expect(stale.status).toBe(409);

    // staff drops the story section → tombstone recorded
    const dropped = { ...product, sections: [product.sections[0]!] };
    const put2 = await ctl(
      'PUT',
      `/control/v1/storefronts/${slug}/templates/product`,
      { template: dropped },
      't2',
    );
    const v2 = (await put2.json()) as { version: number; template: PageTemplate };
    expect(v2.version).toBe(2);
    expect(v2.template.removed).toEqual(['store:story']);

    const bad = await ctl(
      'PUT',
      `/control/v1/storefronts/${slug}/templates/product`,
      { template: { ...product, sections: [{ id: 'X!', type: 'nope' }] } },
      't-bad',
    );
    expect(bad.status).toBe(422);
    expect(((await bad.json()) as { error: { code: string } }).error.code).toBe('INVALID_TEMPLATE');

    const rb = await ctl(
      'POST',
      `/control/v1/storefronts/${slug}/templates/product/rollback`,
      {},
      't-rb',
    );
    const rbBody = (await rb.json()) as {
      version: number;
      restored: number;
      template: PageTemplate;
    };
    expect(rbBody).toMatchObject({ version: 3, restored: 1 });
    expect(rbBody.template.sections).toHaveLength(2);

    const hist = (await (
      await ctl('GET', `/control/v1/storefronts/${slug}/templates/product/history`)
    ).json()) as {
      history: { version: number; source: string }[];
    };
    expect(hist.history.map((h) => h.source)).toEqual(['rollback:1', 'staff', 'staff']);

    const state = (await (await pub('GET', '/storefront/v1/state?templates=1')).json()) as {
      templates: Record<string, PageTemplate>;
      loader: { state: string };
    };
    expect(state.templates.product?.sections).toHaveLength(2);
    expect(state.loader.state).toBe('normal');
    // v.js's poll stays lean
    const lean = (await (await pub('GET', '/storefront/v1/state')).json()) as Record<
      string,
      unknown
    >;
    expect(lean.templates).toBeUndefined();

    // bad page ids are stable 4xx
    expect(
      (await ctl('GET', `/control/v1/storefronts/${slug}/templates/../history`)).status,
    ).toBeLessThan(500);
    expect((await ctl('GET', `/control/v1/storefronts/nope-${nonce}/tokens`)).status).toBe(404);
  });

  test('tokens: AA-gated, versioned, queue a rebuild, served to the build', async () => {
    await setup();
    const tokens = {
      color: {
        bg: '#FFFFFF',
        surface: '#FFFFFF',
        text: '#111111',
        muted: '#555555',
        accent: '#224466',
        onAccent: '#FFFFFF',
        danger: '#A33B32',
        success: '#3D7A4F',
      },
      font: { display: 'Georgia', body: 'system-ui' },
      radius: { sm: '2px', md: '4px', lg: '8px' },
      space: { scale: 1 },
      motion: { duration: '150ms', easing: 'ease' },
    };
    const low = await ctl(
      'PUT',
      `/control/v1/storefronts/${slug}/tokens`,
      { tokens: { ...tokens, color: { ...tokens.color, muted: '#DDDDDD' } } },
      'tok-low',
    );
    expect(low.status).toBe(422);

    // a store whose live build predates Kernel 1.10 bakes tokens in: the edit queues a rebuild
    await sql`
      insert into storefront_ops (tenant_id, live_kernel_version) values (${tenantId}, '1.9.0')
      on conflict (tenant_id) do update set live_kernel_version = excluded.live_kernel_version
    `;
    const ok = await ctl('PUT', `/control/v1/storefronts/${slug}/tokens`, { tokens }, 'tok-ok');
    expect(ok.status).toBe(200);
    const outbox = await withTenant(
      sql,
      tenantId,
      (tx) =>
        tx<
          { topic: string }[]
        >`select topic from outbox where tenant_id = ${tenantId} and topic = 'storefront.rebuild_requested'`,
    );
    expect(outbox).toHaveLength(1);

    // the train consumes the queue: list → rebuild → ack
    type Req = { tenant: string; id: number; reason: { reason: string } };
    const pending = (await (
      await ctl('GET', '/control/v1/storefronts/rebuild-requests')
    ).json()) as {
      requests: Req[];
    };
    const mine = pending.requests.filter((r) => r.tenant === slug);
    expect(mine.map((r) => r.reason.reason)).toEqual(['tokens']);
    const ack = await ctl(
      'POST',
      '/control/v1/storefronts/rebuild-requests/ack',
      { requests: mine },
      'ack-1',
    );
    expect(await ack.json()).toEqual({ acked: 1 });
    const after = (await (await ctl('GET', '/control/v1/storefronts/rebuild-requests')).json()) as {
      requests: Req[];
    };
    expect(after.requests.filter((r) => r.tenant === slug)).toEqual([]);

    const design = (await (await pub('GET', '/storefront/v1/design')).json()) as {
      tokens: { color: { accent: string } };
    };
    expect(design.tokens.color.accent).toBe('#224466');

    // Kernel 1.10+ reads tokens from the edge-injected state: no rebuild, live at the next load
    await sql`update storefront_ops set live_kernel_version = '1.10.0' where tenant_id = ${tenantId}`;
    const green = { ...tokens, color: { ...tokens.color, accent: '#1F5130' } };
    expect(
      (await ctl('PUT', `/control/v1/storefronts/${slug}/tokens`, { tokens: green }, 'tok-110'))
        .status,
    ).toBe(200);
    const queued = (await (
      await ctl('GET', '/control/v1/storefronts/rebuild-requests')
    ).json()) as {
      requests: Req[];
    };
    expect(queued.requests.filter((r) => r.tenant === slug)).toEqual([]);
    const injected = (await (await pub('GET', '/storefront/v1/surfaces?design=1')).json()) as {
      tokens: { color: { accent: string } };
      templates: Record<string, unknown>;
    };
    expect(injected.tokens.color.accent).toBe('#1F5130');
    expect(typeof injected.templates).toBe('object');
    const plain = (await (await pub('GET', '/storefront/v1/surfaces')).json()) as object;
    expect('tokens' in plain || 'templates' in plain).toBe(false);
  });

  test('ops: kill switch reaches /state; high_demand notice is emitted', async () => {
    await setup();
    const r = await ctl(
      'PATCH',
      `/control/v1/storefronts/${slug}/ops`,
      { loader: { state: 'maintenance', message: 'Peça pelo WhatsApp' }, demand: 'high' },
      'ops-1',
    );
    expect(r.status).toBe(200);
    const st = (await (await pub('GET', '/storefront/v1/state')).json()) as {
      loader: { state: string; message: string };
    };
    expect(st.loader).toMatchObject({ state: 'maintenance', message: 'Peça pelo WhatsApp' });
    const surfaces = (await (await pub('GET', '/storefront/v1/surfaces')).json()) as {
      notices: { kind: string; severity: string }[];
    };
    expect(surfaces.notices.find((n) => n.kind === 'high_demand')?.severity).toBe('warning');

    expect(
      (await ctl('PATCH', `/control/v1/storefronts/${slug}/ops`, { ring: 'moon' }, 'ops-bad'))
        .status,
    ).toBe(400);
    await ctl(
      'PATCH',
      `/control/v1/storefronts/${slug}/ops`,
      { loader: { state: 'normal' }, demand: 'normal', ring: 'canary' },
      'ops-2',
    );
  });

  test('template migrations: kernel-gated, idempotent, reversible, by ring', async () => {
    await setup();
    const m = defineTemplateMigration({
      id: '2026-09-test-reviews',
      description: 'test',
      requiresKernel: '>=1.1.0',
      pages: ['product'],
      up(t) {
        if (!t.has('sdk:reviews')) t.insertAfter('sdk:purchase-panel', { type: 'sdk:reviews' });
      },
    });
    const only = { tenants: [slug] };

    // no recorded build → skipped, not broken
    const noBuild = await runTemplateMigration(sql, m, { dry: true, ...only });
    expect(noBuild[0]).toMatchObject({ status: 'skipped' });

    const rec = await ctl(
      'POST',
      `/control/v1/storefronts/${slug}/builds`,
      { manifest: { kernel: '1.1.0', contract: 2, sections: {} } },
      'build-1',
    );
    expect(rec.status).toBe(201);

    const dry = await runTemplateMigration(sql, m, { dry: true, ...only });
    expect(dry[0]).toMatchObject({ status: 'applied', fromVersion: 3 });
    expect(dry[0]!.toVersion).toBeUndefined();

    // ring filter: tenant is canary now → a stable-only run touches nothing
    expect(await runTemplateMigration(sql, m, { dry: false, ring: 'stable', ...only })).toEqual([]);

    const real = await runTemplateMigration(sql, m, { dry: false, ring: 'canary', ...only });
    expect(real[0]).toMatchObject({ status: 'applied', toVersion: 4 });
    const again = await runTemplateMigration(sql, m, { dry: false, ...only });
    expect(again[0]).toMatchObject({ status: 'skipped' });

    const undo = await rollbackTemplateMigration(sql, m.id, only);
    expect(undo[0]).toMatchObject({ status: 'applied', toVersion: 5 });
    const cur = await withTenant(
      sql,
      tenantId,
      (tx) =>
        tx<{ template: PageTemplate }[]>`
        select template from storefront_templates where tenant_id = ${tenantId} and page = 'product'
        order by version desc limit 1`,
    );
    expect(cur[0]!.template.sections.map((s) => s.type)).not.toContain('sdk:reviews');
  });

  test('notify-me + analytics beacon', async () => {
    await setup();
    const n1 = await pub(
      'POST',
      '/checkout/v1/notify-me',
      { subject: 'store', phone: '(22) 99999-0000' },
      {
        'idempotency-key': `${nonce}-n1`,
      },
    );
    expect(n1.status).toBe(201);
    const n2 = await pub(
      'POST',
      '/checkout/v1/notify-me',
      { subject: 'store', phone: '22999990000' },
      {
        'idempotency-key': `${nonce}-n2`,
      },
    );
    expect(n2.status).toBe(201);
    const bad = await pub(
      'POST',
      '/checkout/v1/notify-me',
      { subject: 'product', phone: '22999990000' },
      {
        'idempotency-key': `${nonce}-n3`,
      },
    );
    expect(bad.status).toBe(400);
    // 36 hex digits aren't a uuid: a stable 400, not Postgres' cast error
    const notUuid = await pub(
      'POST',
      '/checkout/v1/notify-me',
      { subject: 'product', phone: '22999990000', productId: '0'.repeat(36) },
      { 'idempotency-key': `${nonce}-n4` },
    );
    expect(notUuid.status).toBe(400);
    const subs = await withTenant(
      sql,
      tenantId,
      (tx) => tx`select 1 from notify_requests where tenant_id = ${tenantId}`,
    );
    expect(subs).toHaveLength(1);

    const batch = {
      batchId: `b-${nonce}`,
      sessionId: `s-${nonce}`,
      events: [
        { name: 'page_view', at: Date.now(), props: { path: '/' } },
        { name: 'custom.hero_click', props: {} },
        { name: 'order_placed', props: {} }, // Core-only — dropped
        { name: 'BAD NAME' },
      ],
    };
    const e1 = await pub('POST', '/storefront/v1/events', batch);
    expect(e1.status).toBe(202);
    expect(await e1.json()).toEqual({ accepted: 2, replayed: false });
    const e2 = await pub('POST', '/storefront/v1/events', batch);
    expect(await e2.json()).toEqual({ accepted: 0, replayed: true });
  });
});
