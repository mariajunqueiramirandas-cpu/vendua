import { createHash, timingSafeEqual } from 'node:crypto';
import type { Context, Hono } from 'hono';
import { text } from '../../admin/context.ts';
import type { Sql } from '../../platform/db.ts';
import { HttpError, UUID_RE, bodyJson, uuidParam } from '../../platform/http.ts';
import { slugFromStoreHost } from '../../platform/store-origin.ts';
import { validHost, type Tenant } from '../../platform/tenancy.ts';
import { validEmail } from '../billing/input.ts';
import { RESERVED_SLUGS, normalizeSlug, slugStatus } from '../billing/signup.ts';
import { claimControl, controlTx } from '../control.ts';
import { emitControlEvent } from '../control-events.ts';
import { validPhone } from '../customer.ts';
import { customRedirect } from '../domains/redirect.ts';
import { recordStaffEventTx } from '../staff-events.ts';
import { RINGS } from '../storefront-platform.ts';
import { BUNDLE_RE, DEFAULT_BUNDLE, RELEASE_RE, type FleetDeps } from './deps.ts';
import {
  adoptBundleTx,
  deploymentJson,
  lockOpsTx,
  promoteTx,
  reconcileBundleTx,
  reconcileTx,
  rollbackTx,
} from './deploy.ts';
import { ackIncident, incidentJson, type IncidentRow } from './incidents.ts';
import { probeStoreNow } from './probe.ts';
import {
  advance,
  createInviteTx,
  provisioningJson,
  retryTx,
  type ProvisioningRow,
} from './provision.ts';
import {
  latestPassedTx,
  parseRelease,
  registerReleaseTx,
  releaseJson,
  type ReleaseRow,
} from './releases.ts';
import { fleetStatusTx, listStorefrontsTx, storefrontDetailTx } from './view.ts';

// /control/v1/fleet — the Control Plane's API (docs/architecture/08): releases, the pointer
// flips, probes, incidents and the provisioner. CLI-first: `vendua fleet` and `vendua release`
// call the same routes the CRM does. /edge/v1/resolve is the edge's one read (its own secret).

const SLUG_RE = /^[a-z0-9][a-z0-9-]{0,59}$/;
const MANIFEST_MAX_BYTES = 512 * 1024;

function idemKey(c: Context, scope: string) {
  const key = c.req.header('idempotency-key');
  if (!key)
    throw new HttpError(400, 'IDEMPOTENCY_KEY_REQUIRED', 'Idempotency-Key header is required');
  if (key.length > 200) throw new HttpError(400, 'BAD_REQUEST', 'Idempotency-Key too long');
  return `fleet:${scope}:${key}`;
}

const optReason = (v: unknown) =>
  v === undefined || v === null || v === '' ? null : text(v, 'reason', 300, 1);

/** the :slug param, 404 before it reaches a key or a query when it can't be a store */
function slugParam(c: Context): string {
  const slug = c.req.param('slug') ?? '';
  if (!SLUG_RE.test(slug)) throw new HttpError(404, 'STORE_NOT_FOUND', 'store not found');
  return slug;
}

async function tenantBySlug(tx: Sql, slug: string): Promise<Tenant> {
  const t = SLUG_RE.test(slug)
    ? (await tx<Tenant[]>`select id, slug, name, status from tenants where slug = ${slug}`)[0]
    : undefined;
  if (!t) throw new HttpError(404, 'STORE_NOT_FOUND', 'store not found');
  return t;
}

function sameSecret(given: string | undefined, expected: string | undefined): boolean {
  if (!given || !expected) return false;
  const a = createHash('sha256').update(given).digest();
  const b = createHash('sha256').update(expected).digest();
  return timingSafeEqual(a, b);
}

