import type { Context, Hono } from 'hono';
import type { Sql } from '../platform/db.ts';
import type { Tenant } from '../platform/tenancy.ts';
import type { PaymentProvider } from './payments/provider.ts';

// STUB (CORE-BILL replaces): /control/v1 billing, plans, custom domains, site requests.
export function mountControlBilling(_o: {
  app: Hono<{ Variables: { tenant: Tenant } }>;
  sql: Sql;
  controlGate: (c: Context) => void;
  provider: PaymentProvider;
}) {}
