import type { Context, Hono } from 'hono';
import { TEMPLATE_MIGRATIONS } from '@vendua/templates';
import { withTenant, type Sql } from '../platform/db.ts';
import { HttpError, bodyJson, rateLimit } from '../platform/http.ts';
import type { Tenant } from '../platform/tenancy.ts';
import { claimControl } from './control.ts';
import {
  RINGS,
  assertPage,
  currentTemplatesTx,
  currentTokensTx,
  ingestEventsTx,
  latestBuildTx,
  opsTx,
  recordBuildTx,
  rollbackTemplateMigration,
  rollbackTemplateTx,
  runTemplateMigration,
  saveOpsTx,
  saveTemplateTx,
  saveTokensTx,
  subscribeNotifyTx,
  templateHistoryTx,
  type Ring,
} from './storefront-platform.ts';

type TenantApp = Hono<{ Variables: { tenant: Tenant } }>;

interface Deps {
  app: TenantApp;
  storefront: TenantApp;
  checkout: TenantApp;
  sql: Sql;
  controlGate: (c: Context) => void;
  requireIdemKey: (c: Context) => string;
  idempotency: (
    sql: Sql,
    run: (c: Context, tx: Sql) => Promise<{ status: number; body: unknown }>,
  ) => (c: Context) => Promise<Response>;
  trustProxy: boolean;
}

const TEMPLATE_BODY_MAX = 160 * 1024;

/** Storefront design/ops surface (roadmap Phase 1b). Public reads + beacon on the
 *  tenant sub-apps; staff edits under /control/v1/storefronts. */
