import { createHash, randomBytes, randomInt } from 'node:crypto';
import { withTenant, type Sql } from '../../platform/db.ts';
import { HttpError, UUID_RE, constantTimeEqual } from '../../platform/http.ts';
import type { Tenant } from '../../platform/tenancy.ts';
import { ONLINE_WINDOW_S, printersTx, type PrinterView } from './jobs.ts';

export type AgentPlatform = 'windows' | 'android' | 'linux';
export const AGENT_PLATFORMS: readonly AgentPlatform[] = ['windows', 'android', 'linux'];

const PAIRING_TTL_S = 600;
/** an approved code can still be collected a little after it stopped being approvable */
const COLLECT_GRACE_S = 300;
// no 0/O, 1/I/L: read aloud or typed off a tablet
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const SECRET_RE = /^[A-Za-z0-9_-]{43}$/;
export const VERSION_RE = /^[0-9A-Za-z.+-]{1,30}$/;

const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');

/** `K7QD-4MXA` → `K7QD4MXA`; null when it can't be a code */
export function normalizeUserCode(v: unknown): string | null {
  if (typeof v !== 'string' || v.length > 20) return null;
  const c = v.toUpperCase().replace(/[^A-Z0-9]/g, '');
  return /^[A-Z0-9]{8}$/.test(c) ? c : null;
}

export const formatUserCode = (c: string) => `${c.slice(0, 4)}-${c.slice(4)}`;

/** pre-tenant pairing rows live behind their own GUC (migration 0077) */
async function pairingAccess(tx: Sql) {
  await tx`select set_config('vendua.print_pairing', '1', true)`;
}

function pairingTx<T>(sql: Sql, work: (tx: Sql) => Promise<T>): Promise<T> {
  return sql.begin(async (t) => {
    const tx = t as unknown as Sql;
    await pairingAccess(tx);
    return work(tx);
  }) as Promise<T>;
}

export async function startPairing(
  sql: Sql,
  agent: { platform: AgentPlatform; name: string; version: string | null },
) {
  const deviceCode = randomBytes(32).toString('base64url');
  return pairingTx(sql, async (tx) => {
    await tx`delete from print_pairings where expires_at < now() - interval '1 day'`;
    for (let i = 0; ; i++) {
      const userCode = Array.from(
        { length: 8 },
        () => CODE_ALPHABET[randomInt(CODE_ALPHABET.length)],
      ).join('');
      const rows = await tx`
        insert into print_pairings (device_code_hash, user_code, platform, device_name,
                                    agent_version, expires_at)
        values (${sha256(deviceCode)}, ${userCode}, ${agent.platform}, ${agent.name},
                ${agent.version}, now() + make_interval(secs => ${PAIRING_TTL_S}))
        on conflict (user_code) do nothing
        returning id`;
      if (rows.length > 0) return { deviceCode, userCode, expiresIn: PAIRING_TTL_S };
      if (i >= 4) throw new HttpError(503, 'TRY_AGAIN', 'could not allocate a code — retry');
    }
  });
}

export type PollResult =
  { status: 'pending' } | { status: 'approved'; token: string; store: { name: string } };

/** Each approved poll rotates the secret: the last answer the agent saw is the one that works. */
export async function pollPairing(sql: Sql, deviceCode: string): Promise<PollResult> {
  if (!/^[A-Za-z0-9_-]{43}$/.test(deviceCode))
    throw new HttpError(404, 'PAIRING_NOT_FOUND', 'pairing not found');
  return pairingTx(sql, async (tx) => {
    const [row] = await tx<
      {
        tenant_id: string | null;
        device_id: string | null;
        expired: boolean;
        collectable: boolean;
      }[]
    >`
      select tenant_id, device_id, expires_at < now() as expired,
             expires_at + make_interval(secs => ${COLLECT_GRACE_S}) > now() as collectable
      from print_pairings where device_code_hash = ${sha256(deviceCode)}`;
    if (!row) throw new HttpError(404, 'PAIRING_NOT_FOUND', 'pairing not found');
    if (!row.tenant_id || !row.device_id) {
      if (row.expired) throw new HttpError(410, 'PAIRING_EXPIRED', 'pairing code expired');
      return { status: 'pending' };
    }
    if (!row.collectable) throw new HttpError(410, 'PAIRING_EXPIRED', 'pairing code expired');
    await tx`select set_config('vendua.tenant_id', ${row.tenant_id}, true)`;
    const secret = randomBytes(32).toString('base64url');
    const [dev] = await tx<{ name: string }[]>`
      update print_devices d set token_hash = ${sha256(secret)}
      from tenants t
      where d.tenant_id = ${row.tenant_id} and d.id = ${row.device_id} and t.id = d.tenant_id
      returning t.name`;
    // the merchant removed the device between approving and the agent asking
    if (!dev) throw new HttpError(410, 'PAIRING_EXPIRED', 'pairing code expired');
    return {
      status: 'approved',
      token: `${row.tenant_id}.${row.device_id}.${secret}`,
      store: { name: dev.name },
    };
  });
}

export interface PairingView {
  code: string;
  platform: AgentPlatform;
  name: string;
  status: 'pending' | 'approved' | 'expired' | 'taken';
  expiresAt: string;
  deviceId: string | null;
}

