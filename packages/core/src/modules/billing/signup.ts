import { createHash, createHmac, randomInt, timingSafeEqual } from 'node:crypto';
import { foldSlug, type MerchantNotify } from '../../admin/context.ts';
import type { Sql } from '../../platform/db.ts';
import { HttpError } from '../../platform/http.ts';
import { platformHost } from '../../platform/store-origin.ts';
import { billingLog } from './invoices.ts';

// Self-serve signup's own OTP: codes live in merchant_login_codes with purpose 'signup' (login
// consumes only 'login'), behind the same vendua.merchant_auth GUC, hashing, attempt cap and
// per-phone hourly cap as admin/auth.ts. Unlike login, it sends to any phone — nothing leaks:
// the phone learns only which stores it already owns, after proving it holds the number.

const CODE_TTL_MIN = 10;
const CODE_MAX_ATTEMPTS = 5;
const CODES_PER_HOUR = 5;
const TOKEN_TTL_MS = 30 * 60_000;

const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');

function safeEq(a: string, b: string) {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

function authTx<T>(sql: Sql, work: (tx: Sql) => Promise<T>): Promise<T> {
  return sql.begin(async (t) => {
    const tx = t as unknown as Sql;
    await tx`select set_config('vendua.merchant_auth', '1', true)`;
    return work(tx);
  }) as Promise<T>;
}

export const RESERVED_SLUGS = new Set([
  'admin',
  'painel',
  'www',
  'api',
  'app',
  'crm',
  'control',
  'loja',
  'lojas',
  'site',
  'blog',
  'ajuda',
  'help',
  'suporte',
  'status',
  'mail',
  'email',
  'pagamento',
  'pagamentos',
  'checkout',
  'vendua',
  'conta',
  'entrar',
  'comecar',
  'cadastro',
  'static',
  'cdn',
  'media',
  'dev',
  'staging',
  'teste',
  'test',
]);

const SLUG_RE = /^[a-z0-9]([a-z0-9-]{1,38}[a-z0-9])$/;

/** slugify's fold capped at 40; '' when nothing is left */
export function normalizeSlug(raw: unknown): string {
  return typeof raw === 'string' ? foldSlug(raw.slice(0, 120), 40) : '';
}

export type SlugReason = 'taken' | 'reserved' | 'invalid';

async function slugInUse(sql: Sql, slug: string, storeDomain: string) {
  const rows = await sql`
    select 1 from tenants where slug = ${slug}
    union all select 1 from domains where host = ${platformHost(slug, storeDomain)}
    limit 1
  `;
  return rows.length > 0;
}

export async function slugStatus(
  sql: Sql,
  raw: unknown,
  storeDomain: string,
): Promise<{ slug: string; available: boolean; reason?: SlugReason; suggestion?: string }> {
  const slug = normalizeSlug(raw);
  if (!SLUG_RE.test(slug)) return { slug, available: false, reason: 'invalid' };
  const reason: SlugReason | null = RESERVED_SLUGS.has(slug)
    ? 'reserved'
    : (await slugInUse(sql, slug, storeDomain))
      ? 'taken'
      : null;
  if (!reason) return { slug, available: true };
  for (let n = 2; n <= 30; n++) {
    const suffix = `-${n}`;
    const candidate = `${slug.slice(0, 40 - suffix.length).replace(/-+$/, '')}${suffix}`;
    if (SLUG_RE.test(candidate) && !(await slugInUse(sql, candidate, storeDomain)))
      return { slug, available: false, reason, suggestion: candidate };
  }
  return { slug, available: false, reason };
}

/** what a store sells — the admin owns the labels; Core only keeps the key */
export const SEGMENTS = [
  'doces',
  'salgados',
  'pizzaria',
  'lanches',
  'marmitas',
  'acai',
  'padaria',
  'japonesa',
  'bebidas',
  'outro',
] as const;
export type Segment = (typeof SEGMENTS)[number];

/** the segment when it's on the list, else null */
export function validSegment(v: unknown): Segment | null {
  return typeof v === 'string' && (SEGMENTS as readonly string[]).includes(v)
    ? (v as Segment)
    : null;
}

/** not given (undefined / null / '') = null; anything off the list is a 422 */
export function segmentOr422(v: unknown): Segment | null {
  if (v === undefined || v === null || v === '') return null;
  const s = validSegment(v);
  if (!s)
    throw new HttpError(422, 'BAD_REQUEST', `segment must be one of ${SEGMENTS.join(', ')}`, {
      field: 'segment',
    });
  return s;
}

/** One free trial per owner phone (ADR 0025): has a store this phone owns ever trialed? */
export async function phoneHadTrial(sql: Sql, phone: string): Promise<boolean> {
  return (await sql<{ used: boolean }[]>`select phone_had_trial(${phone}) as used`)[0]!.used;
}

/** signup codes per client IP per rolling day — each is a WhatsApp message we pay for */
export const SIGNUP_CODES_PER_IP_DAY = Number(process.env.VENDUA_SIGNUP_OTP_PER_IP_DAY) || 30;

export async function startSignupOtp(
  sql: Sql,
  phone: string,
  notify: MerchantNotify,
  o: { ip?: string; perIpDay?: number } = {},
): Promise<{ sent: boolean; expiresAt: string; devCode?: string }> {
  const expiresAt = new Date(Date.now() + CODE_TTL_MIN * 60_000);
  const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
  const limited = await authTx(sql, async (tx) => {
    if (o.ip) {
      const ipHash = sha256(`vendua.signup.ip|${o.ip}`);
      await tx`select pg_advisory_xact_lock(hashtextextended(${ipHash}, 0))`;
      const today = (
        await tx<{ n: number }[]>`
          select count(*)::int as n from signup_otp_sends
          where ip_hash = ${ipHash} and created_at > now() - interval '1 day'
        `
      )[0]!.n;
      if (today >= (o.perIpDay ?? SIGNUP_CODES_PER_IP_DAY)) return true;
      if (Math.random() < 0.02)
        await tx`delete from signup_otp_sends where created_at < now() - interval '2 days'`;
      await tx`insert into signup_otp_sends (ip_hash) values (${ipHash})`;
    }
    // the hourly cap counts every code the phone got, sign-in and signup alike
    const recent = (
      await tx<{ n: number }[]>`
        select count(*)::int as n from merchant_login_codes
        where phone = ${phone} and created_at > now() - interval '1 hour'
      `
    )[0]!.n;
    if (recent >= CODES_PER_HOUR) return true;
    await tx`
      insert into merchant_login_codes (phone, code_hash, expires_at, purpose)
      values (${phone}, ${sha256(`${phone}|${code}`)}, ${expiresAt}, 'signup')
    `;
    return false;
  });
  if (limited) throw new HttpError(429, 'RATE_LIMITED', 'too many codes — try again later');
  try {
    await notify.whatsapp(
      phone,
      `Seu código para criar a loja na Venduá: ${code}\n\nVale por ${CODE_TTL_MIN} minutos.`,
    );
  } catch (err) {
    billingLog.warn({ err }, 'signup otp delivery failed');
    throw new HttpError(503, 'OTP_UNAVAILABLE', 'could not deliver the code — try again');
  }
  return {
    sent: true,
    expiresAt: expiresAt.toISOString(),
    ...(process.env.NODE_ENV !== 'production' && process.env.VENDUA_ADMIN_DEV_OTP === '1'
      ? { devCode: code }
      : {}),
  };
}

export async function verifySignupOtp(sql: Sql, phone: string, code: string): Promise<boolean> {
  if (!/^\d{6}$/.test(code)) return false;
  return authTx(sql, async (tx) => {
    const row = (
      await tx<{ id: string; code_hash: string; attempts: number }[]>`
        select id, code_hash, attempts from merchant_login_codes
        where phone = ${phone} and purpose = 'signup' and consumed_at is null and expires_at > now()
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

/** VENDUA_SIGNUP_ACCESS_CODE: signup without Mercado Pago — the store waits on its first invoice
 *  and the team marks it paid in the CRM. Shorter than 12 characters counts as unset: guessable. */
export function signupAccessCode(): string | null {
  const code = process.env.VENDUA_SIGNUP_ACCESS_CODE?.trim() ?? '';
  return code.length >= 12 ? code : null;
}

export function accessCodeMatches(given: unknown): boolean {
  const want = signupAccessCode();
  if (!want || typeof given !== 'string' || given.length > 200) return false;
  return safeEq(sha256(given.trim()), sha256(want));
}

/** proof that a phone just verified, for the signup form (30 min) */
export function signupToken(secret: string, phone: string, now = Date.now()): string {
  const body = `${phone}.${now + TOKEN_TTL_MS}`;
  const sig = createHmac('sha256', secret).update(`vendua.signup|${body}`).digest('base64url');
  return `${body}.${sig}`;
}

export function readSignupToken(secret: string, token: unknown): string | null {
  if (typeof token !== 'string' || token.length > 200) return null;
  const [phone, exp, sig] = token.split('.');
  if (!phone || !exp || !sig || !/^\d{10,11}$/.test(phone) || Number(exp) < Date.now()) return null;
  const want = createHmac('sha256', secret)
    .update(`vendua.signup|${phone}.${exp}`)
    .digest('base64url');
  return safeEq(want, sig) ? phone : null;
}
