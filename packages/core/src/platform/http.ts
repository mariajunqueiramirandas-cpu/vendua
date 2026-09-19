import type { Context, MiddlewareHandler } from 'hono';
import { withTenant, type Sql } from './db.ts';
import { log } from './log.ts';
import type { Tenant, TenantResolver } from './tenancy.ts';

const httpLog = log.child({ mod: 'http' });

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

/**
 * Per-request log line + x-request-id correlation. Registers first in
 * createApp so every request (incl. CORS rejects) is counted. Incoming
 * x-request-id is echoed when plausible (<128 chars) so edge-generated ids
 * correlate end-to-end; anything else gets a fresh UUID.
 */
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
    if (c.req.path === '/healthz') httpLog.debug(fields, 'request');
    else if (status >= 500) httpLog.error(fields, 'request');
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
  // Structured result only — a raw Response would commit writes without a
  // recorded result, so the pending claim could rerun the mutation later.
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
    // Claim the key atomically under a unique owner token: exactly one
    // handler owns (tenant, key). `on conflict` only "steals" a claim whose
    // owner died mid-handler (pending >30s) — a live owner's row makes the
    // insert return nothing. The claim commits in its own tx so peers see
    // the pending row; the expiry sweep keeps the table bounded.
    const owner = crypto.randomUUID();
    const claimed = await withTenant(sql, tenant.id, async (tx) => {
      const rows = await tx<{ key: string }[]>`
        insert into idempotency_keys (tenant_id, key, owner) values (${tenant.id}, ${key}, ${owner})
        on conflict (tenant_id, key) do update set created_at = now(), owner = excluded.owner
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
    // claim that would later rerun it. A per-key advisory lock serializes
    // owners: a request that stole a stale claim waits for the original's
    // tx to end, then replays its stored result instead of double-applying.
    type Outcome =
      | { kind: 'replay'; response: unknown; status: number }
      | { kind: 'result'; status: number; body: unknown };
    let outcome: Outcome;
    try {
      outcome = await withTenant(sql, tenant.id, async (tx): Promise<Outcome> => {
        await tx`select pg_advisory_xact_lock(hashtextextended(${`${tenant.id}|${key}`}, 0))`;
        const cur = (
          await tx<{ owner: string | null; response: unknown; status_code: number }[]>`
            select owner, response, status_code from idempotency_keys
            where tenant_id = ${tenant.id} and key = ${key}
          `
        )[0];
        if (cur?.response != null && cur.status_code != null) {
          return { kind: 'replay', response: cur.response, status: cur.status_code };
        }
        if (cur?.owner !== owner) {
          // Our claim was itself stolen (>30s between claim and lock) — the
          // other owner is committing behind the lock; abort, don't double up.
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
      // The work tx rolled back, but the claim row committed in the claim
      // tx — a pending claim would poison same-key retries with
      // IDEMPOTENCY_IN_PROGRESS for the 30s stale window. Release OUR claim
      // so an immediate retry re-executes (failed responses are not
      // persisted — retries rerun deterministically). The owner predicate
      // keeps cleanup from removing a claim a peer stole.
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

/**
 * Fixed-window rate limit, per (tenant, client-ip). In-memory — Phase 0 is a
 * single-node skeleton; the distributed limiter lives at the edge in prod.
 */
export function rateLimit(
  opts: { windowMs: number; max: number },
  flags: { trustForwardedFor?: boolean; proxyHops?: number } = {},
): MiddlewareHandler<{
  Variables: Vars;
}> {
  const hits = new Map<string, { count: number; resetAt: number }>();
  // Buckets reset lazily per request — without a sweep, every distinct client
  // IP leaves a permanent entry (the map would grow with lifetime traffic).
  // Sweep expired entries at most once per window.
  let nextSweep = 0;
  return async (c, next) => {
    const tenant = c.get('tenant') as Tenant;
    // X-Forwarded-For is client-supplied without a trusted edge — key on it
    // only when VENDUA_TRUST_PROXY=1, else a shared bucket per tenant. When
    // trusted, the client is the entry immediately BEFORE the suffix our own
    // proxies appended: each trusted hop adds its observed peer to the right,
    // so we skip `proxyHops` entries from the right. e.g. client→Traefik→
    // nginx→core arrives as [client, traefik], and hops=1 yields the client;
    // entries left of it stay attacker-settable but unusable for rotation
    // bypass. A chain shorter than configured fails closed to 'unknown' —
    // one shared bucket — rather than falling back to a spoofable entry.
    const xff = c.req
      .header('x-forwarded-for')
      ?.split(',')
      .map((s) => s.trim());
    const idx = xff ? xff.length - 1 - (flags.proxyHops ?? 0) : -1;
    const ip = flags.trustForwardedFor ? (idx >= 0 ? xff![idx]! : 'unknown') : 'local';
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

/** `vst.<cartId>.<hmac>` — the anonymous checkout session token. The HMAC
 *  input binds the tenant, so a token minted on one host can't be replayed
 *  against another tenant even if a cart UUID collides. */
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

/** Bounded `c.req.json()` — 400s on malformed input, 413s on oversized bodies. */
const MAX_BODY_BYTES = 32 * 1024;

export async function bodyJson(c: Context): Promise<Record<string, unknown>> {
  // Public mutation endpoints take attacker-controlled bodies; cap the raw
  // text before parsing so oversized payloads can't burn parse time/memory.
  // Content-Length is a free pre-filter — reject before buffering when the
  // header already overruns the cap (absent/lying headers still hit the
  // post-read byte check below).
  const declared = Number(c.req.header('content-length'));
  if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) {
    throw new HttpError(413, 'PAYLOAD_TOO_LARGE', `body exceeds ${MAX_BODY_BYTES} bytes`);
  }
  const raw = await c.req.text();
  // Bytes, not UTF-16 units — multibyte input would otherwise slip past
  // the cap (string.length undercounts).
  if (new TextEncoder().encode(raw).byteLength > MAX_BODY_BYTES) {
    throw new HttpError(413, 'PAYLOAD_TOO_LARGE', `body exceeds ${MAX_BODY_BYTES} bytes`);
  }
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

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** `param()` that 400s on malformed ids instead of letting Postgres 22P02 500. */
export function uuidParam(c: Context, name: string): string {
  const v = c.req.param(name) ?? '';
  if (!UUID_RE.test(v)) throw new HttpError(400, 'BAD_REQUEST', `${name} must be a uuid`);
  return v;
}

/** Bounded string field — `name` must be a string of at most `max` chars. */
export function str(v: unknown, name: string, max = 500): string {
  if (typeof v !== 'string' || v.length > max) {
    throw new HttpError(422, 'BAD_REQUEST', `${name} must be a string of at most ${max} chars`);
  }
  return v;
}
