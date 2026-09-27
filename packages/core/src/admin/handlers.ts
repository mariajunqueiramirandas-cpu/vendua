import type { Context } from 'hono';
import { withTenant, type Sql } from '../platform/db.ts';
import type { Tenant } from '../platform/tenancy.ts';
import { need, type AdminCtx, type AdminDeps, type Merchant, type Role } from './context.ts';

type Work<T> = (tx: Sql, tenant: Tenant, m: Merchant, c: Context) => Promise<T>;

/** read = role check + tenant tx; write = role check + idempotent claim in the tenant tx. */
export function handlers(d: AdminDeps) {
  const read =
    (role: Role, fn: Work<object>) =>
    async (c: AdminCtx): Promise<Response> => {
      const m = need(c, role);
      const t = c.get('tenant');
      const out = await withTenant(d.sql, t.id, (tx) => fn(tx, t, m, c));
      c.header('cache-control', 'no-store');
      return c.json(out);
    };
  const write =
    (role: Role, fn: Work<{ status: number; body: unknown }>) =>
    async (c: AdminCtx): Promise<Response> => {
      const m = need(c, role);
      const t = c.get('tenant');
      return d.idempotency(d.sql, (c2, tx) => fn(tx, t, m, c2))(c);
    };
  return { read, write };
}
