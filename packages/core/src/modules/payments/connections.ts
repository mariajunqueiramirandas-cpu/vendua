import type { Sql } from '../../platform/db.ts';
import { seal, unseal } from '../../platform/secrets.ts';
import type { OAuthTokens, PaymentProvider, ProviderName } from './provider.ts';

// A store's Mercado Pago account (13-payments.md#merchant-connection). Tokens live sealed in
// payment_connections; nothing outside this file sees them unsealed except the caller of tokenFor.

export type ConnectionStatus = 'connected' | 'expiring' | 'disconnected' | 'restricted';

export interface ConnectionRow {
  tenant_id: string;
  provider: ProviderName;
  provider_user_id: string;
  status: ConnectionStatus;
  access_token: unknown;
  refresh_token: unknown;
  public_key: string | null;
  scope: string | null;
  live_mode: boolean;
  expires_at: Date;
  connected_by: string | null;
  connected_at: Date;
  refreshed_at: Date | null;
  last_error: string | null;
  status_changed_at: Date;
  notified_status: string | null;
}

export async function loadConnection(
  tx: Sql,
  tenantId: string,
  opts: { forUpdate?: boolean } = {},
): Promise<ConnectionRow | null> {
  const rows = await tx<ConnectionRow[]>`
    select * from payment_connections where tenant_id = ${tenantId}
    ${opts.forUpdate ? tx`for update skip locked` : tx``}
  `;
  return rows[0] ?? null;
}

/** Shoppers may be charged online: the install can talk to this connection and it's healthy. */
export function isOnline(
  conn: ConnectionRow | null,
  provider?: Pick<PaymentProvider, 'name' | 'configured'>,
  now = new Date(),
): boolean {
  if (!conn) return false;
  if (provider && (!provider.configured || provider.name !== conn.provider)) return false;
  return (
    (conn.status === 'connected' || conn.status === 'expiring') &&
    new Date(conn.expires_at).getTime() > now.getTime()
  );
}

export async function upsertConnection(
  tx: Sql,
  tenantId: string,
  provider: ProviderName,
  t: OAuthTokens,
  sessionSecret: string,
  connectedBy: string | null,
) {
  const access = seal(t.accessToken, sessionSecret);
  const refresh = t.refreshToken ? seal(t.refreshToken, sessionSecret) : null;
  await tx`
    insert into payment_connections (tenant_id, provider, provider_user_id, status, access_token,
      refresh_token, public_key, scope, live_mode, expires_at, connected_by, connected_at,
      refreshed_at, last_error, status_changed_at)
    values (${tenantId}, ${provider}, ${t.providerUserId.slice(0, 64)}, 'connected', ${tx.json(access as never)},
      ${refresh ? tx.json(refresh as never) : null}, ${t.publicKey?.slice(0, 200) ?? null},
      ${t.scope?.slice(0, 300) ?? null}, ${t.liveMode}, ${t.expiresAt}, ${connectedBy}, now(), null, null, now())
    on conflict (tenant_id) do update set
      provider = excluded.provider, provider_user_id = excluded.provider_user_id, status = 'connected',
      access_token = excluded.access_token, refresh_token = excluded.refresh_token,
      public_key = excluded.public_key, scope = excluded.scope, live_mode = excluded.live_mode,
      expires_at = excluded.expires_at, connected_by = excluded.connected_by,
      connected_at = excluded.connected_at, refreshed_at = null, last_error = null,
      -- the owner just (re)connected: the next health change alerts again
      notified_status = 'connected',
      status_changed_at = case when payment_connections.status = 'connected'
        then payment_connections.status_changed_at else now() end
  `;
}

/** A refresh keeps the account (and who connected it); only the tokens and health move. */
export async function storeRefreshed(
  tx: Sql,
  tenantId: string,
  t: OAuthTokens,
  sessionSecret: string,
  keepStatus: boolean,
) {
  const access = seal(t.accessToken, sessionSecret);
  const refresh = t.refreshToken ? seal(t.refreshToken, sessionSecret) : null;
  await tx`
    update payment_connections set
      access_token = ${tx.json(access as never)},
      refresh_token = coalesce(${refresh ? tx.json(refresh as never) : null}, refresh_token),
      public_key = coalesce(${t.publicKey?.slice(0, 200) ?? null}, public_key),
      scope = coalesce(${t.scope?.slice(0, 300) ?? null}, scope),
      expires_at = ${t.expiresAt}, refreshed_at = now(), last_error = null,
      status = ${keepStatus ? tx`status` : tx`'connected'`},
      status_changed_at = case when ${keepStatus} or status = 'connected' then status_changed_at else now() end
    where tenant_id = ${tenantId}
  `;
}

