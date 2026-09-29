import { createHash, createHmac, randomInt, timingSafeEqual } from 'node:crypto';
import type { Context, MiddlewareHandler } from 'hono';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';
import { sendWhatsApp } from '../agent/channels/whatsapp.ts';
import { getIntegration } from '../modules/integrations.ts';
import { normalizePhone } from '../modules/customer.ts';
import { withTenant, type Sql } from '../platform/db.ts';
import { HttpError, UUID_RE, windowCounter } from '../platform/http.ts';
import { log } from '../platform/log.ts';
import type { AdminVars, Merchant, Role } from './context.ts';

// Merchant identity (ADR 0020): phone OTP → a session bound to ONE tenant. The
// cookie is `<tenantId>.<sessionId>.<secret>`; only sha256(secret) is stored, and
// the tenant it names is where the session row must live (RLS), so a cookie can't
// be replayed into another store. Tenant comes from the session, never the URL.

const authLog = log.child({ mod: 'admin-auth' });

export const ADMIN_COOKIE = 'vendua_admin';
const SESSION_DAYS = 60;
const CODE_TTL_MIN = 10;
const CODE_MAX_ATTEMPTS = 5;
/** per phone, per rolling hour — a phone can't be spammed with codes */
const CODES_PER_HOUR = 5;
const PICKER_TTL_MS = 10 * 60_000;

const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');

function b64url(buf: Buffer | Uint8Array) {
  return Buffer.from(buf).toString('base64url');
}

