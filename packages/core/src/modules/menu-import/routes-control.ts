// The CRM's menu import (docs/menu-import.md §2): staff import a lead's old menu into the store
// "criar loja" provisioned, so the owner's invite lands on a store that already sells. Same
// module as /admin/v1/imports; staff never see the Pix key or touch Pagamentos (the owner's).

import type { Context, Hono } from 'hono';
import type { Sql } from '../../platform/db.ts';
import { HttpError, bodyJson, uuidParam } from '../../platform/http.ts';
import type { Tenant } from '../../platform/tenancy.ts';
import { claimControl, controlTx } from '../control.ts';
import {
  applyImportTx,
  discardImportTx,
  importView,
  listImportsTx,
  loadImport,
  parseApply,
  startImportTx,
} from './routes.ts';

const STAFF = { userId: null, name: 'equipe Venduá' };
const SLUG_RE = /^[a-z0-9][a-z0-9-]{0,59}$/;

function idemKey(c: Context, scope: string) {
  const key = c.req.header('idempotency-key');
  if (!key)
    throw new HttpError(400, 'IDEMPOTENCY_KEY_REQUIRED', 'Idempotency-Key header is required');
  if (key.length > 200) throw new HttpError(400, 'BAD_REQUEST', 'Idempotency-Key too long');
  return `menu-import:${scope}:${key}`;
}

/** Inside a control tx: the store, and the tenant GUC its tables' RLS keys on. */
async function asStore(tx: Sql, slug: string): Promise<string> {
  const t = SLUG_RE.test(slug)
    ? (await tx<{ id: string }[]>`select id from tenants where slug = ${slug}`)[0]
    : undefined;
  if (!t) throw new HttpError(404, 'STORE_NOT_FOUND', 'store not found');
  await tx`select set_config('vendua.tenant_id', ${t.id}, true)`;
  return t.id;
}

async function asImport(tx: Sql, id: string): Promise<string> {
  const row = (
    await tx<{ tenant_id: string }[]>`select tenant_id from menu_imports where id = ${id}`
  )[0];
  if (!row) throw new HttpError(404, 'IMPORT_NOT_FOUND', 'import not found');
  await tx`select set_config('vendua.tenant_id', ${row.tenant_id}, true)`;
  return row.tenant_id;
}

export function mountImportsControl(o: {
  app: Hono<{ Variables: { tenant: Tenant } }>;
  sql: Sql;
  controlGate: (c: Context) => void;
}) {
  const { app, sql, controlGate } = o;
  const reply = <T>(c: Context, r: { status: number; body: T; replayed: boolean }) => {
    if (r.replayed) c.header('x-idempotent-replay', 'true');
    return c.json(r.body as object, r.status as 200);
  };

  app.get('/control/v1/stores/:slug/imports', async (c) => {
    controlGate(c);
    const slug = c.req.param('slug');
    const imports = await controlTx(sql, async (tx) =>
      listImportsTx(tx, await asStore(tx, slug), false),
    );
    c.header('cache-control', 'no-store');
    return c.json({ imports });
  });

  app.post('/control/v1/stores/:slug/imports', async (c) => {
    controlGate(c);
    const slug = c.req.param('slug');
    const key = idemKey(c, `start:${slug}`);
    const body = await bodyJson(c, 4 * 1024);
    const res = await claimControl(sql, key, async (tx) => ({
      status: 202,
      body: await startImportTx(tx, await asStore(tx, slug), null, body),
    }));
    return reply(c, res);
  });

  app.get('/control/v1/imports/:id', async (c) => {
    controlGate(c);
    const id = uuidParam(c, 'id');
    const view = await controlTx(sql, async (tx) => {
      const tenantId = await asImport(tx, id);
      return importView(tx, tenantId, await loadImport(tx, tenantId, id), false);
    });
    c.header('cache-control', 'no-store');
    return c.json(view);
  });

  app.post('/control/v1/imports/:id/apply', async (c) => {
    controlGate(c);
    const id = uuidParam(c, 'id');
    const key = idemKey(c, `apply:${id}`);
    const opts = parseApply(await bodyJson(c, 4 * 1024), false);
    const res = await claimControl(sql, key, async (tx) => ({
      status: 200,
      body: await applyImportTx(tx, await asImport(tx, id), STAFF, id, opts, false),
    }));
    return reply(c, res);
  });

  app.post('/control/v1/imports/:id/discard', async (c) => {
    controlGate(c);
    const id = uuidParam(c, 'id');
    const key = idemKey(c, `discard:${id}`);
    const res = await claimControl(sql, key, async (tx) => ({
      status: 200,
      body: await discardImportTx(tx, await asImport(tx, id), id, false),
    }));
    return reply(c, res);
  });
}
