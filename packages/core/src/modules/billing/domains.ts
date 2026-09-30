import { randomBytes } from 'node:crypto';
import dns from 'node:dns/promises';
import { emitAdminTx } from '../../admin/live.ts';
import { withTenant, type Sql } from '../../platform/db.ts';
import { HttpError } from '../../platform/http.ts';
import { platformHost } from '../../platform/store-origin.ts';
import { controlTx } from '../control.ts';
import { DAY_MS } from './invoices.ts';
import { billingStaff } from './subscriptions.ts';

// PRO+ own domain: the owner points a CNAME (or A records) at `<slug>.<storeDomain>` and adds
// TXT `_vendua.<host>` = `vendua-verify=<token>`. Core checks (pending_dns → dns_ok); the team
// turns TLS on and activates it in the CRM (activate_custom_domain) — only then it serves.

export interface DnsResolver {
  resolveCname(host: string): Promise<string[]>;
  resolve4(host: string): Promise<string[]>;
  resolveTxt(host: string): Promise<string[][]>;
}

let resolver: DnsResolver = dns;

/** tests stub DNS; null restores the system resolver */
export function setDnsResolver(r: DnsResolver | null) {
  resolver = r ?? dns;
}

export const DNS_GIVE_UP_MS = 7 * DAY_MS;
export const DNS_RECHECK_MS = 15 * 60_000;
const LOOKUP_TIMEOUT_MS = 5_000;

const HOST_RE = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/;

export interface CustomDomainRow {
  id: string;
  tenant_id: string;
  host: string;
  status: 'pending_dns' | 'dns_ok' | 'active' | 'failed';
  verify_token: string;
  last_checked_at: Date | null;
  last_error: string | null;
  activated_at: Date | null;
  created_at: Date;
}

