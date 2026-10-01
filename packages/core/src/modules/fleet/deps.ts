import type { MerchantNotify } from '../../admin/context.ts';
import type { Sql } from '../../platform/db.ts';
import { notifyStaff, type StaffNotice } from '../staff.ts';

// The Control Plane's collaborators, one object so tests swap the network and the clock.
export interface FleetDeps {
  sql: Sql;
  storeDomain: string;
  adminHost: string | null;
  /** off (dev, CI without an edge): a deployment is live as soon as the pointer flips */
  probes: boolean;
  /** probe through this origin with the store's Host header (e.g. http://edge:8080);
   *  null = the public https://<host>, which also covers DNS and TLS */
  probeOrigin: string | null;
  fetch: typeof fetch;
  /** the store owner's invite */
  notify: MerchantNotify;
  staff: (notice: StaffNotice) => Promise<unknown>;
  now: () => Date;
  /** tests: confine the probe loop to these stores (a shared database has others) */
  only: string[] | null;
}

export function fleetDeps(
  sql: Sql,
  o: Partial<Omit<FleetDeps, 'sql'>> & { notify: MerchantNotify },
): FleetDeps {
  const env = process.env;
  const probesEnv = env.VENDUA_PROBES;
  return {
    sql,
    storeDomain: o.storeDomain ?? env.VENDUA_STORE_DOMAIN ?? 'vendua.com.br',
    adminHost: o.adminHost ?? env.VENDUA_ADMIN_HOST?.trim().toLowerCase() ?? null,
    probes:
      o.probes ??
      (probesEnv === undefined || probesEnv === ''
        ? env.NODE_ENV === 'production'
        : probesEnv === '1'),
    probeOrigin: o.probeOrigin ?? (env.VENDUA_PROBE_ORIGIN?.replace(/\/+$/, '') || null),
    fetch: o.fetch ?? fetch,
    notify: o.notify,
    staff: o.staff ?? ((n) => notifyStaff(sql, 'fleet', n)),
    now: o.now ?? (() => new Date()),
    only: o.only ?? null,
  };
}

export const BUNDLE_RE = /^[a-z0-9_][a-z0-9_-]{0,39}(\/[a-z0-9_][a-z0-9_-]{0,39})?$/;
export const RELEASE_RE = /^[0-9a-f]{20}$/;
export const DEFAULT_BUNDLE = '_template';

const NO_TENANT = '00000000-0000-0000-0000-000000000000';

/** `and <col> in (…)` when the loop is confined (tests), nothing otherwise. */
export function scoped(tx: Sql, d: FleetDeps, col: string) {
  return d.only ? tx`and ${tx(col)} in ${tx(d.only.length ? d.only : [NO_TENANT])}` : tx``;
}

/** what staff events call a store */
export async function storeNameTx(tx: Sql, tenantId: string): Promise<string | null> {
  return (
    (await tx<{ name: string }[]>`select name from tenants where id = ${tenantId}`)[0]?.name ?? null
  );
}
