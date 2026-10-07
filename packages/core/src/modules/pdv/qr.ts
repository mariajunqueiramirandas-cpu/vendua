import { createHmac, timingSafeEqual } from 'node:crypto';
import type { Sql } from '../../platform/db.ts';
import { HttpError } from '../../platform/http.ts';
import { storeOrigin } from '../../platform/store-origin.ts';

// A table's QR (ADR 0036): `vqr.<tableId>.<rev>.<sig>`, signed for one store. The rev lets a
// manager replace a leaked QR; the printed one never expires otherwise.

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

const sign = (secret: string, tenantId: string, tableId: string, rev: number) =>
  createHmac('sha256', `${secret}:table-qr`)
    .update(`vqr|${tenantId}|${tableId}|${rev}`)
    .digest('base64url');

export function tableToken(secret: string, tenantId: string, tableId: string, rev: number) {
  return `vqr.${tableId}.${rev}.${sign(secret, tenantId, tableId, rev)}`;
}

/** The table and rev a token names, when this store signed it; null otherwise. */
export function readTableToken(
  secret: string,
  tenantId: string,
  token: unknown,
): { tableId: string; rev: number } | null {
  if (typeof token !== 'string' || token.length > 200) return null;
  const [kind, tableId, revRaw, sig] = token.split('.');
  if (kind !== 'vqr' || !tableId || !UUID.test(tableId) || !revRaw || !sig) return null;
  if (!/^\d{1,7}$/.test(revRaw)) return null;
  const rev = Number(revRaw);
  const want = Buffer.from(sign(secret, tenantId, tableId, rev));
  const got = Buffer.from(sig);
  return got.length === want.length && timingSafeEqual(got, want) ? { tableId, rev } : null;
}

export interface QrTable {
  id: string;
  label: string;
  tabId: string | null;
  serviceBps: number;
}

/**
 * The live table a token names: 404 TABLE_NOT_FOUND for a token signed for another store, a
 * replaced QR or a removed table. `lockTab` holds its open comanda (if any) for the order that
 * follows — taken before checkout's own locks, as the PDV takes them.
 */
export async function tableForToken(
  tx: Sql,
  tenantId: string,
  secret: string,
  token: unknown,
  opts: { lockTab?: boolean } = {},
): Promise<QrTable> {
  const t = readTableToken(secret, tenantId, token);
  const missing = () => new HttpError(404, 'TABLE_NOT_FOUND', 'this table QR is not valid anymore');
  if (!t) throw missing();
  const [row] = await tx<{ id: string; label: string; service_bps: number }[]>`
    select t.id, t.label, coalesce(s.pdv_service_bps, 0) as service_bps
    from pdv_tables t left join store_settings s on s.tenant_id = t.tenant_id
    where t.tenant_id = ${tenantId} and t.id = ${t.tableId} and t.qr_rev = ${t.rev}
      and t.archived_at is null
  `;
  if (!row) throw missing();
  const [tab] = await tx<{ id: string }[]>`
    select id from pdv_tabs
    where tenant_id = ${tenantId} and table_id = ${row.id} and status = 'open'
    ${opts.lockTab ? tx`for update` : tx``}
  `;
  return { id: row.id, label: row.label, tabId: tab?.id ?? null, serviceBps: row.service_bps };
}

export async function qrUrlFor(
  tx: Sql,
  tenant: { id: string; slug: string },
  storeDomain: string,
  secret: string,
  table: { id: string; qr_rev: number },
) {
  const origin = await storeOrigin(tx, tenant, storeDomain);
  return `${origin}/?mesa=${tableToken(secret, tenant.id, table.id, table.qr_rev)}`;
}
