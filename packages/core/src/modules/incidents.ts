import type { Context, Hono } from 'hono';
import type { Sql } from '../platform/db.ts';
import type { Tenant } from '../platform/tenancy.ts';

// STUB (CORE-A replaces): /control/v1/incidents (staff post and resolve platform incidents).
export function mountIncidentsControl(_o: {
  app: Hono<{ Variables: { tenant: Tenant } }>;
  sql: Sql;
  controlGate: (c: Context) => void;
}) {}
