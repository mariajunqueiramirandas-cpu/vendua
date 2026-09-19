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

export function tenantMiddleware(
  resolver: TenantResolver,
  opts: { trustForwardedHost?: boolean } = {},
): MiddlewareHandler<{
  Variables: Vars;
}> {
  return async (c, next) => {
    // X-Forwarded-Host is only meaningful when a trusted edge sets it —
    // honoring it blindly lets any client pick a tenant (host-scoped
    // spoofing). Off unless VENDUA_TRUST_PROXY=1.
    const forwarded = opts.trustForwardedHost ? c.req.header('x-forwarded-host') : undefined;
    const host = forwarded ?? c.req.header('host') ?? '';
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
  run: (c: Context, tx: Sql) => Promise<{ status: number; body: unknown } | Response>,
): (c: Context) => Promise<Response> {
  return async (c) => {
    const key = c.req.header('idempotency-key');
    const tenant = c.get('tenant') as Tenant;
    if (!key) {
      throw new HttpError(400, 'IDEMPOTENCY_KEY_REQUIRED', 'Idempotency-Key header is required');
    }
    if (key.length > 200) {
      throw new HttpError(400, 'BAD_REQUEST', 'Idempotency-Key too long');
    }
    // Claim the key atomically: exactly one handler owns (tenant, key).
    // `on conflict` only "steals" a claim whose owner died mid-handler
    // (pending >30s) — a live owner's row makes the insert return nothing.
    // The claim commits in its own tx so peers see the pending row; the
    // expiry sweep keeps the unauthenticated table bounded.
    const claimed = await withTenant(sql, tenant.id, async (tx) => {
      const rows = await tx<{ key: string }[]>`
        insert into idempotency_keys (tenant_id, key) values (${tenant.id}, ${key})
        on conflict (tenant_id, key) do update set created_at = now()
          where idempotency_keys.response is null
            and idempotency_keys.created_at < now() - interval '30 seconds'
        returning key
      `;
      await tx`delete from idempotency_keys where created_at < now() - interval '7 days'`;
      return rows;
    });
    if (!claimed[0]) {
      // Someone else owns the key: replay their stored response, or wait
      // briefly for it to land before telling the client to retry.
      const replay = await withTenant(sql, tenant.id, async (tx) => {
        for (let i = 0; i < 25; i++) {
          const rows = await tx<{ response: unknown; status_code: number }[]>`
            select response, status_code from idempotency_keys
            where tenant_id = ${tenant.id} and key = ${key}
          `;
          const hit = rows[0];
          if (hit?.response != null && hit.status_code != null) return hit;
          await new Promise((r) => setTimeout(r, 100));
        }
        return null;
      });
      if (replay) {
        return c.json(replay.response, replay.status_code as 200, {
          'x-idempotent-replay': 'true',
        });
      }
      throw new HttpError(
        409,
        'IDEMPOTENCY_IN_PROGRESS',
        'a request with this Idempotency-Key is still in flight — retry',
      );
    }
    // The handler's writes and its recorded response commit in one tx — a
    // crash between them can't leave a committed mutation behind a pending
    // claim that would later rerun it.
    const result = await withTenant(sql, tenant.id, async (tx) => {
      const r = await run(c, tx);
      if (r instanceof Response) return r;
      await tx`
        update idempotency_keys set response = ${tx.json(r.body as never)}, status_code = ${r.status}
        where tenant_id = ${tenant.id} and key = ${key}
      `;
      return r;
    });
    if (result instanceof Response) return result;
    return c.json(result.body as object, result.status as 200);
  };
}

/**
 * Fixed-window rate limit, per (tenant, client-ip). In-memory — Phase 0 is a
 * single-node skeleton; the distributed limiter lives at the edge in prod.
 */
export function rateLimit(
  opts: { windowMs: number; max: number },
  flags: { trustForwardedFor?: boolean } = {},
): MiddlewareHandler<{
  Variables: Vars;
}> {
  const hits = new Map<string, { count: number; resetAt: number }>();
  return async (c, next) => {
    const tenant = c.get('tenant') as Tenant;
    // X-Forwarded-For is client-supplied without a trusted edge — key on it
    // only when VENDUA_TRUST_PROXY=1, else a shared bucket per tenant.
    const ip = flags.trustForwardedFor
      ? (c.req.header('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown')
      : 'local';
    const now = Date.now();
    const k = `${tenant.id}|${ip}`;
    const bucket = hits.get(k);
    if (!bucket || bucket.resetAt <= now) {
      hits.set(k, { count: 1, resetAt: now + opts.windowMs });
    } else if (++bucket.count > opts.max) {
      throw new HttpError(429, 'RATE_LIMITED', 'too many requests — retry later');
    }
    await next();
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

/** `c.req.json()` that 400s on malformed input instead of 500ing. */
export async function bodyJson(c: Context): Promise<Record<string, unknown>> {
  try {
    const body = await c.req.json();
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      throw new HttpError(400, 'BAD_REQUEST', 'body must be a JSON object');
    }
    return body as Record<string, unknown>;
  } catch (err) {
    if (err instanceof HttpError) throw err;
    throw new HttpError(400, 'BAD_REQUEST', 'body is not valid JSON');
  }
}