/**
 * `since` guards against a race: another replica may have refreshed the token after we read it,
 * so a 401 on the old token must not disconnect the fresh one.
 */
export async function setConnectionStatus(
  tx: Sql,
  tenantId: string,
  status: ConnectionStatus,
  lastError: string | null,
  since?: Date | null,
) {
  await tx`
    update payment_connections set status = ${status}, last_error = ${lastError?.slice(0, 300) ?? null},
      status_changed_at = case when status = ${status} then status_changed_at else now() end
    where tenant_id = ${tenantId}
      ${since ? tx`and date_trunc('milliseconds', coalesce(refreshed_at, connected_at)) <= ${since}` : tx``}
  `;
}

export const OWNER_DISCONNECTED = 'disconnected_by_owner';

/**
 * The owner disconnects: tokens are wiped, but the row (and its account id) stays so a payment
 * already in flight is still recognised as this store's and surfaced for review.
 */
export async function disconnectConnection(tx: Sql, tenantId: string) {
  await tx`
    update payment_connections set status = 'disconnected', access_token = '{}'::jsonb,
      refresh_token = null, last_error = ${OWNER_DISCONNECTED}, notified_status = 'disconnected',
      status_changed_at = now()
    where tenant_id = ${tenantId}
  `;
}

export interface StoreToken {
  token: string;
  providerUserId: string;
  provider: ProviderName;
  status: ConnectionStatus;
  /** when these tokens were minted — the guard for setConnectionStatus */
  since: Date;
}

/**
 * The merchant's access token, or null when there is none to use. A box that no longer opens
 * (VENDUA_SECRETS_KEY rotated, row tampered) disconnects the store — the owner reconnects.
 * `restricted` still reads and refunds; only new charges are held (isOnline). `read` also tries a
 * `disconnected` connection's token (still unexpired): in-flight payments must still be applied.
 */
export async function tokenFor(
  tx: Sql,
  tenantId: string,
  sessionSecret: string,
  opts: { read?: boolean } = {},
): Promise<StoreToken | null> {
  const conn = await loadConnection(tx, tenantId);
  if (!conn || (conn.status === 'disconnected' && !opts.read)) return null;
  if (new Date(conn.expires_at).getTime() <= Date.now()) return null;
  const token = unseal(conn.access_token, sessionSecret);
  if (!token) {
    if (conn.status !== 'disconnected')
      await setConnectionStatus(tx, tenantId, 'disconnected', 'token_unreadable');
    return null;
  }
  return {
    token,
    providerUserId: conn.provider_user_id,
    provider: conn.provider,
    status: conn.status,
    since: new Date(conn.refreshed_at ?? conn.connected_at),
  };
}

export interface MercadoPagoView {
  available: boolean;
  status: 'not_connected' | ConnectionStatus;
  accountId: string | null;
  liveMode: boolean | null;
  connectedAt: string | null;
  expiresAt: string | null;
  lastError: string | null;
}

export function connectionView(
  conn: ConnectionRow | null,
  provider: Pick<PaymentProvider, 'name' | 'configured'>,
): MercadoPagoView {
  if (!conn || (conn.status === 'disconnected' && conn.last_error === OWNER_DISCONNECTED))
    return {
      available: provider.configured,
      status: 'not_connected',
      accountId: null,
      liveMode: null,
      connectedAt: null,
      expiresAt: null,
      lastError: null,
    };
  const expired = new Date(conn.expires_at).getTime() <= Date.now();
  // a row from another driver (dev switched fake → MP) can't be used by this install
  const usable = provider.configured && provider.name === conn.provider;
  return {
    available: provider.configured,
    status: !usable || expired ? 'disconnected' : conn.status,
    accountId: conn.provider_user_id,
    liveMode: conn.live_mode,
    connectedAt: new Date(conn.connected_at).toISOString(),
    expiresAt: new Date(conn.expires_at).toISOString(),
    lastError: conn.last_error,
  };
}