/** "https://WWW.Loja.com.br/x" → "www.loja.com.br"; 422 when it can't be a store domain. */
export function normalizeHost(raw: unknown, storeDomain: string): string {
  const bad = (why: string) => new HttpError(422, 'INVALID_DOMAIN', why, { field: 'host' });
  if (typeof raw !== 'string' || raw.length > 300) throw bad('type a domain like minhaloja.com.br');
  const host = raw
    .trim()
    .toLowerCase()
    .replace(/^[a-z][a-z0-9+.-]*:\/\//, '')
    .replace(/[/?#:].*$/, '')
    .replace(/\.$/, '');
  if (!host || host.length > 253 || !HOST_RE.test(host))
    throw bad('type a domain like minhaloja.com.br');
  const tld = host.split('.').at(-1)!;
  if (!/^[a-z]{2,}$/.test(tld) && !/^xn--/.test(tld))
    throw bad('type a domain like minhaloja.com.br');
  const sd = storeDomain.toLowerCase();
  if (host === sd || host.endsWith(`.${sd}`) || host === 'localhost' || host.endsWith('.localhost'))
    throw bad('this address is already the store’s own — use a domain you registered');
  return host;
}

export const cnameTarget = (slug: string, storeDomain: string) => platformHost(slug, storeDomain);
export const txtName = (host: string) => `_vendua.${host}`;
export const txtValue = (token: string) => `vendua-verify=${token}`;

export function newVerifyToken() {
  return randomBytes(16).toString('hex');
}

/**
 * Is the host another store's (a live store host, or a claim whose DNS verified)? A claim
 * still waiting for DNS doesn't hold the host: whoever proves the TXT first gets it.
 */
export async function hostTaken(sql: Sql, host: string, tenantId: string) {
  return controlTx(sql, async (tx) => {
    const live = await tx`select 1 from domains where host = ${host} and tenant_id <> ${tenantId}`;
    if (live.length) return true;
    const claimed = await tx`
      select 1 from custom_domains
      where host = ${host} and tenant_id <> ${tenantId} and status in ('dns_ok', 'active')
    `;
    return claimed.length > 0;
  });
}

const LOST = 'Outra loja comprovou que é dona deste domínio.';

async function markLost(sql: Sql, tenantId: string, domainId: string, now: Date) {
  return withTenant(sql, tenantId, async (tx) => {
    const row = (
      await tx<CustomDomainRow[]>`
        update custom_domains set status = 'failed', last_checked_at = ${now}, last_error = ${LOST}
        where tenant_id = ${tenantId} and id = ${domainId} and status in ('pending_dns', 'failed')
        returning *
      `
    )[0];
    if (row) await emitAdminTx(tx, tenantId, 'billing');
    return row ?? null;
  });
}

const settle = <T>(p: Promise<T>, fallback: T) =>
  Promise.race([
    p.catch(() => fallback),
    new Promise<T>((r) => setTimeout(() => r(fallback), LOOKUP_TIMEOUT_MS)),
  ]);

const bare = (h: string) => h.toLowerCase().replace(/\.$/, '');

export async function lookupDns(
  host: string,
  target: string,
  token: string,
): Promise<{ ok: boolean; error: string | null }> {
  const [cnames, txts] = await Promise.all([
    settle(resolver.resolveCname(host), [] as string[]),
    settle(resolver.resolveTxt(txtName(host)), [] as string[][]),
  ]);
  let pointed = cnames.map(bare).some((c) => c === target || c.endsWith(`.${target}`));
  if (!pointed) {
    const [mine, theirs] = await Promise.all([
      settle(resolver.resolve4(host), [] as string[]),
      settle(resolver.resolve4(target), [] as string[]),
    ]);
    pointed = mine.length > 0 && theirs.length > 0 && mine.every((a) => theirs.includes(a));
  }
  const verified = txts.map((chunks) => chunks.join('')).includes(txtValue(token));
  if (!pointed) return { ok: false, error: `O domínio ainda não aponta para ${target}.` };
  if (!verified)
    return { ok: false, error: `O registro TXT ${txtName(host)} ainda não foi encontrado.` };
  return { ok: true, error: null };
}

/**
 * Check one domain and record the result. pending_dns → dns_ok tells the team once (the
 * status guard makes a second checker a no-op); 7 days without DNS → failed.
 */
export async function checkCustomDomain(
  sql: Sql,
  o: { tenantId: string; domainId: string; storeDomain: string; now: Date; manual?: boolean },
): Promise<CustomDomainRow | null> {
  const found = await withTenant(sql, o.tenantId, async (tx) => {
    const row = (
      await tx<(CustomDomainRow & { slug: string; tname: string })[]>`
        select d.*, t.slug, t.name as tname from custom_domains d join tenants t on t.id = d.tenant_id
        where d.tenant_id = ${o.tenantId} and d.id = ${o.domainId}
      `
    )[0];
    return row ?? null;
  });
  if (!found) return null;
  if (found.status === 'active' || found.status === 'dns_ok') return found;
  if (found.status === 'failed' && !o.manual) return found;
  if (await hostTaken(sql, found.host, o.tenantId))
    return (await markLost(sql, o.tenantId, o.domainId, o.now)) ?? found;
  const target = cnameTarget(found.slug, o.storeDomain);
  const res = await lookupDns(found.host, target, found.verify_token);
  const expired = o.now.getTime() - found.created_at.getTime() > DNS_GIVE_UP_MS;
  const status = res.ok
    ? 'dns_ok'
    : found.status === 'pending_dns' && expired
      ? 'failed'
      : found.status;
  let updated: CustomDomainRow | null;
  try {
    updated = await withTenant(sql, o.tenantId, async (tx) => {
      const row = (
        await tx<CustomDomainRow[]>`
          update custom_domains set status = ${status}, last_checked_at = ${o.now},
            last_error = ${res.error?.slice(0, 200) ?? null}
          where tenant_id = ${o.tenantId} and id = ${o.domainId} and status = ${found.status}
          returning *
        `
      )[0];
      if (row) await emitAdminTx(tx, o.tenantId, 'billing');
      return row ?? null;
    });
  } catch (err) {
    // another store verified the same host a moment earlier (one verified row per host)
    if ((err as { code?: string }).code !== '23505') throw err;
    return (await markLost(sql, o.tenantId, o.domainId, o.now)) ?? found;
  }
  if (updated?.status === 'dns_ok') {
    // the other stores waiting on this host lost it
    const losers = await controlTx(
      sql,
      (tx) => tx<{ tenant_id: string }[]>`
        update custom_domains set status = 'failed', last_checked_at = ${o.now}, last_error = ${LOST}
        where host = ${found.host} and tenant_id <> ${o.tenantId} and status = 'pending_dns'
        returning tenant_id
      `,
    );
    for (const l of losers)
      await withTenant(sql, l.tenant_id, (tx) => emitAdminTx(tx, l.tenant_id, 'billing'));
  }
  if (updated?.status === 'dns_ok')
    await billingStaff
      .notify(sql, {
        subject: `Domínio pronto: ${found.host}`,
        body: `A loja ${found.tname} (${found.slug}) apontou ${found.host} para ${target}. Ligue o TLS e ative o domínio no CRM.`,
        idemKey: `custom-domain:${found.id}:dns_ok`,
      })
      .catch(() => undefined);
  return updated ?? found;
}
