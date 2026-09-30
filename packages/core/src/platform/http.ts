import { createHash, timingSafeEqual } from 'node:crypto';
import type { Context, MiddlewareHandler } from 'hono';
import { getCookie } from 'hono/cookie';
import { withTenant, type Sql } from './db.ts';
import { log } from './log.ts';
import { validHost, type Tenant, type TenantResolver } from './tenancy.ts';

const httpLog = log.child({ mod: 'http' });

/** `code` is the contract; `message` is human-readable and may change (01-core.md). */
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
  httpLog.error(
    {
      err,
      method: c.req.method,
      path: c.req.path,
      requestId: (c as Context<{ Variables: { requestId?: string } }>).get('requestId'),
    },
    'unhandled error',
  );
  return c.json({ error: { code: 'INTERNAL', message: 'internal error' } }, 500);
}

// x-request-id correlation: echoes a plausible incoming id (<128 chars), else mints a UUID.
// Reads (GET/HEAD/OPTIONS) log at debug — the control UI polls; mutations info, 4xx warn, 5xx error.
export function requestLogger(): MiddlewareHandler<{ Variables: { requestId: string } }> {
  return async (c, next) => {
    const incoming = c.req.header('x-request-id');
    const requestId = incoming && incoming.length <= 128 ? incoming : crypto.randomUUID();
    c.set('requestId', requestId);
    c.header('x-request-id', requestId);
    const start = performance.now();
    await next();
    const status = c.res.status;
    const fields = {
      requestId,
      method: c.req.method,
      path: c.req.path,
      status,
      ms: Math.round(performance.now() - start),
      host: c.req.header('host'),
    };
    if (status >= 500) httpLog.error(fields, 'request');
    else if (status >= 400) httpLog.warn(fields, 'request');
    else if (['GET', 'HEAD', 'OPTIONS'].includes(c.req.method)) httpLog.debug(fields, 'request');
    else httpLog.info(fields, 'request');
  };
}

type Vars = { tenant: Tenant };