/** What the merchant is about to approve. Inside the tenant tx; reads only this one code. */
export async function pairingByCodeTx(
  tx: Sql,
  tenantId: string,
  code: string,
): Promise<PairingView> {
  await pairingAccess(tx);
  const [row] = await tx<
    {
      user_code: string;
      platform: AgentPlatform;
      device_name: string;
      tenant_id: string | null;
      device_id: string | null;
      expired: boolean;
      expires_at: string;
    }[]
  >`
    select user_code, platform, device_name, tenant_id, device_id, expires_at < now() as expired,
           expires_at
    from print_pairings where user_code = ${code}`;
  if (!row) throw new HttpError(404, 'PAIRING_NOT_FOUND', 'pairing not found');
  const status = row.tenant_id
    ? row.tenant_id === tenantId
      ? 'approved'
      : 'taken'
    : row.expired
      ? 'expired'
      : 'pending';
  return {
    code: formatUserCode(row.user_code),
    platform: row.platform,
    name: row.device_name,
    status,
    expiresAt: row.expires_at,
    deviceId: status === 'approved' ? row.device_id : null,
  };
}

/** Bind the code to this store and create the device; approving twice returns the same one. */
export async function approvePairingTx(
  tx: Sql,
  tenantId: string,
  code: string,
  merchantUserId: string,
): Promise<{ deviceId: string; created: boolean; name: string; platform: AgentPlatform }> {
  await pairingAccess(tx);
  const [row] = await tx<
    {
      id: string;
      platform: AgentPlatform;
      device_name: string;
      agent_version: string | null;
      tenant_id: string | null;
      device_id: string | null;
      expired: boolean;
    }[]
  >`
    select id, platform, device_name, agent_version, tenant_id, device_id,
           expires_at < now() as expired
    from print_pairings where user_code = ${code}
    for update`;
  if (!row) throw new HttpError(404, 'PAIRING_NOT_FOUND', 'pairing not found');
  if (row.tenant_id && row.tenant_id !== tenantId)
    throw new HttpError(409, 'PAIRING_TAKEN', 'this code was already used');
  if (row.tenant_id && row.device_id)
    return {
      deviceId: row.device_id,
      created: false,
      name: row.device_name,
      platform: row.platform,
    };
  if (row.expired) throw new HttpError(410, 'PAIRING_EXPIRED', 'pairing code expired');
  const [dev] = await tx<{ id: string }[]>`
    insert into print_devices (tenant_id, name, platform, agent_version, created_by)
    values (${tenantId}, ${row.device_name}, ${row.platform}, ${row.agent_version},
            ${merchantUserId})
    returning id`;
  await tx`
    update print_pairings set tenant_id = ${tenantId}, device_id = ${dev!.id}, approved_at = now()
    where id = ${row.id}`;
  return { deviceId: dev!.id, created: true, name: row.device_name, platform: row.platform };
}

export interface AuthedDevice {
  id: string;
  name: string;
  tenant: Tenant;
}

const unauthenticated = () =>
  new HttpError(401, 'UNAUTHENTICATED', 'this device is not connected to a store');

/** `Bearer <tenant>.<device>.<secret>` → the device and its store, or a stable 401. */
export async function authDevice(sql: Sql, header: string | undefined): Promise<AuthedDevice> {
  const m = /^Bearer ([0-9a-f-]{36})\.([0-9a-f-]{36})\.(\S+)$/i.exec(header ?? '');
  if (!m || !UUID_RE.test(m[1]!) || !UUID_RE.test(m[2]!) || !SECRET_RE.test(m[3]!))
    throw unauthenticated();
  const [tenantId, deviceId, secret] = [m[1]!.toLowerCase(), m[2]!.toLowerCase(), m[3]!];
  const [row] = await withTenant(
    sql,
    tenantId,
    (tx) =>
      tx<
        {
          name: string;
          token_hash: string | null;
          slug: string;
          tenant_name: string;
          tenant_status: string;
        }[]
      >`
      select d.name, d.token_hash, t.slug, t.name as tenant_name, t.status as tenant_status
      from print_devices d join tenants t on t.id = d.tenant_id
      where d.tenant_id = ${tenantId} and d.id = ${deviceId}`,
  );
  if (!row) throw new HttpError(401, 'DEVICE_REVOKED', 'this device was removed from the store');
  if (!row.token_hash || !constantTimeEqual(sha256(secret), row.token_hash))
    throw unauthenticated();
  if (row.tenant_status !== 'active')
    throw new HttpError(423, 'TENANT_SUSPENDED', 'tenant is suspended');
  return {
    id: deviceId,
    name: row.name,
    tenant: { id: tenantId, slug: row.slug, name: row.tenant_name, status: row.tenant_status },
  };
}

export interface DeviceView {
  id: string;
  name: string;
  platform: AgentPlatform;
  version: string | null;
  online: boolean;
  /** the agent collected its credential (false right after approving, until it asks) */
  ready: boolean;
  lastSeenAt: string | null;
  createdAt: string;
  printers: PrinterView[];
}

export async function devicesTx(tx: Sql, tenantId: string): Promise<DeviceView[]> {
  const rows = await tx<
    {
      id: string;
      name: string;
      platform: AgentPlatform;
      agent_version: string | null;
      online: boolean;
      ready: boolean;
      last_seen_at: string | null;
      created_at: string;
    }[]
  >`
    select id, name, platform, agent_version, token_hash is not null as ready, last_seen_at,
           created_at,
           coalesce(connected_at is not null
                    and (disconnected_at is null or disconnected_at < connected_at)
                    and last_seen_at > now() - make_interval(secs => ${ONLINE_WINDOW_S}), false)
             as online
    from print_devices where tenant_id = ${tenantId}
    order by created_at, id`;
  const printers = await printersTx(tx, tenantId);
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    platform: r.platform,
    version: r.agent_version,
    online: r.online,
    ready: r.ready,
    lastSeenAt: r.last_seen_at,
    createdAt: r.created_at,
    printers: printers.filter((p) => p.deviceId === r.id),
  }));
}