export function mountStorefrontPlatform(d: Deps) {
  const { app, storefront, checkout, sql, controlGate, requireIdemKey } = d;

  // Build-time pull (`vendua` vite plugin): the store's live composition + tokens.
  storefront.get('/design', async (c) => {
    const tenant = c.get('tenant');
    const out = await withTenant(sql, tenant.id, async (tx) => ({
      templates: await currentTemplatesTx(tx, tenant.id),
      tokens: (await currentTokensTx(tx, tenant.id))?.tokens ?? null,
    }));
    c.header('cache-control', 'no-store');
    return c.json(out);
  });

  // sendBeacon can't set headers — the batch id in the body is the idempotency key
  storefront.use(
    '/events',
    rateLimit({ windowMs: 60_000, max: 120 }, { trustForwardedFor: d.trustProxy }),
  );
  storefront.post('/events', async (c) => {
    const tenant = c.get('tenant');
    const body = await bodyJson(c);
    const batchId = typeof body.batchId === 'string' ? body.batchId : '';
    if (!/^[A-Za-z0-9_-]{8,64}$/.test(batchId))
      throw new HttpError(400, 'BAD_REQUEST', 'batchId must be 8–64 url-safe chars');
    const accepted = await withTenant(sql, tenant.id, async (tx) => {
      const claimed = await tx`
        insert into idempotency_keys (tenant_id, key, response, status_code)
        values (${tenant.id}, ${`events:${batchId}`}, ${tx.json({})}, 202)
        on conflict (tenant_id, key) do nothing returning key
      `;
      if (!claimed[0]) return null;
      return ingestEventsTx(tx, tenant.id, body);
    });
    return c.json({ accepted: accepted ?? 0, replayed: accepted === null }, 202);
  });

  checkout.post(
    '/notify-me',
    d.idempotency(sql, async (c, tx) => {
      const tenant = c.get('tenant') as Tenant;
      return subscribeNotifyTx(tx, tenant.id, await bodyJson(c));
    }),
  );

  // ── staff ──────────────────────────────────────────────────────────────────

  const tenantBySlug = async (slug: string) => {
    if (!/^[a-z0-9][a-z0-9-]{0,39}$/.test(slug))
      throw new HttpError(404, 'TENANT_NOT_FOUND', 'no such storefront');
    const row = (
      await sql<{ id: string; slug: string }[]>`select id, slug from tenants where slug = ${slug}`
    )[0];
    if (!row) throw new HttpError(404, 'TENANT_NOT_FOUND', 'no such storefront');
    return row;
  };

  // durable claim + tenant RLS context in one transaction
  const claimTenant = <T>(
    c: Context,
    tenantId: string,
    work: (tx: Sql) => Promise<{ status: number; body: T }>,
  ) =>
    claimControl(sql, requireIdemKey(c), async (tx) => {
      await tx`select set_config('vendua.tenant_id', ${tenantId}, true)`;
      return work(tx);
    });

  const reply = <T>(c: Context, r: { status: number; body: T; replayed: boolean }) => {
    if (r.replayed) c.header('x-idempotent-replay', 'true');
    return c.json(r.body as object, r.status as 200);
  };

  app.get('/control/v1/storefronts', async (c) => {
    controlGate(c);
    const tenants = await sql<{ id: string; slug: string; name: string }[]>`
      select id, slug, name from tenants where status = 'active' order by slug
    `;
    const storefronts = [];
    for (const t of tenants) {
      storefronts.push(
        await withTenant(sql, t.id, async (tx) => {
          const [ops, build, templates] = await Promise.all([
            opsTx(tx, t.id),
            latestBuildTx(tx, t.id),
            currentTemplatesTx(tx, t.id),
          ]);
          return {
            slug: t.slug,
            name: t.name,
            ring: ops.ring,
            loader: ops.loader,
            kernel: build?.kernelVersion ?? null,
            builtAt: build?.recordedAt ?? null,
            pages: Object.keys(templates).sort(),
          };
        }),
      );
    }
    return c.json({ storefronts });
  });

  app.get('/control/v1/storefronts/:slug/templates', async (c) => {
    controlGate(c);
    const t = await tenantBySlug(c.req.param('slug'));
    const rows = await withTenant(
      sql,
      t.id,
      (tx) =>
        tx<{ page: string; version: number; template: unknown }[]>`
        select distinct on (page) page, version, template from storefront_templates
        where tenant_id = ${t.id} order by page, version desc
      `,
    );
    return c.json({ templates: rows });
  });

  app.get('/control/v1/storefronts/:slug/templates/:page/history', async (c) => {
    controlGate(c);
    const t = await tenantBySlug(c.req.param('slug'));
    const page = assertPage(c.req.param('page'));
    return c.json({
      history: await withTenant(sql, t.id, (tx) => templateHistoryTx(tx, t.id, page)),
    });
  });

  app.put('/control/v1/storefronts/:slug/templates/:page', async (c) => {
    controlGate(c);
    const t = await tenantBySlug(c.req.param('slug'));
    const page = assertPage(c.req.param('page'));
    const body = await bodyJson(c, TEMPLATE_BODY_MAX);
    const expectVersion = body.expectVersion;
    if (
      expectVersion !== undefined &&
      (typeof expectVersion !== 'number' || !Number.isInteger(expectVersion))
    )
      throw new HttpError(400, 'BAD_REQUEST', 'expectVersion must be an integer');
    const res = await claimTenant(c, t.id, async (tx) => ({
      status: 200,
      body: await saveTemplateTx(tx, t.id, page, body.template, 'staff', {
        trackRemovals: true,
        ...(expectVersion !== undefined ? { expectVersion: expectVersion as number } : {}),
      }),
    }));
    return reply(c, res);
  });

  app.post('/control/v1/storefronts/:slug/templates/:page/rollback', async (c) => {
    controlGate(c);
    const t = await tenantBySlug(c.req.param('slug'));
    const page = assertPage(c.req.param('page'));
    const body = await bodyJson(c);
    const to = body.toVersion;
    if (to !== undefined && (typeof to !== 'number' || !Number.isInteger(to) || to < 1))
      throw new HttpError(400, 'BAD_REQUEST', 'toVersion must be a positive integer');
    const res = await claimTenant(c, t.id, async (tx) => ({
      status: 200,
      body: await rollbackTemplateTx(tx, t.id, page, to as number | undefined),
    }));
    return reply(c, res);
  });

  app.get('/control/v1/storefronts/:slug/tokens', async (c) => {
    controlGate(c);
    const t = await tenantBySlug(c.req.param('slug'));
    return c.json({ tokens: await withTenant(sql, t.id, (tx) => currentTokensTx(tx, t.id)) });
  });

  app.put('/control/v1/storefronts/:slug/tokens', async (c) => {
    controlGate(c);
    const t = await tenantBySlug(c.req.param('slug'));
    const body = await bodyJson(c);
    const res = await claimTenant(c, t.id, async (tx) => ({
      status: 200,
      body: await saveTokensTx(tx, t.id, body.tokens, 'staff'),
    }));
    return reply(c, res);
  });

  app.get('/control/v1/storefronts/:slug/ops', async (c) => {
    controlGate(c);
    const t = await tenantBySlug(c.req.param('slug'));
    return c.json(await withTenant(sql, t.id, (tx) => opsTx(tx, t.id)));
  });

  app.patch('/control/v1/storefronts/:slug/ops', async (c) => {
    controlGate(c);
    const t = await tenantBySlug(c.req.param('slug'));
    const body = await bodyJson(c);
    if (body.demand !== undefined && body.demand !== 'normal' && body.demand !== 'high')
      throw new HttpError(400, 'BAD_REQUEST', "demand must be 'normal' or 'high'");
    const res = await claimTenant(c, t.id, async (tx) => {
      const ops = await saveOpsTx(tx, t.id, body);
      if (body.demand !== undefined)
        await tx`update store_settings set demand_level = ${body.demand as string} where tenant_id = ${t.id}`;
      const demand =
        (
          await tx<{ demand_level: string }[]>`
        select demand_level from store_settings where tenant_id = ${t.id}
      `
        )[0]?.demand_level ?? 'normal';
      return { status: 200, body: { ...ops, demand } };
    });
    return reply(c, res);
  });

  app.post('/control/v1/storefronts/:slug/builds', async (c) => {
    controlGate(c);
    const t = await tenantBySlug(c.req.param('slug'));
    const body = await bodyJson(c, 80 * 1024);
    const res = await claimTenant(c, t.id, async (tx) => {
      await recordBuildTx(tx, t.id, body.manifest);
      return { status: 201, body: { recorded: true } };
    });
    return reply(c, res);
  });

  app.get('/control/v1/template-migrations', (c) => {
    controlGate(c);
    return c.json({
      migrations: TEMPLATE_MIGRATIONS.map((m) => ({
        id: m.id,
        description: m.description,
        pages: m.pages,
        requiresKernel: m.requiresKernel ?? null,
      })),
    });
  });

  const migrationScope = (body: Record<string, unknown>) => {
    const ring = body.ring;
    if (ring !== undefined && !RINGS.includes(ring as Ring))
      throw new HttpError(400, 'BAD_REQUEST', `ring must be one of ${RINGS.join(', ')}`);
    const tenants = body.tenants;
    if (
      tenants !== undefined &&
      (!Array.isArray(tenants) ||
        tenants.length > 200 ||
        tenants.some((x) => typeof x !== 'string'))
    )
      throw new HttpError(400, 'BAD_REQUEST', 'tenants must be an array of slugs');
    return {
      ...(ring !== undefined ? { ring: ring as Ring } : {}),
      ...(tenants !== undefined ? { tenants: tenants as string[] } : {}),
    };
  };

  // Dry runs are reads with a body — no claim; real runs are claimed so a retry replays the report.
  app.post('/control/v1/template-migrations/:id/run', async (c) => {
    controlGate(c);
    const body = await bodyJson(c);
    const scope = migrationScope(body);
    const id = c.req.param('id');
    if (body.dry !== false) {
      return c.json({
        dry: true,
        report: await runTemplateMigration(sql, id, { dry: true, ...scope }),
      });
    }
    const res = await claimControl(sql, requireIdemKey(c), async () => ({
      status: 200,
      body: { dry: false, report: await runTemplateMigration(sql, id, { dry: false, ...scope }) },
    }));
    return reply(c, res);
  });

  app.post('/control/v1/template-migrations/:id/rollback', async (c) => {
    controlGate(c);
    const body = await bodyJson(c);
    const scope = migrationScope(body);
    const res = await claimControl(sql, requireIdemKey(c), async () => ({
      status: 200,
      body: { report: await rollbackTemplateMigration(sql, c.req.param('id'), scope) },
    }));
    return reply(c, res);
  });
}