function safeEq(a: string, b: string) {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

export function validAdminPhone(v: unknown): string | null {
  if (typeof v !== 'string' || v.length > 40) return null;
  const p = normalizePhone(v);
  return /^\d{10,11}$/.test(p) ? p : null;
}

/** pre-tenant rows (login codes) live behind this GUC, like the CRM's vendua.control */
function authTx<T>(sql: Sql, work: (tx: Sql) => Promise<T>): Promise<T> {
  return sql.begin(async (t) => {
    const tx = t as unknown as Sql;
    await tx`select set_config('vendua.merchant_auth', '1', true)`;
    return work(tx);
  }) as Promise<T>;
}

export interface Membership {
  tenant_id: string;
  slug: string;
  name: string;
  user_id: string;
  role: Role;
}

export async function membershipsFor(sql: Sql, phone: string): Promise<Membership[]> {
  return sql<Membership[]>`select * from merchant_memberships_for_phone(${phone})`;
}

export type OtpSender = (phone: string, text: string) => Promise<void>;

/** WhatsApp through the platform's active number; the log driver just prints it. */
export function whatsappOtpSender(sql: Sql): OtpSender {
  return async (phone, text) => {
    const wa = await getIntegration(sql, 'whatsapp');
    if (!wa && process.env.NODE_ENV !== 'production') {
      // local dev without a WhatsApp number: the code goes to the log
      authLog.info({ phone: `…${phone.slice(-4)}`, text }, 'dev otp (no whatsapp integration)');
      return;
    }
    if (!wa) throw new HttpError(503, 'OTP_UNAVAILABLE', 'code delivery is unavailable right now');
    await sendWhatsApp(sql, wa, `55${phone}`, text);
  };
}

export async function startOtp(
  sql: Sql,
  phone: string,
  send: OtpSender,
): Promise<{ sent: boolean; devCode?: string; expiresAt: string }> {
  const expiresAt = new Date(Date.now() + CODE_TTL_MIN * 60_000);
  // unknown phones get the same answer (no enumeration) but no code
  const known = (await membershipsFor(sql, phone)).length > 0;
  const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
  const limited = await authTx(sql, async (tx) => {
    const recent = (
      await tx<{ n: number }[]>`
        select count(*)::int as n from merchant_login_codes
        where phone = ${phone} and created_at > now() - interval '1 hour'
      `
    )[0]!.n;
    if (recent >= CODES_PER_HOUR) return true;
    await tx`delete from merchant_login_codes where created_at < now() - interval '1 day'`;
    if (known)
      await tx`
        insert into merchant_login_codes (phone, code_hash, expires_at)
        values (${phone}, ${sha256(`${phone}|${code}`)}, ${expiresAt})
      `;
    return false;
  });
  if (limited)
    throw new HttpError(429, 'RATE_LIMITED', 'too many codes for this phone — try again later');
  if (known) {
    try {
      await send(phone, `Seu código Venduá: ${code}\n\nVale por ${CODE_TTL_MIN} minutos.`);
    } catch (err) {
      authLog.warn({ err }, 'otp delivery failed');
      throw new HttpError(503, 'OTP_UNAVAILABLE', 'could not deliver the code — try again');
    }
  }
  return {
    sent: true,
    expiresAt: expiresAt.toISOString(),
    ...(known && process.env.NODE_ENV !== 'production' && process.env.VENDUA_ADMIN_DEV_OTP === '1'
      ? { devCode: code }
      : {}),
  };
}

export async function verifyOtp(sql: Sql, phone: string, code: string): Promise<boolean> {
  if (!/^\d{6}$/.test(code)) return false;
  return authTx(sql, async (tx) => {
    const row = (
      await tx<{ id: string; code_hash: string; attempts: number }[]>`
        select id, code_hash, attempts from merchant_login_codes
        where phone = ${phone} and consumed_at is null and expires_at > now()
        order by created_at desc limit 1 for update
      `
    )[0];
    if (!row || row.attempts >= CODE_MAX_ATTEMPTS) return false;
    if (!safeEq(row.code_hash, sha256(`${phone}|${code}`))) {
      await tx`update merchant_login_codes set attempts = attempts + 1 where id = ${row.id}`;
      return false;
    }
    await tx`update merchant_login_codes set consumed_at = now() where id = ${row.id}`;
    return true;
  });
}

/** Short-lived proof that a phone just verified — lets a multi-store user pick one. */
export function pickerToken(secret: string, phone: string): string {
  const exp = Date.now() + PICKER_TTL_MS;
  const body = `${phone}.${exp}`;
  const sig = createHmac('sha256', secret).update(`vendua.admin.pick|${body}`).digest('base64url');
  return `${body}.${sig}`;
}

export function readPickerToken(secret: string, token: unknown): string | null {
  if (typeof token !== 'string' || token.length > 200) return null;
  const [phone, exp, sig] = token.split('.');
  if (!phone || !exp || !sig || Number(exp) < Date.now()) return null;
  const want = createHmac('sha256', secret)
    .update(`vendua.admin.pick|${phone}.${exp}`)
    .digest('base64url');
  return safeEq(want, sig) ? phone : null;
}

export async function createSession(
  sql: Sql,
  m: Membership,
  userAgent: string | undefined,
): Promise<string> {
  const secret = b64url(crypto.getRandomValues(new Uint8Array(32)));
  const id = await withTenant(sql, m.tenant_id, async (tx) => {
    const row = (
      await tx<{ id: string }[]>`
        insert into merchant_sessions (tenant_id, user_id, secret_hash, user_agent, expires_at)
        values (${m.tenant_id}, ${m.user_id}, ${sha256(secret)}, ${(userAgent ?? '').slice(0, 300)},
                now() + make_interval(days => ${SESSION_DAYS}))
        returning id
      `
    )[0]!;
    await tx`update merchant_users set last_seen_at = now() where id = ${m.user_id}`;
    return row.id;
  });
  return `${m.tenant_id}.${id}.${secret}`;
}

export function setAdminCookie(c: Context, value: string, secure: boolean) {
  setCookie(c, ADMIN_COOKIE, value, {
    httpOnly: true,
    sameSite: 'Lax',
    secure,
    maxAge: 60 * 60 * 24 * SESSION_DAYS,
    path: '/admin',
  });
}

export function clearAdminCookie(c: Context) {
  deleteCookie(c, ADMIN_COOKIE, { path: '/admin' });
}

function parseCookie(v: string | undefined) {
  if (!v || v.length > 200) return null;
  const [tenantId, sessionId, secret] = v.split('.');
  if (!tenantId || !sessionId || !secret) return null;
  if (!UUID_RE.test(tenantId) || !UUID_RE.test(sessionId)) return null;
  return { tenantId, sessionId, secret };
}

/** Resolves the cookie to (tenant, merchant) or 401. Also the CSRF line for mutations. */
type GateRow = {
  secret_hash: string;
  expires_at: string;
  last_seen_at: string;
  user_id: string;
  name: string;
  phone: string;
  role: Role;
  slug: string;
  tname: string;
  tstatus: string;
};

// A valid session row, remembered for a few seconds: the gate otherwise costs a whole DB
// transaction on every admin request. Keyed by the full cookie, so the secret is still
// checked; a local revoke evicts, and another instance's revoke/role change lands within the TTL.
const GATE_TTL_MS = 5_000;
const GATE_MAX = 2_000;
const gateCache = new Map<string, { row: GateRow; until: number }>();
const gateKey = (tenantId: string, sessionId: string) => `${tenantId}.${sessionId}`;

// per-session backstop against a runaway client (each write takes row locks, an audit row and an SSE event);
// the UI debounces well below this, so real use never reaches it
const allowMutation = windowCounter({ windowMs: 60_000, max: 240 });

export function adminGate(
  sql: Sql,
  opts: { trustProxy: boolean },
): MiddlewareHandler<{ Variables: AdminVars }> {
  return async (c, next) => {
    const parsed = parseCookie(getCookie(c, ADMIN_COOKIE));
    if (!parsed) throw new HttpError(401, 'UNAUTHENTICATED', 'sign in to continue');
    if (c.req.method !== 'GET' && c.req.method !== 'HEAD') {
      // cookie-authed mutations: custom header (no simple cross-site form can set it) + same-host Origin
      if (c.req.header('x-vendua-admin') !== '1')
        throw new HttpError(403, 'CSRF', 'missing x-vendua-admin header');
      if (!allowMutation(parsed.sessionId))
        throw new HttpError(429, 'RATE_LIMITED', 'too many changes at once — wait a moment');
      const origin = c.req.header('origin');
      const reqHost =
        (opts.trustProxy ? c.req.header('x-forwarded-host') : undefined) ?? c.req.header('host');
      if (origin) {
        let host: string | null = null;
        try {
          host = new URL(origin).host;
        } catch {
          host = null;
        }
        if (host !== reqHost) throw new HttpError(403, 'CSRF', 'cross-origin request');
      }
    }
    const ck = gateKey(parsed.tenantId, parsed.sessionId);
    const hit = gateCache.get(ck);
    let found: GateRow | null = null;
    if (hit && hit.until > Date.now()) {
      if (safeEq(hit.row.secret_hash, sha256(parsed.secret))) found = hit.row;
    } else {
      found = await withTenant(sql, parsed.tenantId, async (tx) => {
        const rows = await tx<GateRow[]>`
          select s.secret_hash, s.expires_at, s.last_seen_at, u.id as user_id, u.name, u.phone, u.role,
                 t.slug, t.name as tname, t.status as tstatus
          from merchant_sessions s
            join merchant_users u on u.id = s.user_id
            join tenants t on t.id = s.tenant_id
          where s.tenant_id = ${parsed.tenantId} and s.id = ${parsed.sessionId}
            and s.revoked_at is null and s.expires_at > now() and u.status = 'active'
        `;
        const row = rows[0];
        if (!row || !safeEq(row.secret_hash, sha256(parsed.secret))) return null;
        // sliding expiry, written at most hourly
        if (Date.now() - new Date(row.last_seen_at).getTime() > 3_600_000) {
          await tx`
            update merchant_sessions set last_seen_at = now(),
              expires_at = now() + make_interval(days => ${SESSION_DAYS})
            where id = ${parsed.sessionId}
          `;
          await tx`update merchant_users set last_seen_at = now() where id = ${row.user_id}`;
        }
        return row;
      });
      if (found) {
        if (gateCache.size >= GATE_MAX) gateCache.clear();
        gateCache.set(ck, { row: found, until: Date.now() + GATE_TTL_MS });
      } else gateCache.delete(ck);
    }
    if (!found) throw new HttpError(401, 'UNAUTHENTICATED', 'session expired — sign in again');
    if (found.tstatus !== 'active') throw new HttpError(423, 'TENANT_SUSPENDED', 'store suspended');
    const merchant: Merchant = {
      userId: found.user_id,
      sessionId: parsed.sessionId,
      name: found.name,
      phone: found.phone,
      role: found.role,
    };
    c.set('tenant', {
      id: parsed.tenantId,
      slug: found.slug,
      name: found.tname,
      status: found.tstatus,
    });
    c.set('merchant', merchant);
    await next();
  };
}

/** Is this session still good (not revoked, expired or its member removed)? For long-lived streams. */
export async function sessionAlive(sql: Sql, tenantId: string, sessionId: string) {
  const rows = await withTenant(
    sql,
    tenantId,
    (tx) => tx`
      select 1 from merchant_sessions s join merchant_users u on u.id = s.user_id
      where s.tenant_id = ${tenantId} and s.id = ${sessionId}
        and s.revoked_at is null and s.expires_at > now() and u.status = 'active'
    `,
  );
  return rows.length > 0;
}

/** Drop remembered sessions after a role/membership/session write, so it bites here at once. */
export function forgetGate() {
  gateCache.clear();
}

export async function revokeSession(sql: Sql, tenantId: string, sessionId: string) {
  gateCache.delete(gateKey(tenantId, sessionId));
  await withTenant(
    sql,
    tenantId,
    (tx) => tx`update merchant_sessions set revoked_at = now() where id = ${sessionId}`,
  );
}
