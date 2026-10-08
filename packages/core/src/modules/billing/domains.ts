import { randomBytes } from 'node:crypto';
import dns from 'node:dns/promises';
import { emitAdminTx } from '../../admin/live.ts';
import { withTenant, type Sql } from '../../platform/db.ts';
import { HttpError } from '../../platform/http.ts';
import { platformHost } from '../../platform/store-origin.ts';
import { controlTx } from '../control.ts';
import type { Rdap } from '../domains/providers.ts';
import { recordStaffEventTx } from '../staff-events.ts';
import { DAY_MS } from './invoices.ts';

// Pangolim's own domain (ADR 0038). Method `cname`: the owner points a CNAME (or A records) at
// `<slug>.<storeDomain>` and adds TXT `_vendua.<host>` = `vendua-verify=<token>`. Method `ns`: the
// owner delegates the domain's nameservers to the zone Venduá hosts. Core checks (pending_dns →
// dns_ok); the domain jobs then get the certificate issued and switch the host on.

export interface DnsResolver {
  resolveCname(host: string): Promise<string[]>;
  resolve4(host: string): Promise<string[]>;
  resolveTxt(host: string): Promise<string[][]>;
  resolve6?(host: string): Promise<string[]>;
  resolveCaa?(
    host: string,
  ): Promise<{ issue?: string | undefined; issuewild?: string | undefined }[]>;
  resolveNs?(host: string): Promise<string[]>;
  resolveMx?(host: string): Promise<{ exchange: string; priority: number }[]>;
}

let resolver: DnsResolver = dns;

/** tests stub DNS; null restores the system resolver */
export function setDnsResolver(r: DnsResolver | null) {
  resolver = r ?? dns;
}

export function dnsResolver(): DnsResolver {
  return resolver;
}

export const DNS_GIVE_UP_MS = 7 * DAY_MS;
export const DNS_RECHECK_MS = 15 * 60_000;
const LOOKUP_TIMEOUT_MS = 5_000;

const HOST_RE = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/;

export type CustomDomainStatus =
  'ordering' | 'pending_dns' | 'dns_ok' | 'active' | 'repairing' | 'lapsed' | 'failed' | 'removing';

/** Statuses that hold the host (and its alias) against every other store. */
export const HELD_STATUSES = [
  'ordering',
  'dns_ok',
  'active',
  'repairing',
  'lapsed',
  'removing',
] as const;