export function mountFleet(o: {
  app: Hono<{ Variables: { tenant: Tenant } }>;
  sql: Sql;
  controlGate: (c: Context) => void;
  deps: FleetDeps;
  /** shared with the edge (VENDUA_EDGE_SECRET); unset = /edge/v1 answers 404 */
  edgeSecret?: string | undefined;
}) {
  const { app, sql, controlGate, deps: d } = o;
  const edgeSecret = o.edgeSecret ?? process.env.VENDUA_EDGE_SECRET;

  const reply = <T>(c: Context, res: { status: number; body: T; replayed: boolean }) => {
    if (res.replayed) c.header('x-idempotent-replay', 'true');
    return c.json(res.body as object, res.status as 200);
  };

  // ── edge ──────────────────────────────────────────────────────────────────

  app.get('/edge/v1/resolve', async (c) => {
    if (!sameSecret(c.req.header('x-vendua-edge'), edgeSecret))
      throw new HttpError(404, 'NOT_FOUND', 'not found');
    c.header('cache-control', 'no-store');
    const host = (c.req.query('host') ?? '').trim().toLowerCase();
    if (!validHost(host) || host === d.adminHost)
      throw new HttpError(404, 'UNKNOWN_HOST', 'no store at this host');
    const out = await controlTx(sql, async (tx) => {
      const hostname = host.split(':')[0]!;
      let tenant = (
        await tx<Tenant[]>`
          select t.id, t.slug, t.name, t.status from domains dm join tenants t on t.id = dm.tenant_id
          where dm.host in (${host}, ${hostname}) order by (dm.host = ${host}) desc limit 1
        `
      )[0];
      if (!tenant) {
        const slug = slugFromStoreHost(hostname, d.storeDomain);
        if (slug && !RESERVED_SLUGS.has(slug))
          tenant = (
            await tx<Tenant[]>`select id, slug, name, status from tenants where slug = ${slug}`
          )[0];
      }
      if (!tenant) {
        // an alias of a live domain, or a lapsed one: the edge redirects (ADR 0038)
        const r = await customRedirect(tx, hostname, d.storeDomain);
        return r ? { host, tenant: r.tenant, primaryHost: host, release: null, redirect: r.redirect } : null;
      }
      const ops = (
        await tx<{ bundle: string; live_release_id: string | null }[]>`
          select bundle, live_release_id from storefront_ops where tenant_id = ${tenant.id}
        `
      )[0];
      const primaryHost =
        (
          await tx<{ host: string }[]>`
            select host from domains where tenant_id = ${tenant.id}
            order by is_primary desc, length(host), host limit 1
          `
        )[0]?.host ?? null;
      let release: ReleaseRow | null = null;
      let fallback = false;
      if (ops?.live_release_id)
        release =
          (await tx<ReleaseRow[]>`select * from releases where id = ${ops.live_release_id}`)[0] ??
          null;
      if (!release) {
        // not promoted yet (a store minutes old): its bundle's newest build, else the template's
        fallback = true;
        release =
          (await latestPassedTx(tx, ops?.bundle ?? DEFAULT_BUNDLE)) ??
          (await latestPassedTx(tx, DEFAULT_BUNDLE));
      }
      return {
        host,
        tenant: { id: tenant.id, slug: tenant.slug, status: tenant.status },
        primaryHost,
        release: release
          ? { id: release.id, bundle: release.bundle, uri: release.artifact_uri, fallback }
          : null,
        redirect: null,
      };
    });
    if (!out) throw new HttpError(404, 'UNKNOWN_HOST', 'no store at this host');
    return c.json(out);
  });

  // ── releases ──────────────────────────────────────────────────────────────

  app.post('/control/v1/fleet/releases', async (c) => {
    controlGate(c);
    const key = idemKey(c, 'release');
    const parsed = parseRelease(await bodyJson(c, MANIFEST_MAX_BYTES));
    const res = await claimControl(sql, key, async (tx) => {
      const { row, created } = await registerReleaseTx(tx, parsed);
      await adoptBundleTx(tx, row);
      const promoted = row.qa_status === 'passed' ? await reconcileBundleTx(tx, d, row.bundle) : [];
      if (created)
        await recordStaffEventTx(
          tx,
          'release.published',
          {
            releaseId: row.id,
            bundle: row.bundle,
            kernel: row.kernel_version,
            promoted: promoted.length,
          },
          { dedupeKey: `release:${row.id}` },
        );
      const slugs = promoted.length
        ? await tx<{ id: string; slug: string }[]>`
            select id, slug from tenants where id in ${tx(promoted.map((p) => p.tenantId))}
          `
        : [];
      return {
        status: created ? 201 : 200,
        body: {
          release: releaseJson(row),
          created,
          promoted: promoted.map((p) => ({
            tenant: slugs.find((s) => s.id === p.tenantId)?.slug ?? p.tenantId,
            deploymentId: p.deployment.id,
            status: p.deployment.status,
          })),
        },
      };
    });
    if (!res.replayed) emitControlEvent('fleet.change');
    return reply(c, res);
  });

  app.get('/control/v1/fleet/releases', async (c) => {
    controlGate(c);
    const bundle = c.req.query('bundle');
    if (bundle !== undefined && !BUNDLE_RE.test(bundle))
      throw new HttpError(422, 'BAD_REQUEST', 'bad bundle', { field: 'bundle' });
    const limit = Math.min(Math.max(Number(c.req.query('limit')) || 50, 1), 200);
    const rows = await controlTx(
      sql,
      (tx) => tx<ReleaseRow[]>`
        select * from releases ${bundle ? tx`where bundle = ${bundle}` : tx``}
        order by published_at desc, created_at desc limit ${limit}
      `,
    );
    c.header('cache-control', 'no-store');
    return c.json({ releases: rows.map(releaseJson) });
  });

  // ── fleet + storefronts ───────────────────────────────────────────────────

  app.get('/control/v1/fleet/status', async (c) => {
    controlGate(c);
    c.header('cache-control', 'no-store');
    return c.json(await controlTx(sql, (tx) => fleetStatusTx(tx, d.probes)));
  });

  app.get('/control/v1/fleet/storefronts', async (c) => {
    controlGate(c);
    c.header('cache-control', 'no-store');
    return c.json({ storefronts: await controlTx(sql, (tx) => listStorefrontsTx(tx)) });
  });

  app.get('/control/v1/fleet/storefronts/:slug', async (c) => {
    controlGate(c);
    const detail = await controlTx(sql, async (tx) => {
      const t = await tenantBySlug(tx, slugParam(c));
      return storefrontDetailTx(tx, t.id);
    });
    c.header('cache-control', 'no-store');
    return c.json({ storefront: detail });
  });

  app.patch('/control/v1/fleet/storefronts/:slug', async (c) => {
    controlGate(c);
    const slug = slugParam(c);
    const key = idemKey(c, `patch:${slug}`);
    const body = await bodyJson(c);
    const policy = body.policy;
    if (policy !== undefined && policy !== 'auto' && policy !== 'pinned')
      throw new HttpError(422, 'BAD_REQUEST', "policy must be 'auto' or 'pinned'", {
        field: 'policy',
      });
    const bundle = body.bundle;
    if (bundle !== undefined && (typeof bundle !== 'string' || !BUNDLE_RE.test(bundle)))
      throw new HttpError(422, 'BAD_REQUEST', 'bad bundle', { field: 'bundle' });
    const ring = body.ring;
    if (ring !== undefined && !(RINGS as readonly unknown[]).includes(ring))
      throw new HttpError(422, 'BAD_REQUEST', `ring must be one of ${RINGS.join(', ')}`, {
        field: 'ring',
      });
    const reason = optReason(body.reason);
    if (policy === undefined && bundle === undefined && ring === undefined)
      throw new HttpError(422, 'BAD_REQUEST', 'nothing to change');
    const res = await claimControl(sql, key, async (tx) => {
      const t = await tenantBySlug(tx, slug);
      const ops = await lockOpsTx(tx, t.id);
      if (bundle !== undefined && bundle !== ops.bundle) {
        if (!(await latestPassedTx(tx, bundle)))
          throw new HttpError(409, 'BUNDLE_HAS_NO_RELEASE', `no passed release of ${bundle} yet`);
        await tx`
          update storefront_ops set bundle = ${bundle}, bundle_locked = true,
            release_policy = 'auto', pinned_reason = null, updated_at = now()
          where tenant_id = ${t.id}
        `;
      }
      if (ring !== undefined)
        await tx`update storefront_ops set ring = ${ring as string}, updated_at = now()
                 where tenant_id = ${t.id}`;
      if (policy !== undefined)
        await tx`
          update storefront_ops set release_policy = ${policy},
            pinned_reason = ${policy === 'pinned' ? (reason ?? 'fixada pela equipe') : null},
            updated_at = now()
          where tenant_id = ${t.id}
        `;
      const dep = await reconcileTx(tx, d, t.id, { actor: 'equipe' });
      const action =
        policy === 'pinned' && ops.release_policy !== 'pinned'
          ? 'pin'
          : policy === 'auto' && ops.release_policy === 'pinned'
            ? 'unpin'
            : dep && bundle !== undefined && bundle !== ops.bundle
              ? 'promote'
              : null;
      if (action)
        await recordStaffEventTx(
          tx,
          'deployment.manual',
          {
            action,
            storeName: t.name,
            releaseId: dep?.release_id ?? ops.live_release_id,
            by: 'equipe',
          },
          { tenantId: t.id },
        );
      return {
        status: 200,
        body: {
          storefront: await storefrontDetailTx(tx, t.id),
          deployment: dep ? deploymentJson(dep) : null,
        },
      };
    });
    if (!res.replayed) emitControlEvent('fleet.change');
    return reply(c, res);
  });

  app.post('/control/v1/fleet/storefronts/:slug/promote', async (c) => {
    controlGate(c);
    const slug = slugParam(c);
    const key = idemKey(c, `promote:${slug}`);
    const body = await bodyJson(c);
    const release = body.release;
    if (typeof release !== 'string' || !RELEASE_RE.test(release))
      throw new HttpError(422, 'BAD_REQUEST', 'release must be 20 hex chars', { field: 'release' });
    const reason = optReason(body.reason);
    const res = await claimControl(sql, key, async (tx) => {
      const t = await tenantBySlug(tx, slug);
      const ops = await lockOpsTx(tx, t.id);
      const latest = await latestPassedTx(tx, ops.bundle);
      // promoting the newest keeps the store following its bundle; anything else pins it there
      const follows = latest?.id === release;
      const dep = await promoteTx(tx, d, t.id, release, {
        kind: 'promote',
        actor: 'equipe',
        reason,
        policy: follows ? 'auto' : 'pinned',
        pinnedReason: follows ? null : (reason ?? `fixada na versão ${release.slice(0, 7)}`),
        force: body.force === true,
      });
      return {
        status: dep ? 201 : 200,
        body: { deployment: dep ? deploymentJson(dep) : null, policy: follows ? 'auto' : 'pinned' },
      };
    });
    if (!res.replayed) emitControlEvent('fleet.change');
    return reply(c, res);
  });

  app.post('/control/v1/fleet/storefronts/:slug/rollback', async (c) => {
    controlGate(c);
    const slug = slugParam(c);
    const key = idemKey(c, `rollback:${slug}`);
    const body = await bodyJson(c);
    const reason = optReason(body.reason);
    const res = await claimControl(sql, key, async (tx) => {
      const t = await tenantBySlug(tx, slug);
      const dep = await rollbackTx(tx, d, t.id, { actor: 'equipe', reason });
      return { status: 201, body: { deployment: deploymentJson(dep) } };
    });
    if (!res.replayed) emitControlEvent('fleet.change');
    return reply(c, res);
  });

  app.post('/control/v1/fleet/storefronts/:slug/probe', async (c) => {
    controlGate(c);
    const slug = slugParam(c);
    const key = idemKey(c, `probe:${slug}`);
    const t = await controlTx(sql, (tx) => tenantBySlug(tx, slug));
    const res = await claimControl(sql, key, async () => ({
      status: 200,
      body: { results: await probeStoreNow(d, t.id) },
    }));
    return reply(c, res);
  });

  // ── provisioning ──────────────────────────────────────────────────────────

  const provisioningList = (tx: Sql, where: ReturnType<Sql>) => tx<
    (ProvisioningRow & {
      slug: string;
      name: string;
      lead_name: string | null;
      host: string | null;
    })[]
  >`
    select p.*, t.slug, t.name, l.name as lead_name,
      (select host from domains dm where dm.tenant_id = p.tenant_id
        order by is_primary desc, length(host), host limit 1) as host
    from provisionings p
      join tenants t on t.id = p.tenant_id
      left join leads l on l.id = p.lead_id
    ${where}
  `;

  app.get('/control/v1/fleet/provisionings', async (c) => {
    controlGate(c);
    const leadId = c.req.query('leadId');
    if (leadId !== undefined && !UUID_RE.test(leadId))
      throw new HttpError(400, 'BAD_REQUEST', 'leadId must be a uuid');
    const rows = await controlTx(sql, (tx) =>
      provisioningList(
        tx,
        leadId
          ? tx`where p.lead_id = ${leadId} order by p.created_at desc`
          : tx`where p.state <> 'live' or p.live_at > now() - interval '7 days'
               order by p.created_at desc limit 200`,
      ),
    );
    c.header('cache-control', 'no-store');
    return c.json({ provisionings: rows.map(provisioningJson) });
  });

  app.get('/control/v1/fleet/slug', async (c) => {
    controlGate(c);
    c.header('cache-control', 'no-store');
    return c.json(await slugStatus(sql, c.req.query('slug') ?? '', d.storeDomain));
  });

  app.post('/control/v1/fleet/provisionings', async (c) => {
    controlGate(c);
    const key = idemKey(c, 'provision');
    const body = await bodyJson(c);
    const slug = normalizeSlug(body.slug);
    if (!/^[a-z0-9]([a-z0-9-]{1,38}[a-z0-9])$/.test(slug))
      throw new HttpError(422, 'INVALID_SLUG', 'the address needs 3–40 letters, numbers or -', {
        field: 'slug',
        reason: 'invalid',
      });
    if (RESERVED_SLUGS.has(slug))
      throw new HttpError(422, 'INVALID_SLUG', 'this address is reserved', {
        field: 'slug',
        reason: 'reserved',
      });
    const ownerPhone = validPhone(body.ownerPhone);
    if (!ownerPhone)
      throw new HttpError(422, 'BAD_REQUEST', 'ownerPhone must be a BR phone with DDD', {
        field: 'ownerPhone',
      });
    const leadId = body.leadId === undefined || body.leadId === null ? null : body.leadId;
    if (leadId !== null && (typeof leadId !== 'string' || !UUID_RE.test(leadId)))
      throw new HttpError(422, 'BAD_REQUEST', 'leadId must be a uuid', { field: 'leadId' });
    if (typeof body.planId !== 'string' || !/^[a-z0-9_]{2,30}$/.test(body.planId))
      throw new HttpError(422, 'BAD_REQUEST', 'unknown plan', { field: 'planId' });
    const input = {
      slug,
      storeName: text(body.storeName, 'storeName', 60, 2),
      planId: body.planId,
      ownerName: text(body.ownerName, 'ownerName', 80, 2),
      ownerPhone,
      ownerEmail: validEmail(body.ownerEmail, 'ownerEmail'),
      leadId,
    };
    const res = await claimControl(sql, key, async (tx) => {
      const p = await createInviteTx(tx, d, input, 'equipe');
      return {
        status: 201,
        body: { provisioning: provisioningJson({ ...p, slug, name: input.storeName }) },
      };
    });
    if (!res.replayed) {
      emitControlEvent('fleet.change');
      if (leadId) emitControlEvent('lead.change', leadId);
      const id = (res.body as { provisioning: { id: string } }).provisioning.id;
      void advance(d, id).catch(() => undefined);
    }
    return reply(c, res);
  });

  app.post('/control/v1/fleet/provisionings/:id/retry', async (c) => {
    controlGate(c);
    const id = uuidParam(c, 'id');
    const key = idemKey(c, `retry:${id}`);
    const res = await claimControl(sql, key, async (tx) => ({
      status: 200,
      body: { provisioning: provisioningJson(await retryTx(tx, id)) },
    }));
    if (!res.replayed) void advance(d, id).catch(() => undefined);
    return reply(c, res);
  });

  // ── incidents ─────────────────────────────────────────────────────────────

  app.get('/control/v1/fleet/incidents', async (c) => {
    controlGate(c);
    const all = c.req.query('all') === '1';
    const rows = await controlTx(
      sql,
      (tx) => tx<(IncidentRow & { tenant_slug: string | null })[]>`
        select i.*, t.slug as tenant_slug from fleet_incidents i
          left join tenants t on t.id = i.tenant_id
        ${all ? tx`` : tx`where i.resolved_at is null`}
        order by (i.resolved_at is null) desc, (i.severity = 'critical') desc, i.opened_at desc
        limit 200
      `,
    );
    c.header('cache-control', 'no-store');
    return c.json({ incidents: rows.map(incidentJson) });
  });

  app.patch('/control/v1/fleet/incidents/:id', async (c) => {
    controlGate(c);
    const id = uuidParam(c, 'id');
    const key = idemKey(c, `incident:${id}`);
    const body = await bodyJson(c);
    const op = {
      ...(body.ack === true ? { ack: true as const } : {}),
      ...(body.resolved === true ? { resolved: true as const } : {}),
    };
    return reply(c, await ackIncident(sql, id, op, 'equipe', key));
  });
}
