import { createHash, timingSafeEqual } from 'node:crypto';
import type { Context, Hono } from 'hono';
import type { Sql } from '../../platform/db.ts';
import { HttpError, uuidParam } from '../../platform/http.ts';
import type { Tenant } from '../../platform/tenancy.ts';
import { emitAdminTx } from '../../admin/live.ts';
import { claimControl, controlTx } from '../control.ts';

// The domains-sync sidecar's one read (ADR 0038): every host Traefik should route and get a
// certificate for. It answers 404 without its secret, like /edge/v1/resolve. And the CRM's
// "tentar de novo" for a registration that hit a conflict or failed.

function sameSecret(given: string | undefined, expected: string | undefined): boolean {
  if (!given || !expected) return false;
  const a = createHash('sha256').update(given).digest();
  const b = createHash('sha256').update(expected).digest();
  return timingSafeEqual(a, b);
}

const ROUTED = ['dns_ok', 'active', 'repairing', 'lapsed'] as const;

/** Hosts (and live aliases) that need a route and a certificate: sorted, unique, lower-case. */
export async function routedHosts(sql: Sql): Promise<string[]> {
  const rows = await controlTx(
    sql,
    (tx) => tx<{ host: string; alias_host: string | null; alias_ok: boolean }[]>`
      select host, alias_host, alias_ok from custom_domains where status in ${tx(ROUTED)}
    `,
  );
  const hosts = new Set<string>();
  for (const r of rows) {
    hosts.add(r.host.toLowerCase());
    if (r.alias_host && r.alias_ok) hosts.add(r.alias_host.toLowerCase());
  }
  return [...hosts].sort();
}

export function mountDomainRoutes(o: {
  app: Hono<{ Variables: { tenant: Tenant } }>;
  sql: Sql;
  controlGate: (c: Context) => void;
  /** shared with domains-sync (VENDUA_SYNC_SECRET); unset = the read answers 404 */
  syncSecret?: string | undefined;
}) {
  const { app, sql, controlGate } = o;
  const syncSecret = o.syncSecret ?? process.env.VENDUA_SYNC_SECRET;

  app.get('/sync/v1/custom-hosts', async (c) => {
    if (!sameSecret(c.req.header('x-vendua-sync'), syncSecret))
      throw new HttpError(404, 'NOT_FOUND', 'not found');
    c.header('cache-control', 'no-store');
    return c.json({ hosts: await routedHosts(sql), generatedAt: new Date().toISOString() });
  });

  app.post('/control/v1/domain-orders/:id/retry', async (c) => {
    controlGate(c);
    const id = uuidParam(c, 'id');
    const key = c.req.header('idempotency-key');
    if (!key)
      throw new HttpError(400, 'IDEMPOTENCY_KEY_REQUIRED', 'Idempotency-Key header is required');
    if (key.length > 200) throw new HttpError(400, 'BAD_REQUEST', 'Idempotency-Key too long');
    const res = await claimControl(sql, key, async (tx) => {
      const o = (
        await tx<{ tenant_id: string; status: string; claimed_until: Date | null }[]>`
          select tenant_id, status, claimed_until from domain_orders where id = ${id} for update
        `
      )[0];
      if (!o) throw new HttpError(404, 'NOT_FOUND', 'order not found');
      if (
        (o.status !== 'conflict' && o.status !== 'failed') ||
        (o.claimed_until && o.claimed_until > new Date())
      )
        throw new HttpError(409, 'ORDER_BUSY', 'only a conflict or a failed order is retried', {
          status: o.status,
        });
      await tx`
        update domain_orders set status = 'queued', next_attempt_at = null, attempts = 0,
          last_error = null, done_at = null, updated_at = now()
        where id = ${id}
      `;
      await emitAdminTx(tx, o.tenant_id, 'billing');
      return { status: 200, body: { ok: true } };
    });
    return c.json(res.body, res.status as 200);
  });
}