export function tenantMiddleware(
  resolver: TenantResolver,
  opts: { trustForwardedHost?: boolean } = {},
): MiddlewareHandler<{
  Variables: Vars;
}> {
  return async (c, next) => {
    // honoring X-Forwarded-Host blindly lets any client pick a tenant — only behind a trusted edge (VENDUA_TRUST_PROXY=1)
    const forwarded = opts.trustForwardedHost ? c.req.header('x-forwarded-host') : undefined;
    const host = forwarded ?? c.req.header('host') ?? '';
    if (!validHost(host.trim().toLowerCase())) {
      throw new HttpError(400, 'BAD_REQUEST', 'invalid Host header');
    }
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

/** Constant-time string compare; hashing first hides the length too. */
export function constantTimeEqual(a: string | undefined | null, b: string): boolean {
  if (a == null) return false;
  const ha = createHash('sha256').update(a).digest();
  const hb = createHash('sha256').update(b).digest();
  return timingSafeEqual(ha, hb) && a.length === b.length;
}

/** sha256(method, path, every credential the request carries) — never stored in the clear. */
export function idempotencyFingerprint(c: Context): string {
  const merchant = (c as Context<{ Variables: { merchant?: { sessionId?: string } } }>).get(
    'merchant',
  );
  const parts = [
    c.req.method,
    c.req.path,
    c.req.header('authorization') ?? '',
    c.req.header('x-vendua-customer') ?? '',
    merchant?.sessionId ?? getCookie(c, 'vendua_admin') ?? '',
    getCookie(c, 'vendua_control') ?? '',
    c.req.header('x-vendua-control') ?? '',
  ];
  return createHash('sha256').update(parts.join('\n')).digest('hex');
}

/** The origin links and payment callbacks should point at: the configured admin domain, else the
 *  request's own host only when it's one we serve (dev loopback, the platform domain, a store
 *  host already resolved) — never an arbitrary Host header. */
export function knownOrigin(
  c: Context,
  o: {
    adminDomain?: string | undefined;
    storeDomain: string;
    trustProxy: boolean;
    isStoreHost: (host: string) => boolean;
  },
): string {
  if (o.adminDomain) return `https://${o.adminDomain}`;
  const fallback = `https://admin.${o.storeDomain}`;
  const url = new URL(c.req.url);
  const host = (
    (o.trustProxy ? c.req.header('x-forwarded-host') : undefined) ??
    c.req.header('host') ??
    url.host
  )
    .trim()
    .toLowerCase();
  if (!validHost(host)) return fallback;
  const hostname = host.replace(/:\d+$/, '');
  const known =
    hostname === 'localhost' ||
    hostname.endsWith('.localhost') ||
    hostname === '127.0.0.1' ||
    hostname === '[::1]' ||
    hostname === o.storeDomain ||
    hostname === `admin.${o.storeDomain}` ||
    o.isStoreHost(host);
  if (!known) return fallback;
  const proto = o.trustProxy ? c.req.header('x-forwarded-proto') : undefined;
  const scheme = proto === 'http' || proto === 'https' ? proto : url.protocol.replace(':', '');
  return `${scheme}://${host}`;
}

const keyReused = () =>
  new HttpError(
    422,
    'IDEMPOTENCY_KEY_REUSED',
    'this Idempotency-Key was used for a different request — send a new key',
  );

/** First response for (tenant, Idempotency-Key) is stored; replays return it verbatim to the same
 *  caller and route (422 IDEMPOTENCY_KEY_REUSED otherwise). Missing key → 400. */
export function idempotency(
  sql: Sql,
  // structured result only — a raw Response could commit writes without a recorded result for the claim to replay
  run: (c: Context, tx: Sql) => Promise<{ status: number; body: unknown }>,
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
    // one owner per (tenant,key): on-conflict "steals" only a dead claim (pending >30s);
    // the claim commits in its own tx so peers see the pending row; the sweep below bounds the table
    const owner = crypto.randomUUID();
    const fingerprint = idempotencyFingerprint(c);
    // null = a row from before fingerprints existed: replayable to anyone, as it was
    const sameCaller = (fp: string | null | undefined) => fp == null || fp === fingerprint;
    const claimed = await withTenant(sql, tenant.id, async (tx) => {
      const rows = await tx<{ key: string }[]>`
        insert into idempotency_keys (tenant_id, key, owner, fingerprint)
        values (${tenant.id}, ${key}, ${owner}, ${fingerprint})
        on conflict (tenant_id, key) do update
          set created_at = now(), owner = excluded.owner, fingerprint = excluded.fingerprint
          where idempotency_keys.response is null
            and idempotency_keys.created_at < now() - interval '30 seconds'
        returning key
      `;
      // a sweep on ~1 in 50 claims still bounds the table, without a round trip on every write
      if (Math.random() < 0.02)
        await tx`delete from idempotency_keys where created_at < now() - interval '7 days'`;
      return rows;
    });
    if (!claimed[0]) {
      // another owner holds the key: replay its stored response, waiting briefly for it to land
      const replay = await withTenant(sql, tenant.id, async (tx) => {
        for (let i = 0; i < 25; i++) {
          const rows = await tx<
            { response: unknown; status_code: number; fingerprint: string | null }[]
          >`
            select response, status_code, fingerprint from idempotency_keys
            where tenant_id = ${tenant.id} and key = ${key}
          `;
          const hit = rows[0];
          if (hit && !sameCaller(hit.fingerprint)) throw keyReused();
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
    // handler writes + recorded response commit in one tx; the per-key advisory lock serializes owners,
    // so a stale-claim stealer waits for the original's tx then replays its result instead of double-applying
    type Outcome =
      | { kind: 'replay'; response: unknown; status: number }
      | { kind: 'result'; status: number; body: unknown };
    let outcome: Outcome;
    try {
      outcome = await withTenant(sql, tenant.id, async (tx): Promise<Outcome> => {
        await tx`select pg_advisory_xact_lock(hashtextextended(${`${tenant.id}|${key}`}, 0))`;
        const cur = (
          await tx<
            {
              owner: string | null;
              response: unknown;
              status_code: number;
              fingerprint: string | null;
            }[]
          >`
            select owner, response, status_code, fingerprint from idempotency_keys
            where tenant_id = ${tenant.id} and key = ${key}
          `
        )[0];
        if (cur?.response != null && cur.status_code != null) {
          if (!sameCaller(cur.fingerprint)) throw keyReused();
          return { kind: 'replay', response: cur.response, status: cur.status_code };
        }
        if (cur?.owner !== owner) {
          // our claim was stolen (>30s between claim and lock) — the other owner is committing; abort, don't double up
          throw new HttpError(
            409,
            'IDEMPOTENCY_IN_PROGRESS',
            'a request with this Idempotency-Key is still in flight — retry',
          );
        }
        const r = await run(c, tx);
        const stored = await tx`
          update idempotency_keys set response = ${tx.json(r.body as never)}, status_code = ${r.status}
          where tenant_id = ${tenant.id} and key = ${key} and owner = ${owner}
        `;
        if (stored.count === 0) {
          throw new HttpError(
            409,
            'IDEMPOTENCY_IN_PROGRESS',
            'a request with this Idempotency-Key is still in flight — retry',
          );
        }
        return { kind: 'result', status: r.status, body: r.body };
      });
    } catch (err) {
      // release our pending claim so an immediate retry re-executes instead of hitting IDEMPOTENCY_IN_PROGRESS
      // for the 30s stale window (failed responses aren't persisted); the owner predicate spares a stolen claim
      try {
        await withTenant(
          sql,
          tenant.id,
          (tx) =>
            tx`delete from idempotency_keys
               where tenant_id = ${tenant.id} and key = ${key} and owner = ${owner}`,
        );
      } catch {
        /* best effort — the 30s stale window + 7-day sweep still bound it */
      }
      throw err;
    }
    if (outcome.kind === 'replay') {
      return c.json(outcome.response as object, outcome.status as 200, {
        'x-idempotent-replay': 'true',
      });
    }
    return c.json(outcome.body as object, outcome.status as 200);
  };
}

/** Fixed-window counter keyed by string, in-memory. Returns false once `key` exceeds `max` in the window. */
export function windowCounter(opts: { windowMs: number; max: number }) {
  const hits = new Map<string, { count: number; resetAt: number }>();
  let nextSweep = 0;
  return (key: string): boolean => {
    const now = Date.now();
    if (now >= nextSweep) {
      nextSweep = now + opts.windowMs;
      for (const [k, b] of hits) if (b.resetAt <= now) hits.delete(k);
    }
    const b = hits.get(key);
    if (!b || b.resetAt <= now) {
      hits.set(key, { count: 1, resetAt: now + opts.windowMs });
      return true;
    }
    return ++b.count <= opts.max;
  };
}

type IpContext = {
  req: { header(n: string): string | undefined; raw?: Request };
  env?: unknown;
};

/** The TCP peer when served by Bun (the fetch's 2nd arg is the server); undefined in tests. */
export function socketIp(c: IpContext): string | undefined {
  const server = c.env as
    { requestIP?: (r: Request) => { address?: string } | null; server?: unknown } | undefined;
  try {
    const s = (server && 'server' in server ? server.server : server) as typeof server;
    return (c.req.raw && s?.requestIP?.(c.req.raw)?.address) || undefined;
  } catch {
    return undefined;
  }
}

/** Client IP from a trusted edge's X-Forwarded-For, skipping `proxyHops` of our own proxies from the
 *  right; without a trusted edge, the socket's peer address. */
export function clientIp(
  c: IpContext,
  flags: { trustForwardedFor?: boolean; proxyHops?: number } = {},
): string {
  if (!flags.trustForwardedFor) return socketIp(c) ?? 'local';
  const xff = c.req
    .header('x-forwarded-for')
    ?.split(',')
    .map((s) => s.trim());
  return xff?.at(-1 - (flags.proxyHops ?? 0)) ?? 'unknown';
}

/** Fixed-window per-(tenant, ip) limit, in-memory (single node) — the distributed limiter lives at the edge in prod. */
export function rateLimit(
  opts: { windowMs: number; max: number },
  flags: { trustForwardedFor?: boolean; proxyHops?: number } = {},
): MiddlewareHandler<{
  Variables: Vars;
}> {
  const hits = new Map<string, { count: number; resetAt: number }>();
  // lazy sweep of expired buckets at most once per window — distinct client IPs would otherwise accumulate forever
  let nextSweep = 0;
  return async (c, next) => {
    const tenant = c.get('tenant') as Tenant;
    // trusted-edge XFF (VENDUA_TRUST_PROXY=1): the client is the entry just before the suffix our proxies
    // appended, i.e. skip proxyHops from the right; a chain shorter than configured fails closed to 'unknown'
    // rather than trusting a spoofable entry. Without a trusted edge the key is the socket's peer.
    const ip = clientIp(c, flags);
    const now = Date.now();
    if (now >= nextSweep) {
      nextSweep = now + opts.windowMs;
      for (const [bk, b] of hits) if (b.resetAt <= now) hits.delete(bk);
    }
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

/** `vst.<cartId>.<hmac>` checkout session token — the HMAC input binds the tenant, so tokens can't cross tenants. */
export async function mintSessionToken(
  cartId: string,
  tenantId: string,
  secret: string,
): Promise<string> {
  return `vst.${cartId}.${await hmac(secret, `${tenantId}|${cartId}`)}`;
}

export async function verifySessionToken(
  token: string,
  tenantId: string,
  secret: string,
): Promise<string | null> {
  const parts = token.split('.');
  if (parts.length !== 3 || parts[0] !== 'vst') return null;
  const [, cartId, sig] = parts;
  if (!cartId || !sig) return null;
  const expected = await hmac(secret, `${tenantId}|${cartId}`);
  if (expected.length !== sig.length) return null;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) diff |= expected.charCodeAt(i) ^ sig.charCodeAt(i);
  return diff === 0 ? cartId : null;
}

export async function sessionCartId(c: Context, secret: string): Promise<string> {
  const tenant = c.get('tenant') as Tenant;
  const header = c.req.header('authorization') ?? '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : '';
  const cartId = token ? await verifySessionToken(token, tenant.id, secret) : null;
  if (!cartId) throw new HttpError(401, 'SESSION_REQUIRED', 'a valid session token is required');
  return cartId;
}

const MAX_BODY_BYTES = 32 * 1024;

export async function boundedText(c: Context, max = MAX_BODY_BYTES): Promise<string> {
  // cap raw bytes before parsing attacker-controlled bodies; Content-Length is a free pre-filter
  // (absent/lying headers still hit the post-read check)
  const declared = Number(c.req.header('content-length'));
  if (Number.isFinite(declared) && declared > max) {
    throw new HttpError(413, 'PAYLOAD_TOO_LARGE', `body exceeds ${max} bytes`);
  }
  const raw = await c.req.text();
  // byte length, not string.length — multibyte input would slip the cap
  if (Buffer.byteLength(raw, 'utf8') > max) {
    throw new HttpError(413, 'PAYLOAD_TOO_LARGE', `body exceeds ${max} bytes`);
  }
  return raw;
}

export function parseJsonObject(raw: string): Record<string, unknown> {
  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    throw new HttpError(400, 'BAD_REQUEST', 'body is not valid JSON');
  }
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw new HttpError(400, 'BAD_REQUEST', 'body must be a JSON object');
  }
  return body as Record<string, unknown>;
}

export async function bodyJson(c: Context, max?: number): Promise<Record<string, unknown>> {
  return parseJsonObject(await boundedText(c, max));
}

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** 400s on a malformed id instead of letting Postgres 22P02 500. */
export function uuidParam(c: Context, name: string): string {
  const v = c.req.param(name) ?? '';
  if (!UUID_RE.test(v)) throw new HttpError(400, 'BAD_REQUEST', `${name} must be a uuid`);
  return v;
}

export function str(v: unknown, name: string, max = 500): string {
  if (typeof v !== 'string' || v.length > max) {
    throw new HttpError(422, 'BAD_REQUEST', `${name} must be a string of at most ${max} chars`);
  }
  return v;
}
