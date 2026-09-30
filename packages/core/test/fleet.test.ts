import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { join } from 'node:path';
import postgres from 'postgres';
import { createApp } from '../src/app.ts';
import type { MerchantNotify } from '../src/admin/context.ts';
import { migrate } from '../src/platform/db.ts';
import { fleetDeps, type FleetDeps } from '../src/modules/fleet/deps.ts';
import { advance } from '../src/modules/fleet/provision.ts';
import { runProbes } from '../src/modules/fleet/probe.ts';
import type { StaffNotice } from '../src/modules/staff.ts';

// The Control Plane end to end against Postgres, with a fake edge behind the probes.
describe.skipIf(!process.env.TEST_DATABASE_URL)('control plane (db)', () => {
  const sql = postgres(process.env.TEST_DATABASE_URL!);
  const nonce = crypto.randomUUID().slice(0, 8);
  const bundle = `b${nonce}`;
  const ownBundle = `o${nonce}`;
  const storeDomain = `fleet-${nonce}.test`;

  // the fake edge: what each host serves right now
  const edge = new Map<
    string,
    { release: string | null; down?: boolean; pageDown?: boolean; checkoutDown?: boolean }
  >();
  const fakeFetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input));
    const headers = new Headers(init?.headers);
    const e = edge.get(headers.get('host') ?? '');
    if (!e || e.down) return new Response('bad gateway', { status: 502 });
    switch (url.pathname) {
      case '/':
        if (e.pageDown)
          return new Response('bad gateway', {
            status: 502,
            headers: e.release ? { 'x-vendua-release': e.release } : {},
          });
        return new Response(
          '<html><head><script id="vendua-state">window.__VENDUA_STATE__={}</script></head></html>',
          { headers: e.release ? { 'x-vendua-release': e.release } : {} },
        );
      case '/v1/v.js':
        return new Response('window.__VENDUA_LOADER__={}');
      case '/storefront/v1/state':
        return Response.json({ store: { status: 'open' } });
      case '/checkout/v1/session':
        if (e.checkoutDown) return new Response('boom', { status: 503 });
        return Response.json(
          { sessionToken: 'probe-token' },
          { status: headers.get('authorization') ? 200 : 201 },
        );
      default:
        return new Response('nope', { status: 404 });
    }
  }) as typeof fetch;

  const staffNotices: StaffNotice[] = [];
  const sent: { channel: string; to: string; text: string }[] = [];
  const notify: MerchantNotify = {
    whatsapp: async (to, text) => void sent.push({ channel: 'whatsapp', to, text }),
    email: async (to, _s, text) => void sent.push({ channel: 'email', to, text }),
  };
  const d: FleetDeps = fleetDeps(sql, {
    storeDomain,
    adminHost: `painel.${storeDomain}`,
    probes: false,
    probeOrigin: 'http://edge.test',
    fetch: fakeFetch,
    notify,
    staff: async (n) => void staffNotices.push(n),
  });
  const created: string[] = [];
  d.only = created;
  const app = createApp({
    sql,
    sessionSecret: 's',
    controlSecret: 'ctl',
    autoDrain: false,
    storeDomain,
    notify,
    fleet: d,
    edgeSecret: 'edge-key',
  });

  const tenants: Record<'a' | 'b' | 'c' | 'd', { id: string; slug: string; host: string }> = {
    a: { id: '', slug: `fa-${nonce}`, host: `fa-${nonce}.localhost` },
    b: { id: '', slug: `fb-${nonce}`, host: `fb-${nonce}.localhost` },
    c: { id: '', slug: `fc-${nonce}`, host: `fc-${nonce}.localhost` },
    d: { id: '', slug: `fd-${nonce}`, host: `fd-${nonce}.localhost` },
  };

  const makeStore = async (t: { id: string; slug: string; host: string }) => {
    t.id = (
      await sql<{ id: string }[]>`
        insert into tenants (slug, name) values (${t.slug}, ${t.slug}) returning id
      `
    )[0]!.id;
    created.push(t.id);
    await sql`insert into domains (host, tenant_id, is_primary) values (${t.host}, ${t.id}, true)`;
    await sql`
      insert into storefront_ops (tenant_id, bundle) values (${t.id}, ${bundle})
      on conflict (tenant_id) do update set bundle = excluded.bundle
    `;
  };

  beforeAll(async () => {
    await migrate(sql, join(import.meta.dir, '../db/migrations'));
    await makeStore(tenants.a);
    await makeStore(tenants.b);
  });
  afterAll(async () => {
    if (created.length) await sql`delete from tenants where id in ${sql(created)}`;
    await sql`delete from leads where email like ${`%@${nonce}.test`}`;
    await sql`delete from releases where bundle in (${bundle}, ${ownBundle})`;
    await sql.end();
  });

  let seq = 0;
  const ctl = (method: string, path: string, body?: unknown, idem = true) =>
    app.request(path, {
      method,
      headers: {
        'content-type': 'application/json',
        'x-vendua-control': 'ctl',
        ...(idem ? { 'idempotency-key': `${nonce}-${++seq}` } : {}),
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
  const rid = () => crypto.randomUUID().replace(/-/g, '').slice(0, 20);
  const manifest = (
    id: string,
    o: { b?: string; tenant?: string; qa?: 'passed' | 'failed' } = {},
  ) => ({
    manifestVersion: 1,
    release: id,
    bundle: o.b ?? bundle,
    tenant: o.tenant ?? `nobody-${nonce}`,
    contract: 2,
    kernelVersion: '1.9.0',
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
    qa: {
      status: o.qa ?? 'passed',
      checks: [{ id: 'compat', ok: (o.qa ?? 'passed') === 'passed' }],
    },
    build: {},
  });
  const publish = (m: ReturnType<typeof manifest>) =>
    ctl('POST', '/control/v1/fleet/releases', {
      manifest: m,
      artifactUri: `file:///srv/artifacts/storefronts/${m.bundle}/${m.release}`,
    });
  const ops = async (t: { id: string }) =>
    (
      await sql<{ live_release_id: string | null; release_policy: string; bundle: string }[]>`
        select live_release_id, release_policy, bundle from storefront_ops where tenant_id = ${t.id}
      `
    )[0]!;
  const lastDeployment = async (t: { id: string }) =>
    (
      await sql<{ status: string; release_id: string; kind: string; actor: string }[]>`
        select status, release_id, kind, actor from deployments where tenant_id = ${t.id}
        order by started_at desc limit 1
      `
    )[0];
  const probeNow = async () => {
    await sql`update fleet_probes set next_check_at = now(), lease_until = null
              where tenant_id in ${sql(created)}`;
    await runProbes(d);
  };
  const resolve = (host: string, key = 'edge-key') =>
    app.request(`/edge/v1/resolve?host=${encodeURIComponent(host)}`, {
      headers: key ? { 'x-vendua-edge': key } : {},
    });

  const r1 = rid();
  const r2 = rid();
  const r3 = rid();
  const r4 = rid();
  const r5 = rid();

  test('a release registers once, validates, and moves every auto store on its bundle', async () => {
    const res = await publish(manifest(r1));
    expect(res.status).toBe(201);
    const body = (await res.json()) as {
      created: boolean;
      promoted: { tenant: string; status: string }[];
    };
    expect(body.created).toBe(true);
    // probes off: the pointer flip is the deployment
    expect(body.promoted.map((p) => [p.tenant, p.status]).sort()).toEqual(
      [
        [tenants.a.slug, 'live'],
        [tenants.b.slug, 'live'],
      ].sort(),
    );
    expect((await ops(tenants.a)).live_release_id).toBe(r1);

    const again = await publish(manifest(r1));
    expect(again.status).toBe(200);
    expect(((await again.json()) as { created: boolean; promoted: [] }).promoted).toEqual([]);
    // the same build published to another artifact store (volume → R2) moves there
    const moved = await ctl('POST', '/control/v1/fleet/releases', {
      manifest: manifest(r1),
      artifactUri: `s3://vendua-artifacts/storefronts/${bundle}/${r1}`,
    });
    expect(moved.status).toBe(200);
    expect(((await moved.json()) as { release: { artifactUri: string } }).release.artifactUri).toBe(
      `s3://vendua-artifacts/storefronts/${bundle}/${r1}`,
    );
    // …but the same id can't claim another bundle
    const clash = await ctl('POST', '/control/v1/fleet/releases', {
      manifest: manifest(r1, { b: ownBundle }),
      artifactUri: `file:///srv/artifacts/storefronts/${ownBundle}/${r1}`,
    });
    expect(clash.status).toBe(409);
    await publish(manifest(r1));

    expect((await publish({ ...manifest(r1), release: 'zz' })).status).toBe(422);
    expect(
      (
        await ctl('POST', '/control/v1/fleet/releases', {
          manifest: manifest(rid()),
          artifactUri: 'file:///elsewhere',
        })
      ).status,
    ).toBe(422);
    expect(
      (await ctl('POST', '/control/v1/fleet/releases', { manifest: manifest(rid()) }, false))
        .status,
    ).toBe(400);
    // "passed" with a failing check is a lie the API refuses
    const liar = manifest(rid());
    liar.qa.checks = [{ id: 'budget', ok: false }];
    expect((await publish(liar)).status).toBe(422);
  });

  test('the edge resolves hosts to releases, behind its own secret', async () => {
    expect((await resolve(tenants.a.host, '')).status).toBe(404);
    expect((await resolve(tenants.a.host, 'wrong')).status).toBe(404);
    const hit = await resolve(tenants.a.host);
    expect(hit.status).toBe(200);
    const j = (await hit.json()) as {
      tenant: { slug: string };
      primaryHost: string;
      release: { id: string; bundle: string; uri: string; fallback: boolean };
    };
    expect(j.tenant.slug).toBe(tenants.a.slug);
    expect(j.primaryHost).toBe(tenants.a.host);
    expect(j.release).toEqual({
      id: r1,
      bundle,
      uri: `file:///srv/artifacts/storefronts/${bundle}/${r1}`,
      fallback: false,
    });
    // <slug>.<store domain> always resolves, like TenantResolver
    const bySlug = (await (await resolve(`${tenants.a.slug}.${storeDomain}`)).json()) as {
      tenant: { slug: string };
    };
    expect(bySlug.tenant.slug).toBe(tenants.a.slug);
    const miss = await resolve(`nope-${nonce}.localhost`);
    expect(miss.status).toBe(404);
    expect(((await miss.json()) as { error: { code: string } }).error.code).toBe('UNKNOWN_HOST');
    expect((await resolve(`painel.${storeDomain}`)).status).toBe(404);
    expect((await resolve('bad host!')).status).toBe(404);

    // a store minutes old, not promoted yet, is served its bundle's newest build
    await makeStore(tenants.c);
    const fresh = (await (await resolve(tenants.c.host)).json()) as {
      release: { id: string; fallback: boolean };
    };
    expect(fresh.release).toMatchObject({ id: r1, fallback: true });
  });

  test('with probes on, a deployment is pending until a probe sees the edge serve it', async () => {
    d.probes = true;
    for (const t of Object.values(tenants)) edge.set(t.host, { release: r1 });
    const res = await publish(manifest(r2));
    const body = (await res.json()) as { promoted: { tenant: string; status: string }[] };
    expect(body.promoted.every((p) => p.status === 'pending')).toBe(true);
    expect((await ops(tenants.a)).live_release_id).toBe(r2);

    // the edge still serves r1 (its cache): healthy, but not verified
    await probeNow();
    expect((await lastDeployment(tenants.a))!.status).toBe('pending');

    for (const t of Object.values(tenants)) edge.set(t.host, { release: r2 });
    await probeNow();
    expect((await lastDeployment(tenants.a))!.status).toBe('live');
    expect((await lastDeployment(tenants.b))!.status).toBe('live');
    const probe = (
      await sql<{ status: string; last_release_id: string; checkout_token: string }[]>`
        select status, last_release_id, checkout_token from fleet_probes where host = ${tenants.a.host}
      `
    )[0]!;
    expect(probe).toMatchObject({
      status: 'ok',
      last_release_id: r2,
      checkout_token: 'probe-token',
    });
  });

  test('a release that fails its probes rolls back, pins the store and opens incidents', async () => {
    staffNotices.length = 0;
    await publish(manifest(r3));
    // the edge serves r3 on A and its page is broken
    edge.set(tenants.a.host, { release: r3, pageDown: true });
    edge.set(tenants.b.host, { release: r3 });
    edge.set(tenants.c.host, { release: r3 });
    await probeNow();
    await probeNow();
    expect((await lastDeployment(tenants.a))!.status).toBe('pending');
    await probeNow();

    const a = await ops(tenants.a);
    expect(a).toMatchObject({ live_release_id: r2, release_policy: 'pinned' });
    const deps = await sql<{ release_id: string; status: string; kind: string }[]>`
      select release_id, status, kind from deployments where tenant_id = ${tenants.a.id}
      order by started_at desc limit 2
    `;
    expect([...deps]).toEqual([
      { release_id: r2, status: 'pending', kind: 'rollback' },
      { release_id: r3, status: 'failed', kind: 'auto' },
    ]);
    expect((await lastDeployment(tenants.b))!.status).toBe('live');
    const open = await sql<{ kind: string }[]>`
      select kind from fleet_incidents where tenant_id = ${tenants.a.id} and resolved_at is null
      order by kind
    `;
    expect(open.map((i) => i.kind)).toEqual(['deployment_failed', 'probe_failing']);
    expect(staffNotices.length).toBeGreaterThanOrEqual(2);

    // the edge serves r2 again: the rollback verifies and the probe incident resolves itself
    edge.set(tenants.a.host, { release: r2 });
    await probeNow();
    expect((await lastDeployment(tenants.a))!).toMatchObject({ status: 'live', release_id: r2 });
    const still = await sql<{ kind: string }[]>`
      select kind from fleet_incidents where tenant_id = ${tenants.a.id} and resolved_at is null
    `;
    expect(still.map((i) => i.kind)).toEqual(['deployment_failed']);
    expect(staffNotices.some((n) => n.subject.startsWith('Resolvido'))).toBe(true);
    const history = await sql<{ ok: boolean }[]>`
      select ok from health_checks where host = ${tenants.a.host} order by at
    `;
    expect(history.map((h) => h.ok)).toEqual([false, false, false, true]);
  });

  test('pinned stays pinned; rollback, promote and policy are staff levers', async () => {
    for (const t of Object.values(tenants)) edge.set(t.host, { release: r4 });
    const res = (await (await publish(manifest(r4))).json()) as { promoted: { tenant: string }[] };
    expect(res.promoted.map((p) => p.tenant).sort()).toEqual(
      [tenants.b.slug, tenants.c.slug].sort(),
    );
    expect((await ops(tenants.a)).live_release_id).toBe(r2);
    await probeNow();

    // B: back to the newest release it had live before r4
    const rb = await ctl('POST', `/control/v1/fleet/storefronts/${tenants.b.slug}/rollback`, {
      reason: 'cliente reclamou',
    });
    expect(rb.status).toBe(201);
    expect(await ops(tenants.b)).toMatchObject({ live_release_id: r3, release_policy: 'pinned' });
    const prev = await sql<{ status: string }[]>`
      select status from deployments where tenant_id = ${tenants.b.id} and release_id = ${r4}
    `;
    expect(prev.map((p) => p.status)).toEqual(['rolled_back']);

    // A: back to auto follows the bundle
    const pa = await ctl('PATCH', `/control/v1/fleet/storefronts/${tenants.a.slug}`, {
      policy: 'auto',
    });
    expect(pa.status).toBe(200);
    expect(await ops(tenants.a)).toMatchObject({ live_release_id: r4, release_policy: 'auto' });

    // promoting an older release pins; promoting the newest follows again
    const old = await ctl('POST', `/control/v1/fleet/storefronts/${tenants.c.slug}/promote`, {
      release: r1,
    });
    expect(old.status).toBe(201);
    expect(((await old.json()) as { policy: string }).policy).toBe('pinned');
    const newest = await ctl('POST', `/control/v1/fleet/storefronts/${tenants.c.slug}/promote`, {
      release: r4,
    });
    expect(((await newest.json()) as { policy: string }).policy).toBe('auto');

    const bad = rid();
    await publish(manifest(bad, { qa: 'failed' }));
    const refused = await ctl('POST', `/control/v1/fleet/storefronts/${tenants.c.slug}/promote`, {
      release: bad,
    });
    expect(refused.status).toBe(409);
    expect(((await refused.json()) as { error: { code: string } }).error.code).toBe(
      'RELEASE_QA_FAILED',
    );
    expect(
      (
        await ctl('POST', `/control/v1/fleet/storefronts/${tenants.c.slug}/promote`, {
          release: rid(),
        })
      ).status,
    ).toBe(404);
    expect(
      (await ctl('POST', `/control/v1/fleet/storefronts/nope-${nonce}/rollback`, {})).status,
    ).toBe(404);
    expect((await ctl('POST', '/control/v1/fleet/storefronts/BAD!/rollback', {})).status).toBe(404);
  });

  test('a pending deployment nobody verifies in 5 minutes fails and rolls back', async () => {
    await publish(manifest(r5));
    // the edge keeps serving r4 (healthy) — the new release never shows up
    await sql`update deployments set started_at = now() - interval '6 minutes'
              where tenant_id = ${tenants.c.id} and status = 'pending'`;
    await probeNow();
    expect(await ops(tenants.c)).toMatchObject({ live_release_id: r4, release_policy: 'pinned' });
    const failed = await sql<{ status: string; detail: string }[]>`
      select status, detail from deployments where tenant_id = ${tenants.c.id} and release_id = ${r5}
    `;
    expect(failed[0]!.status).toBe('failed');
    expect(failed[0]!.detail).toContain('5 minutos');
  });

  test('a deployment is judged on its own release, never on Core-side checks or a stale edge', async () => {
    const t = tenants.d;
    await makeStore(t);
    const last2 = async () => [
      ...(await sql<{ release_id: string; previous_release_id: string | null; status: string }[]>`
          select release_id, previous_release_id, status from deployments
          where tenant_id = ${t.id} order by started_at desc limit 2
        `),
    ];
    // checkout (Core) failing doesn't stop a release whose page the edge serves
    edge.set(t.host, { release: r4, checkoutDown: true });
    await ctl('POST', `/control/v1/fleet/storefronts/${t.slug}/promote`, { release: r4 });
    await probeNow();
    expect((await last2())[0]).toMatchObject({ release_id: r4, status: 'live' });

    // the edge still serving r4 (its cache) while r5 waits: failing probes don't judge r5
    await ctl('POST', `/control/v1/fleet/storefronts/${t.slug}/promote`, { release: r5 });
    for (let i = 0; i < 4; i++) await probeNow();
    expect((await last2())[0]).toMatchObject({ release_id: r5, status: 'pending' });
    edge.set(t.host, { release: r5 });
    await probeNow();
    expect((await last2())[0]).toMatchObject({ release_id: r5, status: 'live' });

    // a release superseded while pending is never what the next one falls back to
    await ctl('POST', `/control/v1/fleet/storefronts/${t.slug}/promote`, { release: r1 });
    await ctl('POST', `/control/v1/fleet/storefronts/${t.slug}/promote`, { release: r2 });
    expect(await last2()).toEqual([
      { release_id: r2, previous_release_id: r5, status: 'pending' },
      { release_id: r1, previous_release_id: r5, status: 'superseded' },
    ]);
    edge.set(t.host, { release: r2, pageDown: true });
    for (let i = 0; i < 3; i++) await probeNow();
    expect(await ops(t)).toMatchObject({ live_release_id: r5, release_policy: 'pinned' });

    // a failure whose previous release is on another bundle stays put and says so, loudly
    const o1 = rid();
    await publish(manifest(o1, { b: ownBundle }));
    edge.set(t.host, { release: o1, pageDown: true });
    const moved = await ctl('PATCH', `/control/v1/fleet/storefronts/${t.slug}`, {
      bundle: ownBundle,
    });
    expect(moved.status).toBe(200);
    for (let i = 0; i < 3; i++) await probeNow();
    expect(await ops(t)).toMatchObject({ live_release_id: o1, bundle: ownBundle });
    expect((await last2())[0]).toMatchObject({ release_id: o1, status: 'failed' });
    const critical = await sql<{ severity: string }[]>`
      select severity from fleet_incidents
      where tenant_id = ${t.id} and kind = 'deployment_failed' and resolved_at is null
        and detail->>'release' = ${o1}
    `;
    expect(critical.map((i) => i.severity)).toEqual(['critical']);
    edge.set(t.host, { release: o1 });
  });

  test('a bundle built for a store becomes its bundle, unless staff chose one', async () => {
    d.probes = false;
    const own = rid();
    await publish(manifest(own, { b: ownBundle, tenant: tenants.b.slug }));
    expect(await ops(tenants.b)).toMatchObject({
      bundle: ownBundle,
      live_release_id: own,
      release_policy: 'auto',
    });
    const back = await ctl('PATCH', `/control/v1/fleet/storefronts/${tenants.b.slug}`, { bundle });
    expect(back.status).toBe(200);
    expect((await ops(tenants.b)).bundle).toBe(bundle);
    await publish(manifest(rid(), { b: ownBundle, tenant: tenants.b.slug }));
    expect((await ops(tenants.b)).bundle).toBe(bundle);
    expect(
      (await ctl('PATCH', `/control/v1/fleet/storefronts/${tenants.b.slug}`, { bundle: 'zz-none' }))
        .status,
    ).toBe(409);
  });

  const waitFor = async (check: () => Promise<boolean>) => {
    for (let i = 0; i < 50; i++) {
      if (await check()) return;
      await Bun.sleep(50);
    }
    throw new Error('timed out');
  };

  test('a staff invite from a lead goes release → verify → invite → live, and so does the lead', async () => {
    const phone = `119${String(Date.now()).slice(-8)}`;
    const lead = (
      await sql<{ id: string }[]>`
        insert into leads (name, phone, email, state)
        values ('Dona Ana', ${`+55${phone}`}, ${`ana@${nonce}.test`}, 'contacted') returning id
      `
    )[0]!.id;
    const slug = `fi-${nonce}`;
    const res = await ctl('POST', '/control/v1/fleet/provisionings', {
      leadId: lead,
      slug,
      storeName: 'Doces da Ana',
      planId: 'basic',
      ownerName: 'Ana Souza',
      ownerPhone: `(${phone.slice(0, 2)}) ${phone.slice(2)}`,
      ownerEmail: `ana@${nonce}.test`,
    });
    expect(res.status).toBe(201);
    const p = (
      (await res.json()) as { provisioning: { id: string; tenantId: string; state: string } }
    ).provisioning;
    created.push(p.tenantId);
    expect(p.state).toBe('release');
    // the route kicked the provisioner; a db without a `_template` release parks it at release
    await waitFor(async () =>
      Boolean(
        (
          await sql`select 1 from provisionings where id = ${p.id}
                    and (last_error is not null or state <> 'release')`
        )[0],
      ),
    );
    await sql`update storefront_ops set bundle = ${bundle}
              where tenant_id = ${p.tenantId} and live_release_id is null`;
    await advance(d, p.id);

    const row = (
      await sql<{ state: string; source: string; lead_id: string; log: { note: string }[] }[]>`
        select state, source, lead_id, log from provisionings where id = ${p.id}
      `
    )[0]!;
    expect(row).toMatchObject({ state: 'live', source: 'invite', lead_id: lead });
    expect(row.log.map((e) => e.note).join(' | ')).toContain(
      'convite enviado por whatsapp e email',
    );
    // the lead moves after the provisioning commits (whichever advance got there first)
    await waitFor(async () =>
      Boolean((await sql`select 1 from leads where id = ${lead} and state = 'live'`)[0]),
    );
    const wa = sent.find((m) => m.channel === 'whatsapp' && m.to === phone);
    expect(wa?.text).toContain(`${slug}.${storeDomain}`);
    expect(wa?.text).toContain(`https://painel.${storeDomain}/admin/`);
    const l = (
      await sql<
        { state: string; tenant_id: string }[]
      >`select state, tenant_id from leads where id = ${lead}`
    )[0]!;
    expect(l).toEqual({ state: 'live', tenant_id: p.tenantId });
    const moves = await sql<{ to_state: string }[]>`
      select to_state from lead_state_history where lead_id = ${lead} order by at
    `;
    expect(moves.map((m) => m.to_state)).toEqual(['invited', 'live']);
    expect(staffNotices.some((n) => n.subject === 'Loja no ar: Doces da Ana')).toBe(true);

    const list = (await (
      await ctl('GET', `/control/v1/fleet/provisionings?leadId=${lead}`, undefined, false)
    ).json()) as { provisionings: { state: string; leadName: string }[] };
    expect(list.provisionings).toEqual([
      expect.objectContaining({ state: 'live', leadName: 'Dona Ana' }),
    ]);

    const again = await ctl('POST', '/control/v1/fleet/provisionings', {
      leadId: lead,
      slug: `fj-${nonce}`,
      storeName: 'Outra',
      planId: 'basic',
      ownerName: 'Ana Souza',
      ownerPhone: phone,
      ownerEmail: `ana@${nonce}.test`,
    });
    expect(again.status).toBe(409);
    const base = {
      storeName: 'Outra',
      planId: 'basic',
      ownerName: 'Ana',
      ownerPhone: phone,
      ownerEmail: `x@${nonce}.test`,
    };
    const taken = await ctl('POST', '/control/v1/fleet/provisionings', { ...base, slug });
    expect(((await taken.json()) as { error: { code: string } }).error.code).toBe('SLUG_TAKEN');
    expect(
      (await ctl('POST', '/control/v1/fleet/provisionings', { ...base, slug: 'painel' })).status,
    ).toBe(422);
    expect(
      (
        await ctl('POST', '/control/v1/fleet/provisionings', {
          ...base,
          slug: `fk-${nonce}`,
          ownerPhone: '123',
        })
      ).status,
    ).toBe(422);
    expect(
      (
        await ctl('POST', '/control/v1/fleet/provisionings', {
          ...base,
          slug: `fk-${nonce}`,
          planId: 'nope',
        })
      ).status,
    ).toBe(422);
  });

  test('a self-serve signup provisions the same way, graduates its lead and sends no invite', async () => {
    const phone = `219${String(Date.now()).slice(-8)}`;
    const lead = (
      await sql<{ id: string }[]>`
        insert into leads (name, phone, email, state)
        values ('Seu Beto', ${phone}, ${`beto@${nonce}.test`}, 'lead') returning id
      `
    )[0]!.id;
    const slug = `fs-${nonce}`;
    const tenantId = (
      await sql<{ id: string }[]>`
        select provision_store(${slug}, 'Bar do Beto', 'basic', ${`${slug}.${storeDomain}`},
                               'Beto', ${phone}, ${`beto@${nonce}.test`}) as id
      `
    )[0]!.id;
    created.push(tenantId);
    await sql`update storefront_ops set bundle = ${bundle} where tenant_id = ${tenantId}`;
    const p = (
      await sql<{ id: string; source: string }[]>`
        select id, source from provisionings where tenant_id = ${tenantId}
      `
    )[0]!;
    expect(p.source).toBe('signup');
    const before = sent.length;
    await advance(d, p.id);
    await waitFor(async () =>
      Boolean((await sql`select 1 from leads where id = ${lead} and state = 'live'`)[0]),
    );
    const row = (
      await sql<{ state: string; lead_id: string }[]>`
        select state, lead_id from provisionings where id = ${p.id}
      `
    )[0]!;
    expect(row).toEqual({ state: 'live', lead_id: lead });
    expect(sent.length).toBe(before);
    const l = (await sql<{ state: string }[]>`select state from leads where id = ${lead}`)[0]!;
    expect(l.state).toBe('live');

    // the 10-argument form is staff-only
    const denied = await sql`
      select provision_store('x-denied', 'X', 'basic', 'x-denied.test', 'X', '11999990000',
                             'x@x.test', 'invite')
    `
      .then(() => 'ok')
      .catch((e: { code?: string }) => e.code);
    expect(denied).toBe('42501');
  });

  test('fleet status and storefront detail read the whole picture', async () => {
    const st = (await (await ctl('GET', '/control/v1/fleet/status', undefined, false)).json()) as {
      bundles: { bundle: string; latestRelease: string }[];
      stores: number;
    };
    expect(st.bundles.find((b) => b.bundle === bundle)?.latestRelease).toBeTruthy();
    const det = (await (
      await ctl('GET', `/control/v1/fleet/storefronts/${tenants.a.slug}`, undefined, false)
    ).json()) as {
      storefront: {
        live: { release: string };
        deployments: unknown[];
        releases: unknown[];
        probes: { host: string }[];
        incidents: { kind: string }[];
      };
    };
    // A followed its bundle to r5; only C, pinned by the timeout, stayed behind
    expect(det.storefront.live.release).toBe(r5);
    expect(det.storefront.deployments.length).toBeGreaterThanOrEqual(4);
    expect(det.storefront.probes.map((p) => p.host)).toEqual([tenants.a.host]);
    expect(det.storefront.incidents.map((i) => i.kind)).toContain('deployment_failed');
    const list = (await (
      await ctl('GET', '/control/v1/fleet/storefronts', undefined, false)
    ).json()) as { storefronts: { slug: string; host: string }[] };
    expect(list.storefronts.find((s) => s.slug === tenants.a.slug)?.host).toBe(tenants.a.host);

    const inc = (await (
      await ctl('GET', '/control/v1/fleet/incidents', undefined, false)
    ).json()) as { incidents: { id: string; tenant: string }[] };
    const mine = inc.incidents.find((i) => i.tenant === tenants.a.slug)!;
    const acked = await ctl('PATCH', `/control/v1/fleet/incidents/${mine.id}`, { resolved: true });
    expect(acked.status).toBe(200);
    expect(
      (await ctl('PATCH', '/control/v1/fleet/incidents/not-a-uuid', { ack: true })).status,
    ).toBe(400);
  });
});
