import { afterAll, beforeAll, describe, expect, mock, setSystemTime, test } from 'bun:test';
import { createHmac } from 'node:crypto';
import { join } from 'node:path';
import { Hono } from 'hono';
import postgres from 'postgres';
import { createApp } from '../src/app.ts';
import type { MerchantNotify } from '../src/admin/context.ts';
import { checkWhatsAppOutage, ensureSocket, logoutWa } from '../src/agent/channels/whatsapp.ts';
import { controlTx } from '../src/modules/control.ts';
import { fleetDeps, type FleetDeps } from '../src/modules/fleet/deps.ts';
import { ackIncident, openIncidentTx } from '../src/modules/fleet/incidents.ts';
import { runProbes } from '../src/modules/fleet/probe.ts';
import { advance } from '../src/modules/fleet/provision.ts';
import { getIntegration, upsertIntegration } from '../src/modules/integrations.ts';
import type { StaffNotice } from '../src/modules/staff.ts';
import {
  bootVersion,
  recordBoot,
  recordChannelState,
  routeOf,
  unhandledErrorReporter,
} from '../src/modules/system-events.ts';
import { migrate } from '../src/platform/db.ts';
import { HttpError, errorJson, onUnhandledError } from '../src/platform/http.ts';

// The WhatsApp socket is baileys in-process: a fake one lets the real connection handler run.
type ConnUpdate = { connection?: string; lastDisconnect?: { error?: unknown } };
interface FakeSocket {
  creds: Record<string, unknown>;
  emit: (u: ConnUpdate) => void;
}
const fakeSockets: FakeSocket[] = [];
mock.module('baileys', () => ({
  default: (opts: { auth: { creds: Record<string, unknown> } }) => {
    const handlers = new Map<string, ((u: unknown) => void)[]>();
    const s = {
      creds: opts.auth.creds,
      user: { id: '5521999990000:7@s.whatsapp.net', name: 'Venduá' },
      ev: {
        on: (ev: string, cb: (u: unknown) => void) =>
          handlers.set(ev, [...(handlers.get(ev) ?? []), cb]),
      },
      emit: (u: ConnUpdate) => {
        for (const cb of handlers.get('connection.update') ?? []) cb(u);
      },
      end: () => undefined,
      logout: async () =>
        s.emit({ connection: 'close', lastDisconnect: { error: { output: { statusCode: 401 } } } }),
      sendMessage: async () => ({ key: { id: 'fake' } }),
      onWhatsApp: async () => [],
      requestPairingCode: async () => '00000000',
    };
    fakeSockets.push(s);
    return s;
  },
  Browsers: { ubuntu: (b: string) => ['Ubuntu', b, '22.04'] },
  initAuthCreds: () => ({}),
  fetchLatestWaWebVersion: async () => ({ version: [2, 3000, 0], isLatest: true }),
  BufferJSON: {
    replacer: (_k: string, v: unknown) => v,
    reviver: (_k: string, v: unknown) => v,
  },
  normalizeMessageContent: (m: unknown) => m,
}));

interface Ev {
  id: string;
  kind: string;
  tenant_id: string | null;
  anchor: string | null;
  dedupe_key: string | null;
  severity: string;
  data: Record<string, any>;
}

