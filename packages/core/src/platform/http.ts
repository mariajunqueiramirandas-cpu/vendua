import type { Context, MiddlewareHandler } from 'hono';
import { withTenant, type Sql } from './db.ts';
import type { Tenant, TenantResolver } from './tenancy.ts';

/**
 * Typed error model — `code` is the contract, `message` is human-readable and
 * may change (docs/architecture/01-core.md).
 */
export class HttpError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public details?: Record<string, unknown>,
  ) {
    super(message);
  }
}

export function errorJson(err: unknown, c: Context) {
  if (err instanceof HttpError) {
    const body: Record<string, unknown> = {
      error: { code: err.code, message: err.message },
    };
    if (err.details) (body.error as Record<string, unknown>).details = err.details;
    return c.json(body, err.status as 400);
  }
  console.error(err);
  return c.json({ error: { code: 'INTERNAL', message: 'internal error' } }, 500);
}

type Vars = { tenant: Tenant };

export function tenantMiddleware(resolver: TenantResolver): MiddlewareHandler<{
  Variables: Vars;
}> {
  return async (c, next) => {
    const host = c.req.header('x-forwarded-host') ?? c.req.header('host') ?? '';
    const tenant = await resolver.resolve(host);
    if (!tenant) {
      throw new HttpError(404, 'TENANT_NOT_FOUND', `no tenant for host "${host}"`);
    }
    if (tenant.status !== 'active') {
      throw new HttpError(423, 'TENANT_SUSPENDED', 'tenant is suspended');
    }
    c.set('tenant', tenant);
    await next();
  };
}

/**
 * Idempotency for mutations: the first response for (tenant, Idempotency-Key)
 * is stored and replayed. Missing key → 400 (docs require the header on every
 * mutation). Replays return the stored status/body verbatim.
 */
export function idempotency(
  sql: Sql,
  run: (c: Context) => Promise<{ status: number; body: unknown } | Response>,
): (c: Context) => Promise<Response> {
  return async (c) => {
    const key = c.req.header('idempotency-key');
    const tenant = c.get('tenant') as Tenant;
    if (!key) {
      throw new HttpError(400, 'IDEMPOTENCY_KEY_REQUIRED', 'Idempotency-Key header is required');
    }
    // Reads/writes go through withTenant so the RLS policy sees the GUC.
    const existing = await withTenant(sql, tenant.id, (tx) =>
      tx<{ response: unknown; status_code: number }[]>`
        select response, status_code from idempotency_keys
        where tenant_id = ${tenant.id} and key = ${key}
      `,
    );
    // If the row exists but has no stored response a prior attempt crashed
    // mid-handler; treat as no replay and let it run again.
    const hit = existing[0];
    if (hit?.response != null && hit.status_code != null) {
      return c.json(hit.response, hit.status_code as 200, { 'x-idempotent-replay': 'true' });
    }
    try {
      await withTenant(sql, tenant.id, (tx) =>
        tx`insert into idempotency_keys (tenant_id, key) values (${tenant.id}, ${key})`,
      );
    } catch {
      // Concurrent in-flight duplicate — replay check above will catch the next retry.
    }
    const result = await run(c);
    if (result instanceof Response) return result;
    await withTenant(sql, tenant.id, (tx) =>
      tx`
        update idempotency_keys set response = ${tx.json(result.body as never)}, status_code = ${result.status}
        where tenant_id = ${tenant.id} and key = ${key}
      `,
    );
    return c.json(result.body as object, result.status as 200);
  };
}

const encoder = new TextEncoder();

async function hmac(secret: string, msg: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', key, encoder.encode(msg));
  return btoa(String.fromCharCode(...new Uint8Array(sig)))
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replace(/=+$/, '');
}

/** `vst.<cartId>.<hmac>` — the anonymous checkout session token. */
export async function mintSessionToken(cartId: string, secret: string): Promise<string> {
  return `vst.${cartId}.${await hmac(secret, cartId)}`;
}

export async function verifySessionToken(token: string, secret: string): Promise<string | null> {
  const parts = token.split('.');
  if (parts.length !== 3 || parts[0] !== 'vst') return null;
  const [, cartId, sig] = parts;
  if (!cartId || !sig) return null;
  const expected = await hmac(secret, cartId);
  if (expected.length !== sig.length) return null;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) diff |= expected.charCodeAt(i) ^ sig.charCodeAt(i);
  return diff === 0 ? cartId : null;
}

export async function sessionCartId(c: Context, secret: string): Promise<string> {
  const header = c.req.header('authorization') ?? '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : '';
  const cartId = token ? await verifySessionToken(token, secret) : null;
  if (!cartId) throw new HttpError(401, 'SESSION_REQUIRED', 'a valid session token is required');
  return cartId;
}