export interface CustomDomainRow {
  id: string;
  tenant_id: string;
  host: string;
  status: CustomDomainStatus;
  verify_token: string;
  last_checked_at: Date | null;
  last_error: string | null;
  activated_at: Date | null;
  created_at: Date;
  source: 'connected' | 'included';
  method: 'cname' | 'ns';
  alias_host: string | null;
  alias_ok: boolean;
  zone_id: string | null;
  zone_claimed_at: Date | null;
  name_servers: string[];
  records: unknown;
  records_confirmed_at: Date | null;
  records_updated_at: Date | null;
  records_synced_at: Date | null;
  dnssec_signed: boolean;
  registrar_ref: string | null;
  expires_at: Date | null;
  rdap_checked_at: Date | null;
  dns_ok_at: Date | null;
  tls_ok_at: Date | null;
  miss_count: number;
  lapsed_at: Date | null;
  expiry_notice: number | null;
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
 * Is the host another store's (a live store host, or a claim that holds it: verified, ordered,
 * live, under repair or lapsed — as a domain or as its www./root alias — or, for a store that
 * would delegate it, one that has a zone in Venduá's Cloudflare account)? Any other claim still
 * waiting for DNS doesn't hold the host: whoever proves it first gets it. An unverified zone claim
 * only stops another delegation (one zone per name); a store that proves the name with a CNAME
 * and TXT (`method: 'cname'`) or buys it at the registry (`registering`) gets past it.
 */
export async function hostTaken(
  sql: Sql,
  host: string,
  tenantId: string,
  o: { registering?: boolean; method?: 'cname' | 'ns' } = {},
) {
  return controlTx(sql, async (tx) => {
    const live = await tx`select 1 from domains where host = ${host} and tenant_id <> ${tenantId}`;
    if (live.length) return true;
    // a zone in Venduá's Cloudflare account holds its name too, verified or not
    const claimed = await tx`
      select 1 from custom_domains
      where (host = ${host} or alias_host = ${host}) and tenant_id <> ${tenantId}
        and (status in ${tx(HELD_STATUSES)} or (${!o.registering && o.method !== 'cname'} and status = 'pending_dns' and zone_id is not null and host = ${host}))
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

export const settle = <T>(p: Promise<T>, fallback: T, ms = LOOKUP_TIMEOUT_MS) =>
  Promise.race([p.catch(() => fallback), new Promise<T>((r) => setTimeout(() => r(fallback), ms))]);

const bare = (h: string) => h.toLowerCase().replace(/\.$/, '');

/** Does `host` reach the platform host `target` (a CNAME to it, or A records that are all its
 *  addresses or the edge's own, `edgeIps`)? */
export async function pointsAt(
  host: string,
  target: string,
  edgeIps: readonly string[] = [],
): Promise<boolean> {
  const cnames = await settle(resolver.resolveCname(host), [] as string[]);
  if (cnames.map(bare).some((c) => c === target || c.endsWith(`.${target}`))) return true;
  const [mine, theirs] = await Promise.all([
    settle(resolver.resolve4(host), [] as string[]),
    settle(resolver.resolve4(target), [] as string[]),
  ]);
  const ours = [...theirs, ...edgeIps];
  return mine.length > 0 && ours.length > 0 && mine.every((a) => ours.includes(a));
}

/**
 * What would stop Let's Encrypt from validating `host` once it points at us: an AAAA (IPv6) record
 * that isn't ours (it's tried first), or a CAA record that doesn't allow letsencrypt.org.
 */
export async function certBlocker(host: string, target: string): Promise<string | null> {
  if (resolver.resolve6) {
    const [mine, theirs] = await Promise.all([
      settle(resolver.resolve6(host), [] as string[]),
      settle(resolver.resolve6(target), [] as string[]),
    ]);
    if (mine.some((a) => !theirs.includes(a)))
      return `O domínio tem um registro AAAA (IPv6) que não aponta para a Venduá. Apague o registro AAAA de ${host}.`;
  }
  if (resolver.resolveCaa) {
    // CAA is inherited: the closest name that has any decides
    const labels = host.split('.');
    for (let i = 0; i < labels.length - 1; i++) {
      const name = labels.slice(i).join('.');
      const caa = await settle(resolver.resolveCaa(name), []);
      const issuers = caa.flatMap((r) => (r.issue !== undefined ? [r.issue] : []));
      if (!caa.length) continue;
      // the issuer is the value's domain, before any `;` parameters
      const allowed = issuers.some(
        (v) => v.split(';')[0]!.trim().toLowerCase() === 'letsencrypt.org',
      );
      if (issuers.length && !allowed)
        return `O registro CAA de ${name} não permite a Let's Encrypt. Inclua "letsencrypt.org" nele ou apague-o.`;
      break;
    }
  }
  return null;
}

export async function lookupDns(
  host: string,
  target: string,
  token: string,
  edgeIps: readonly string[] = [],
): Promise<{ ok: boolean; error: string | null }> {
  const [pointed, txts] = await Promise.all([
    pointsAt(host, target, edgeIps),
    settle(resolver.resolveTxt(txtName(host)), [] as string[][]),
  ]);
  const verified = txts.map((chunks) => chunks.join('')).includes(txtValue(token));
  if (!pointed) return { ok: false, error: `O domínio ainda não aponta para ${target}.` };
  if (!verified)
    return { ok: false, error: `O registro TXT ${txtName(host)} ainda não foi encontrado.` };
  const blocked = await certBlocker(host, target);
  if (blocked) return { ok: false, error: blocked };
  return { ok: true, error: null };
}

/** Are the domain's nameservers the ones Cloudflare assigned to its zone (and nothing else)? */
export async function delegated(host: string, nameServers: string[]): Promise<boolean> {
  if (!resolver.resolveNs || !nameServers.length) return false;
  const got = (await settle(resolver.resolveNs(host), [] as string[])).map(bare);
  const want = nameServers.map(bare);
  // exactly the assigned set: one of the pair alone isn't a delegation Cloudflare accepts
  const g = new Set(got);
  return g.size === new Set(want).size && want.every((n) => g.has(n));
}

/**
 * Does the domain already name any of `nameServers` (the registry's record, or DNS)? Cloudflare
 * gives every zone in an account the same pair, so a delegation that is there before a row's zone
 * holds anything is someone else's — a domain another store removed — not proof of control.
 */
export async function delegatedAlready(
  host: string,
  nameServers: string[],
  rdap: Rdap | undefined,
): Promise<boolean> {
  const want = new Set(nameServers.map(bare));
  if (!want.size) return false;
  const [info, got] = await Promise.all([
    rdap ? rdap(host).catch(() => null) : null,
    resolver.resolveNs ? settle(resolver.resolveNs(host), [] as string[]) : [],
  ]);
  return [...(info?.nameServers ?? []), ...got].some((n) => want.has(bare(n)));
}

async function checkDelegation(
  row: CustomDomainRow,
  rdap: Rdap | undefined,
): Promise<{ ok: boolean; error: string | null; signed: boolean }> {
  if (!row.zone_id || !row.name_servers.length) return { ok: false, error: null, signed: false };
  const info = rdap ? await rdap(row.host).catch(() => null) : null;
  const signed = info?.signed ?? false;
  if (await delegated(row.host, row.name_servers)) return { ok: true, error: null, signed };
  if (signed)
    return {
      ok: false,
      signed,
      error:
        'O domínio está com DNSSEC ligado no Registro.br. Desligue o DNSSEC antes de trocar os servidores.',
    };
  return {
    ok: false,
    signed,
    error: `Os servidores DNS do domínio ainda não são ${row.name_servers.join(' e ')}.`,
  };
}

/**
 * Check one domain and record the result. pending_dns → dns_ok tells the team once (the
 * status guard makes a second checker a no-op); 7 days without DNS → failed.
 */
export async function checkCustomDomain(
  sql: Sql,
  o: {
    tenantId: string;
    domainId: string;
    storeDomain: string;
    now: Date;
    manual?: boolean;
    rdap?: Rdap;
    /** the VPS's public addresses: A records straight at them count as pointing */
    edgeIps?: readonly string[];
  },
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
  if (found.status !== 'pending_dns' && found.status !== 'failed') return found;
  if (found.status === 'failed' && !o.manual) return found;
  if (await hostTaken(sql, found.host, o.tenantId, { method: found.method }))
    return (await markLost(sql, o.tenantId, o.domainId, o.now)) ?? found;
  const target = cnameTarget(found.slug, o.storeDomain);
  let res: { ok: boolean; error: string | null };
  let aliasOk = false;
  let signed = found.dnssec_signed;
  if (found.method === 'ns') {
    const d = await checkDelegation(found, o.rdap);
    res = d;
    signed = d.signed;
    // the zone holds www too: delegation covers both names
    aliasOk = d.ok && !!found.alias_host;
  } else {
    res = await lookupDns(found.host, target, found.verify_token, o.edgeIps);
    if (res.ok && found.alias_host)
      aliasOk =
        (await pointsAt(found.alias_host, target, o.edgeIps)) &&
        !(await certBlocker(found.alias_host, target)) &&
        !(await hostTaken(sql, found.alias_host, o.tenantId, { method: found.method }));
  }
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
            last_error = ${res.error?.slice(0, 200) ?? null}, dnssec_signed = ${signed},
            alias_ok = ${aliasOk},
            dns_ok_at = ${status === 'dns_ok' ? o.now : null}
          where tenant_id = ${o.tenantId} and id = ${o.domainId} and status = ${found.status}
          returning *
        `
      )[0];
      if (row) await emitAdminTx(tx, o.tenantId, 'billing');
      if (row?.status === 'dns_ok') {
        await recordStaffEventTx(
          tx,
          'domain.ready',
          { storeName: found.tname, host: found.host },
          { tenantId: o.tenantId, dedupeKey: `domain.ready:${found.id}` },
        );
        await recordStaffEventTx(
          tx,
          'store.onboarding',
          { step: 'domain' },
          { tenantId: o.tenantId, dedupeKey: `onboarding:${o.tenantId}:domain` },
        );
      }
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
        where (host = ${found.host} or host = ${found.alias_host ?? found.host})
          and tenant_id <> ${o.tenantId} and status = 'pending_dns'
        returning tenant_id
      `,
    );
    for (const l of losers)
      await withTenant(sql, l.tenant_id, (tx) => emitAdminTx(tx, l.tenant_id, 'billing'));
  }
  return updated ?? found;
}