describe.skipIf(!process.env.TEST_DATABASE_URL)(
  'staff events: fleet, status page, Core (db)',
  () => {
    const sql = postgres(process.env.TEST_DATABASE_URL!, { onnotice: () => {} });
    // TEST_APP_DATABASE_URL runs the API as vendua_app under RLS, as prod does
    const appSql = process.env.TEST_APP_DATABASE_URL
      ? postgres(process.env.TEST_APP_DATABASE_URL, { onnotice: () => {} })
      : sql;
    const nonce = crypto.randomUUID().slice(0, 8);
    const bundle = `se${nonce}`;
    const storeDomain = `sef-${nonce}.test`;
    let startId = '0';

    const edge = new Map<string, { release: string | null; pageDown?: boolean }>();
    const fakeFetch = (async (input: string | URL | Request, init?: RequestInit) => {
      const url = new URL(String(input));
      const headers = new Headers(init?.headers);
      const e = edge.get(headers.get('host') ?? '');
      if (!e) return new Response('bad gateway', { status: 502 });
      const rel: Record<string, string> = e.release ? { 'x-vendua-release': e.release } : {};
      switch (url.pathname) {
        case '/':
          if (e.pageDown) return new Response('bad gateway', { status: 502, headers: rel });
          return new Response('<script id="vendua-state">window.__VENDUA_STATE__={}</script>', {
            headers: rel,
          });
        case '/v1/v.js':
          return new Response('window.__VENDUA_LOADER__={}');
        case '/storefront/v1/state':
          return Response.json({ store: { status: 'open' } });
        case '/checkout/v1/session':
          return Response.json({ sessionToken: 'probe-token' }, { status: 201 });
        default:
          return new Response('nope', { status: 404 });
      }
    }) as typeof fetch;

    const staffNotices: StaffNotice[] = [];
    const notify: MerchantNotify = {
      whatsapp: async () => undefined,
      email: async () => undefined,
    };
    const d: FleetDeps = fleetDeps(appSql, {
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
      sql: appSql,
      sessionSecret: 's',
      controlSecret: 'ctl',
      autoDrain: false,
      storeDomain,
      notify,
      fleet: d,
      edgeSecret: 'edge-key',
    });

    const a = {
      id: '',
      slug: `sea-${nonce}`,
      name: `Padaria A ${nonce}`,
      host: `sea-${nonce}.localhost`,
    };
    const b = {
      id: '',
      slug: `seb-${nonce}`,
      name: `Doceria B ${nonce}`,
      host: `seb-${nonce}.localhost`,
    };
    const makeStore = async (t: typeof a) => {
      t.id = (
        await sql<{ id: string }[]>`
        insert into tenants (slug, name) values (${t.slug}, ${t.name}) returning id
      `
      )[0]!.id;
      created.push(t.id);
      await sql`insert into domains (host, tenant_id, is_primary) values (${t.host}, ${t.id}, true)`;
      await sql`
      insert into storefront_ops (tenant_id, bundle) values (${t.id}, ${bundle})
      on conflict (tenant_id) do update set bundle = excluded.bundle
    `;
    };
    const statusIds: string[] = [];
    const waAccount = `wa-${nonce}`;
    const IG_SECRET = `ig-${nonce}`;
    const prevIgSecret = process.env.IG_SIDECAR_SECRET;

    beforeAll(async () => {
      await migrate(sql, join(import.meta.dir, '../db/migrations'));
      startId = (
        await sql<{ n: string }[]>`select coalesce(max(id), 0)::text as n from staff_events`
      )[0]!.n;
      await makeStore(a);
      await makeStore(b);
    });
    afterAll(async () => {
      onUnhandledError(null);
      await sql`update control_integrations set enabled = false where kind in ('whatsapp', 'instagram')`;
      await ensureSocket(appSql, null).catch(() => undefined);
      if (prevIgSecret === undefined) delete process.env.IG_SIDECAR_SECRET;
      else process.env.IG_SIDECAR_SECRET = prevIgSecret;
      if (created.length) await sql`delete from tenants where id in ${sql(created)}`;
      if (statusIds.length) await sql`delete from platform_incidents where id in ${sql(statusIds)}`;
      await sql`delete from leads where email like ${`%@${nonce}.test`}`;
      await sql`delete from releases where bundle = ${bundle}`;
      await sql`delete from wa_auth_state where account_id = ${waAccount}`;
      await sql`delete from staff_events where id > ${startId}`;
      if (appSql !== sql) await appSql.end();
      await sql.end();
    });

    let seq = 0;
    const ctl = (method: string, path: string, body?: unknown, key = `${nonce}-${++seq}`) =>
      app.request(path, {
        method,
        headers: {
          'content-type': 'application/json',
          'x-vendua-control': 'ctl',
          'idempotency-key': key,
        },
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      });
    const evs = (kind: string, where = sql``) =>
      sql<Ev[]>`
      select id::text, kind, tenant_id, anchor, dedupe_key, severity, data from staff_events
      where id > ${startId} and kind = ${kind} ${where} order by id
    `;
    const waitFor = async (check: () => Promise<boolean>, ms = 3_000) => {
      for (const end = Date.now() + ms; Date.now() < end; await Bun.sleep(50))
        if (await check()) return;
      throw new Error('timed out');
    };
    const rid = () => crypto.randomUUID().replace(/-/g, '').slice(0, 20);
    const manifest = (id: string) => ({
      manifestVersion: 1,
      release: id,
      bundle,
      tenant: `nobody-${nonce}`,
      contract: 2,
      kernelVersion: '1.9.0',
      builtAt: new Date().toISOString(),
      commit: 'abc1234',
      files: { 'index.html': { size: 10, sha256: 'a'.repeat(64), type: 'text/html' } },
      qa: { status: 'passed', checks: [{ id: 'compat', ok: true }] },
    });
    const publish = (id: string, key?: string) =>
      ctl(
        'POST',
        '/control/v1/fleet/releases',
        {
          manifest: manifest(id),
          artifactUri: `file:///srv/artifacts/storefronts/${bundle}/${id}`,
        },
        key,
      );
    const probeNow = async () => {
      await sql`update fleet_probes set next_check_at = now(), lease_until = null
              where tenant_id in ${sql(created)}`;
      await runProbes(d);
    };

    const r1 = rid();
    const r2 = rid();
    const r3 = rid();

    test('a new release records release.published once, with the stores it moved', async () => {
      const key = `${nonce}-publish-r1`;
      expect((await publish(r1, key)).status).toBe(201);
      const rows = await evs('release.published', sql`and data->>'releaseId' = ${r1}`);
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        tenant_id: null,
        anchor: `release:${r1}`,
        dedupe_key: `release:${r1}`,
        severity: 'info',
        data: { releaseId: r1, bundle, kernel: '1.9.0', promoted: 2 },
      });
      // a replay and a re-publish of the same build record nothing
      const replay = await publish(r1, key);
      expect(replay.headers.get('x-idempotent-replay')).toBe('true');
      expect((await publish(r1)).status).toBe(200);
      expect(await evs('release.published', sql`and data->>'releaseId' = ${r1}`)).toHaveLength(1);
      // the automatic promotions are not staff actions
      expect(await evs('deployment.manual', sql`and tenant_id in ${sql(created)}`)).toHaveLength(0);
    });

    test('staff promote, rollback, pin and unpin record deployment.manual', async () => {
      expect((await publish(r2)).status).toBe(201);
      const key = `${nonce}-promote-a`;
      const promoted = await ctl(
        'POST',
        `/control/v1/fleet/storefronts/${a.slug}/promote`,
        { release: r1 },
        key,
      );
      expect(promoted.status).toBe(201);
      const replay = await ctl(
        'POST',
        `/control/v1/fleet/storefronts/${a.slug}/promote`,
        { release: r1 },
        key,
      );
      expect(replay.headers.get('x-idempotent-replay')).toBe('true');
      expect(
        (await ctl('POST', `/control/v1/fleet/storefronts/${a.slug}/rollback`, {})).status,
      ).toBe(201);
      expect(
        (await ctl('PATCH', `/control/v1/fleet/storefronts/${b.slug}`, { policy: 'pinned' }))
          .status,
      ).toBe(200);
      // already pinned: nothing changed, nothing recorded
      await ctl('PATCH', `/control/v1/fleet/storefronts/${b.slug}`, { policy: 'pinned' });
      await ctl('PATCH', `/control/v1/fleet/storefronts/${b.slug}`, { ring: 'early' });
      await ctl('PATCH', `/control/v1/fleet/storefronts/${b.slug}`, { policy: 'auto' });

      const rows = await evs('deployment.manual', sql`and tenant_id in ${sql(created)}`);
      expect(rows.map((r) => [r.tenant_id, r.data])).toEqual([
        [a.id, { action: 'promote', storeName: a.name, releaseId: r1, by: 'equipe' }],
        [a.id, { action: 'rollback', storeName: a.name, releaseId: r2, by: 'equipe' }],
        [b.id, { action: 'pin', storeName: b.name, releaseId: r2, by: 'equipe' }],
        [b.id, { action: 'unpin', storeName: b.name, releaseId: r2, by: 'equipe' }],
      ]);
      expect(rows.every((r) => r.anchor === null && r.severity === 'info')).toBe(true);
    });

    test('a failed deployment records deployment.failed; incidents open, escalate and resolve', async () => {
      d.probes = true;
      edge.set(a.host, { release: r2 });
      edge.set(b.host, { release: r2 });
      // A is pinned after its rollback: only B follows r3
      await publish(r3);
      await probeNow();
      edge.set(b.host, { release: r3, pageDown: true });
      for (let i = 0; i < 3; i++) await probeNow();

      const failedDep = (
        await sql<{ id: string }[]>`
        select id from deployments where tenant_id = ${b.id} and release_id = ${r3} and status = 'failed'
      `
      )[0]!;
      const failed = await evs('deployment.failed', sql`and tenant_id = ${b.id}`);
      expect(failed).toHaveLength(1);
      expect(failed[0]).toMatchObject({
        dedupe_key: `deployment:${failedDep.id}:failed`,
        severity: 'warning',
        data: {
          deploymentId: failedDep.id,
          storeName: b.name,
          host: b.host,
          releaseId: r3,
          rolledBackTo: r2,
        },
      });
      expect(failed[0]!.data.reason).toContain('page');

      const incidents = await sql<{ id: string; kind: string }[]>`
      select id, kind from fleet_incidents where tenant_id = ${b.id} order by kind
    `;
      expect(incidents.map((i) => i.kind)).toEqual(['deployment_failed', 'probe_failing']);
      const opened = await evs('incident.opened', sql`and tenant_id = ${b.id}`);
      expect(
        opened.map((r) => [r.anchor, r.data.kind, r.data.severity, r.data.storeName]).sort(),
      ).toEqual(incidents.map((i) => [`incident:${i.id}`, i.kind, 'warning', b.name]).sort());
      const probeIncident = incidents.find((i) => i.kind === 'probe_failing')!;
      expect(opened.find((r) => r.data.kind === 'probe_failing')!.data).toMatchObject({
        incidentId: probeIncident.id,
        subject: b.host,
      });

      // failing for 10 min: the open incident escalates once
      await sql`update fleet_probes set failing_since = now() - interval '11 minutes' where host = ${b.host}`;
      await probeNow();
      await probeNow();
      const escalated = await evs(
        'incident.updated',
        sql`and data->>'incidentId' = ${probeIncident.id} and data->>'change' = 'escalated'`,
      );
      expect(escalated).toHaveLength(1);
      expect(escalated[0]).toMatchObject({
        tenant_id: b.id,
        anchor: `incident:${probeIncident.id}`,
        dedupe_key: `incident:${probeIncident.id}:escalated`,
        severity: 'critical',
        data: { change: 'escalated', by: null },
      });

      // the edge serves the rollback again: the probe incident resolves itself
      edge.set(b.host, { release: r2 });
      await probeNow();
      const resolved = await evs(
        'incident.updated',
        sql`and data->>'incidentId' = ${probeIncident.id} and data->>'change' = 'resolved'`,
      );
      expect(resolved).toHaveLength(1);
      expect(resolved[0]).toMatchObject({
        dedupe_key: `incident:${probeIncident.id}:resolved`,
        severity: 'success',
        data: { by: null, summary: 'a sonda voltou a passar' },
      });
      // the staff email/WhatsApp alerts are unchanged
      expect(staffNotices.some((n) => n.subject.startsWith('Atenção:'))).toBe(true);
      expect(staffNotices.some((n) => n.subject.startsWith('Resolvido:'))).toBe(true);
      d.probes = false;
    });

    test('ack and resolve: the route and ackIncident record incident.updated once per change', async () => {
      const id = (
        await sql<{ id: string }[]>`
        select id from fleet_incidents
        where tenant_id = ${b.id} and kind = 'deployment_failed' and resolved_at is null
      `
      )[0]!.id;
      const changes = async () =>
        (await evs('incident.updated', sql`and data->>'incidentId' = ${id}`)).map((r) => [
          r.data.change,
          r.data.by,
        ]);
      const key = `${nonce}-ack`;
      const acked = await ctl('PATCH', `/control/v1/fleet/incidents/${id}`, { ack: true }, key);
      expect(acked.status).toBe(200);
      const body = (await acked.json()) as { incident: Record<string, unknown> };
      expect(Object.keys(body.incident).sort()).toEqual(
        [
          'ackedAt',
          'detail',
          'id',
          'kind',
          'openedAt',
          'resolvedAt',
          'severity',
          'subject',
          'summary',
          'tenant',
          'tenantId',
        ].sort(),
      );
      expect(body.incident).toMatchObject({ id, tenant: null, resolvedAt: null });
      expect(body.incident.ackedAt).toBeTruthy();
      const replay = await ctl('PATCH', `/control/v1/fleet/incidents/${id}`, { ack: true }, key);
      expect(replay.headers.get('x-idempotent-replay')).toBe('true');
      expect(await replay.json()).toEqual(JSON.parse(JSON.stringify(body)));
      await ctl('PATCH', `/control/v1/fleet/incidents/${id}`, { ack: true });
      expect((await ctl('PATCH', `/control/v1/fleet/incidents/${id}`, {})).status).toBe(422);
      expect(await changes()).toEqual([['acked', 'equipe']]);

      const done = await ctl('PATCH', `/control/v1/fleet/incidents/${id}`, { resolved: true });
      expect(
        ((await done.json()) as { incident: { resolvedAt: string } }).incident.resolvedAt,
      ).toBeTruthy();
      await ctl('PATCH', `/control/v1/fleet/incidents/${id}`, { resolved: true });
      expect(await changes()).toEqual([
        ['acked', 'equipe'],
        ['resolved', 'equipe'],
      ]);
      const rows = await evs('incident.updated', sql`and data->>'incidentId' = ${id}`);
      expect(rows.map((r) => r.dedupe_key)).toEqual([
        `incident:${id}:acked`,
        `incident:${id}:resolved`,
      ]);
      expect(
        (await ctl('PATCH', `/control/v1/fleet/incidents/${crypto.randomUUID()}`, { ack: true }))
          .status,
      ).toBe(404);

      // Discord's buttons: the same function, attributed to a staff member, keyed by the interaction
      const row = (await controlTx(appSql, (tx) =>
        openIncidentTx(tx, {
          tenantId: a.id,
          kind: 'provisioning_stuck',
          subject: `manual-${nonce}`,
          summary: `${a.slug}: teste`,
        }),
      ))!;
      const first = await ackIncident(appSql, row.id, { ack: true }, 'Ana', `discord:${nonce}:1`);
      expect(first).toMatchObject({ status: 200, replayed: false });
      const again = await ackIncident(appSql, row.id, { ack: true }, 'Ana', `discord:${nonce}:1`);
      expect(again.replayed).toBe(true);
      await ackIncident(appSql, row.id, { resolved: true }, 'Bia', `discord:${nonce}:2`);
      expect(
        (await evs('incident.updated', sql`and data->>'incidentId' = ${row.id}`)).map((r) => [
          r.tenant_id,
          r.data.change,
          r.data.by,
        ]),
      ).toEqual([
        [a.id, 'acked', 'Ana'],
        [a.id, 'resolved', 'Bia'],
      ]);
      expect(await evs('incident.opened', sql`and data->>'incidentId' = ${row.id}`)).toHaveLength(
        1,
      );
      await expect(
        ackIncident(appSql, row.id, {}, 'Ana', `discord:${nonce}:3`),
      ).rejects.toBeInstanceOf(HttpError);
    });

    test('a staff invite records store.created; going live records store.live and the onboarding step', async () => {
      const lead = (
        await sql<{ id: string }[]>`
        insert into leads (name, phone, email, state)
        values ('Dona Ana', ${`+55219${String(Date.now()).slice(-8)}`}, ${`ana@${nonce}.test`},
                'contacted') returning id
      `
      )[0]!.id;
      const slug = `sei-${nonce}`;
      const input = {
        leadId: lead,
        slug,
        storeName: 'Doces da Ana',
        planId: 'basic',
        ownerName: 'Ana Souza',
        ownerPhone: `(21) 9${String(Date.now()).slice(-8)}`,
        ownerEmail: `ana@${nonce}.test`,
      };
      const key = `${nonce}-invite`;
      const res = await ctl('POST', '/control/v1/fleet/provisionings', input, key);
      expect(res.status).toBe(201);
      const p = ((await res.json()) as { provisioning: { id: string; tenantId: string } })
        .provisioning;
      created.push(p.tenantId);
      const replay = await ctl('POST', '/control/v1/fleet/provisionings', input, key);
      expect(replay.headers.get('x-idempotent-replay')).toBe('true');
      const born = await evs('store.created', sql`and tenant_id = ${p.tenantId}`);
      expect(born).toHaveLength(1);
      expect(born[0]).toMatchObject({
        anchor: `onboarding:${p.tenantId}`,
        dedupe_key: `store.created:${p.tenantId}`,
        data: {
          storeName: 'Doces da Ana',
          slug,
          source: 'invite',
          owner: 'Ana Souza',
          leadId: lead,
          plan: null,
        },
      });

      // the route kicked the provisioner; with no `_template` release it parks at release
      await waitFor(async () =>
        Boolean(
          (
            await sql`select 1 from provisionings where id = ${p.id}
                    and (last_error is not null or state <> 'release')`
          )[0],
        ),
      );
      expect(await evs('store.live', sql`and tenant_id = ${p.tenantId}`)).toHaveLength(0);
      await sql`update storefront_ops set bundle = ${bundle}
              where tenant_id = ${p.tenantId} and live_release_id is null`;
      await advance(d, p.id);
      await advance(d, p.id);
      expect(
        (await sql<{ state: string }[]>`select state from provisionings where id = ${p.id}`)[0]!
          .state,
      ).toBe('live');
      const live = await evs('store.live', sql`and tenant_id = ${p.tenantId}`);
      expect(live.map((r) => [r.dedupe_key, r.data])).toEqual([
        [`store.live:${p.tenantId}`, { storeName: 'Doces da Ana', host: `${slug}.${storeDomain}` }],
      ]);
      const steps = await evs('store.onboarding', sql`and tenant_id = ${p.tenantId}`);
      expect(steps.map((r) => [r.anchor, r.dedupe_key, r.data])).toEqual([
        [`onboarding:${p.tenantId}`, `onboarding:${p.tenantId}:live`, { step: 'live' }],
      ]);
    });

    test('status page: a post records status.opened, a patch status.updated only on a change', async () => {
      const st = (method: string, path: string, body?: unknown, key?: string) =>
        ctl(method, `/control/v1${path}`, body, key);
      const key = `${nonce}-status`;
      const made = await st(
        'POST',
        '/incidents',
        { title: `Pix atrasando ${nonce}`, body: 'Os Pix estão demorando.', severity: 'degraded' },
        key,
      );
      expect(made.status).toBe(201);
      const inc = ((await made.json()) as { incident: { id: string } }).incident;
      statusIds.push(inc.id);
      expect(Object.keys(inc).sort()).toEqual(
        ['body', 'id', 'resolvedAt', 'severity', 'startedAt', 'title'].sort(),
      );
      await st('POST', '/incidents', { title: `outro ${nonce}` }, key);
      const opened = await evs('status.opened', sql`and data->>'incidentId' = ${inc.id}`);
      expect(opened.map((r) => [r.tenant_id, r.anchor, r.severity, r.data])).toEqual([
        [
          null,
          `status:${inc.id}`,
          'warning',
          {
            incidentId: inc.id,
            title: `Pix atrasando ${nonce}`,
            severity: 'degraded',
            body: 'Os Pix estão demorando.',
          },
        ],
      ]);

      const updates = async () =>
        (await evs('status.updated', sql`and data->>'incidentId' = ${inc.id}`)).map((r) => r.data);
      expect((await st('PATCH', `/incidents/${inc.id}`, { severity: 'degraded' })).status).toBe(
        200,
      );
      expect(await updates()).toEqual([]);
      await st('PATCH', `/incidents/${inc.id}`, { severity: 'outage' });
      const done = await st('PATCH', `/incidents/${inc.id}`, { resolved: true });
      expect(
        ((await done.json()) as { incident: { resolvedAt: string } }).incident.resolvedAt,
      ).toBeTruthy();
      await st('PATCH', `/incidents/${inc.id}`, { resolved: true });
      await st('PATCH', `/incidents/${inc.id}`, { title: `Pix normalizado ${nonce}` });
      expect(
        (await st('PATCH', `/incidents/${crypto.randomUUID()}`, { resolved: true })).status,
      ).toBe(404);
      const title = `Pix atrasando ${nonce}`;
      expect(await updates()).toEqual([
        { incidentId: inc.id, title, severity: 'outage', resolved: false },
        { incidentId: inc.id, title, severity: 'outage', resolved: true },
        {
          incidentId: inc.id,
          title: `Pix normalizado ${nonce}`,
          severity: 'outage',
          resolved: false,
        },
      ]);
    });

    test('boots count the last hour; the version is the short commit', async () => {
      const before = (
        await sql<{ n: number }[]>`
        select count(*)::int as n from staff_events
        where kind = 'system.boot' and created_at > now() - interval '1 hour'
      `
      )[0]!.n;
      expect(await recordBoot(appSql, 'abc1234')).toBe(before + 1);
      expect(await recordBoot(appSql, null)).toBe(before + 2);
      expect(await recordBoot(appSql, 'abc1234')).toBe(before + 3);
      const rows = (await evs('system.boot')).slice(-3);
      expect(rows.map((r) => [r.tenant_id, r.data])).toEqual([
        [null, { bootsLastHour: before + 1, version: 'abc1234' }],
        [null, { bootsLastHour: before + 2, version: null }],
        [null, { bootsLastHour: before + 3, version: 'abc1234' }],
      ]);
      // three in an hour is a crash loop
      expect(rows[2]!.severity).toBe('warning');
      expect(bootVersion({ GIT_COMMIT: '0123456789abcdef0123456789abcdef01234567' })).toBe(
        '0123456',
      );
      expect(bootVersion({ GIT_COMMIT: '', SOURCE_COMMIT: 'v1.4.0' })).toBe('v1.4.0');
      expect(bootVersion({})).toBeNull();
    });

    test('unhandled errors reach the hook (never HttpErrors); the reporter throttles per route', async () => {
      const h = new Hono();
      h.onError((err, c) => errorJson(err, c));
      h.get('/boom/:id', () => {
        throw new Error(`kaput ${nonce}`);
      });
      h.get('/nope', () => {
        throw new HttpError(404, 'NOT_FOUND', 'not found');
      });
      const seen: { message: string; method: string; path: string }[] = [];
      try {
        onUnhandledError(
          (err, info) => void seen.push({ message: (err as Error).message, ...info }),
        );
        const res = await h.request('/boom/42');
        expect(res.status).toBe(500);
        expect(await res.json()).toEqual({
          error: { code: 'INTERNAL', message: 'internal error' },
        });
        expect((await h.request('/nope')).status).toBe(404);
        expect(seen).toEqual([{ message: `kaput ${nonce}`, method: 'GET', path: '/boom/42' }]);
        // a reporter that throws never changes the answer
        onUnhandledError(() => {
          throw new Error('reporter down');
        });
        expect((await h.request('/boom/43')).status).toBe(500);
        onUnhandledError(unhandledErrorReporter(appSql));
        await h.request(`/boom/${crypto.randomUUID()}`);
        await waitFor(
          async () =>
            (await evs('system.error', sql`and data->>'message' = ${`kaput ${nonce}`}`)).length ===
            1,
        );
      } finally {
        onUnhandledError(null);
      }
      const wired = (
        await evs('system.error', sql`and data->>'message' = ${`kaput ${nonce}`}`)
      )[0]!;
      expect(wired).toMatchObject({
        tenant_id: null,
        anchor: null,
        data: { method: 'GET', path: '/boom/:id', count: 1 },
      });

      expect(routeOf('/orders/123/pay')).toBe('/orders/:id/pay');
      expect(routeOf(`/control/v1/fleet/incidents/${crypto.randomUUID()}`)).toBe(
        '/control/v1/fleet/incidents/:id',
      );
      expect(routeOf(`/control/v1/fleet/releases/${rid()}`)).toBe('/control/v1/fleet/releases/:id');
      expect(routeOf('/products/bolo-de-cenoura')).toBe('/products/bolo-de-cenoura');

      let now = 1_000_000;
      const report = unhandledErrorReporter(appSql, { now: () => now, maxKeys: 2 });
      const msg = `throttled ${nonce}`;
      const at = () => ({ method: 'POST', path: `/control/v1/leads/${crypto.randomUUID()}/facts` });
      const coded = (code: string) => Object.assign(new Error(`${msg} ${code}`), { code });
      await report(new Error(msg), at());
      expect(report(new Error(msg), at())).toBeUndefined();
      // a message that echoes request input is still the same error on the same route
      expect(report(new Error(`${msg} input-1234`), at())).toBeUndefined();
      now += 10 * 60_000;
      await report(new Error(msg), at());
      await report(coded('23505'), at());
      // a third fingerprint evicts the oldest (bounded memory): it reports anew
      await report(coded('22P02'), at());
      await report(new Error(msg), at());
      await report(new TypeError(`${msg} ${'x'.repeat(300)}`), at());
      const rows = await evs('system.error', sql`and data->>'message' like ${`${msg}%`}`);
      expect(rows.map((r) => [r.data.message, r.data.count])).toEqual([
        [msg, 1],
        [msg, 3],
        [`${msg} 23505`, 1],
        [`${msg} 22P02`, 1],
        [msg, 1],
        [`${msg} ${'x'.repeat(300)}`.slice(0, 120), 1],
      ]);
      expect(new Set(rows.map((r) => `${r.data.method} ${r.data.path}`))).toEqual(
        new Set(['POST /control/v1/leads/:id/facts']),
      );
    });

    test('channel state is debounced on the log: one down until an up', async () => {
      await sql`delete from staff_events where anchor = 'channel:email'`;
      expect(await recordChannelState(appSql, 'email', 'up', 'voltou')).toBe(false);
      expect(await recordChannelState(appSql, 'email', 'down', 'resend 401')).toBe(true);
      expect(await recordChannelState(appSql, 'email', 'down', 'resend 401')).toBe(false);
      expect(await recordChannelState(appSql, 'email', 'up', null)).toBe(true);
      expect(await recordChannelState(appSql, 'email', 'up', null)).toBe(false);
      const rows = await sql<Ev[]>`
      select kind, severity, data from staff_events where anchor = 'channel:email' order by id
    `;
      expect(rows.map((r) => [r.kind, r.severity, r.data])).toEqual([
        ['channel.down', 'critical', { channel: 'email', detail: 'resend 401' }],
        ['channel.up', 'success', { channel: 'email', detail: null }],
      ]);
    });

    test('whatsapp: a logout or an outage that outlasts the grace is down; reconnecting is up', async () => {
      await sql`delete from staff_events where anchor = 'channel:whatsapp'`;
      await upsertIntegration(
        appSql,
        { kind: 'whatsapp', driver: 'baileys', enabled: true, config: { accountId: waAccount } },
        `wa:${nonce}`,
      );
      const integ = (await getIntegration(appSql, 'whatsapp'))!;
      const wa = async () =>
        (
          await sql<Ev[]>`
          select kind, data from staff_events where anchor = 'channel:whatsapp' order by id
        `
        ).map((r) => [r.kind, r.data.detail]);
      const open = (s: FakeSocket) => {
        // what a confirmed pairing leaves in the creds
        s.creds.registered = true;
        s.emit({ connection: 'open' });
      };
      const close = (s: FakeSocket, statusCode: number) =>
        s.emit({ connection: 'close', lastDisconnect: { error: { output: { statusCode } } } });
      const settle = () => Bun.sleep(300);

      const n = fakeSockets.length;
      await ensureSocket(appSql, integ);
      const s1 = fakeSockets[n]!;
      open(s1);
      await settle();
      expect(await wa()).toEqual([]);

      // whatsapp unlinked the device: down at once
      close(s1, 401);
      await waitFor(async () => (await wa()).length === 1);
      await ensureSocket(appSql, integ);
      open(fakeSockets[n + 1]!);
      await waitFor(async () => (await wa()).length === 2);

      // a blip: the socket reconnects by itself in 5 s; the outage clock (3 min) only fires if
      // it doesn't — run its check now, as the timer would
      close(fakeSockets[n + 1]!, 428);
      expect(await checkWhatsAppOutage(appSql, 428)).toBe(true);
      expect(await checkWhatsAppOutage(appSql, 428)).toBe(false);
      await waitFor(async () => fakeSockets.length === n + 3, 8_000);
      open(fakeSockets[n + 2]!);
      await waitFor(async () => (await wa()).length === 4);
      expect(await checkWhatsAppOutage(appSql)).toBe(false);

      // staff unpairing the number on purpose is not an outage
      await logoutWa(appSql, waAccount);
      await settle();
      expect(await wa()).toEqual([
        [
          'channel.down',
          'o whatsapp desvinculou o aparelho (logout) — pareie o número de novo em Config',
        ],
        ['channel.up', 'conectado como +5521999990000'],
        ['channel.down', 'a conexão caiu (código 428) e não voltou em 3 min'],
        ['channel.up', 'conectado como +5521999990000'],
      ]);
    }, 20_000);

    test('instagram: a killed session is down at once, other errors after the grace', async () => {
      await sql`delete from staff_events where anchor = 'channel:instagram'`;
      process.env.IG_SIDECAR_SECRET = IG_SECRET;
      await upsertIntegration(
        appSql,
        { kind: 'instagram', driver: 'sidecar', enabled: true },
        `ig:${nonce}`,
      );
      const post = async (body: unknown) => {
        const raw = JSON.stringify(body);
        const ts = String(Math.floor(Date.now() / 1000));
        const sig = createHmac('sha256', IG_SECRET).update(`${ts}.${raw}`).digest('hex');
        const res = await app.request('/control/v1/ig/events', {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'x-ig-timestamp': ts,
            'x-ig-signature': sig,
          },
          body: raw,
        });
        expect(res.status).toBe(200);
      };
      const ig = async () =>
        (
          await sql<Ev[]>`
          select kind, data from staff_events where anchor = 'channel:instagram' order by id
        `
        ).map((r) => [r.kind, r.data.detail]);
      const account = { username: 'vendua.teste' };

      // nothing was down yet: this open records nothing
      await post({ type: 'state', state: 'open', account });
      const killed = { code: 'logged_out', message: 'sessão encerrada pelo instagram' };
      await post({ type: 'state', state: 'error', error: killed });
      await post({ type: 'state', state: 'error', error: killed });
      await post({ type: 'state', state: 'open', account });
      await post({ type: 'state', state: 'open', account });
      await waitFor(async () => (await ig()).length >= 2);
      expect(await ig()).toEqual([
        ['channel.down', 'sessão encerrada pelo instagram'],
        ['channel.up', 'conectado como @vendua.teste'],
      ]);

      // a checkpoint may clear: down only once it outlasts the grace
      const check = { code: 'challenge_required', message: 'confirme no app do instagram' };
      await post({ type: 'state', state: 'error', error: check });
      try {
        setSystemTime(new Date(Date.now() + 4 * 60_000));
        await post({ type: 'state', state: 'error', error: check });
      } finally {
        setSystemTime();
      }
      await post({ type: 'state', state: 'off' });
      await post({ type: 'state', state: 'open', account });
      await waitFor(async () => (await ig()).length >= 4);
      await Bun.sleep(100);
      expect(await ig()).toEqual([
        ['channel.down', 'sessão encerrada pelo instagram'],
        ['channel.up', 'conectado como @vendua.teste'],
        ['channel.down', 'confirme no app do instagram'],
        ['channel.up', 'conectado como @vendua.teste'],
      ]);
    });
  },
);
