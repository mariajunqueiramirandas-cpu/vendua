import { log } from '../../platform/log.ts';
import {
  RegistrarError,
  type Availability,
  type HolderInput,
  type Registrar,
  type RegistrarDomain,
} from './providers.ts';

// Openprovider's REST API (ADR 0038): a reseller accredited at registro.br. Every answer is an
// envelope { code, desc, data }, code 0 = ok; the bearer token comes from /auth/login and lasts
// hours, so it is cached and refreshed once when a call gets 401.

export interface OpenproviderOptions {
  url?: string;
  username: string;
  password: string;
  /** Venduá's own handle: admin, tech and billing contact of every domain */
  contactHandle: string;
  fetchImpl?: typeof fetch;
}

const DEFAULT_URL = 'https://api.openprovider.eu';
const TIMEOUT_MS = 20_000;
const CHECK_BATCH = 15;
// Openprovider's own DNS: the registry wants answering nameservers before it registers
const PARKING_NS = ['ns1.openprovider.nl', 'ns2.openprovider.be', 'ns3.openprovider.eu'];
const HOST = /^(?=.{1,253}$)[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9-]{1,63})+$/;

const olog = log.child({ mod: 'openprovider' });

type Json = Record<string, unknown>;

/** 'loja.com.br' → { name: 'loja', extension: 'com.br' } */
export function splitHost(host: string) {
  const h = host.trim().toLowerCase();
  if (!HOST.test(h)) throw new RegistrarError(`invalid host`, 'invalid');
  const dot = h.indexOf('.');
  return { name: h.slice(0, dot), extension: h.slice(dot + 1) };
}

/** 14 characters (digits or, since 2026, letters too) as NN.NNN.NNN/NNNN-NN */
export function maskCnpj(doc: string) {
  const d = doc.replace(/[^0-9a-z]/gi, '').toUpperCase();
  return `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8, 12)}-${d.slice(12, 14)}`;
}

export function maskCpf(doc: string) {
  const d = doc.replace(/\D/g, '');
  return `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6, 9)}-${d.slice(9, 11)}`;
}

export function domainStatus(s: unknown): RegistrarDomain['status'] {
  switch (s) {
    case 'ACT':
      return 'active';
    case 'REQ':
    case 'PEN':
    case 'SCH':
      return 'pending';
    case 'FAI':
    case 'DEL':
      return 'failed';
    default:
      olog.warn({ status: String(s).slice(0, 20) }, 'unknown domain status, read as failed');
      return 'failed';
  }
}

/** Openprovider's dates ('2027-10-08 00:00:00') are UTC without a zone. */
export function opDate(s: unknown): Date | null {
  if (typeof s !== 'string' || !s.trim()) return null;
  const iso = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(s.trim())
    ? `${s.trim().replace(' ', 'T')}Z`
    : s.trim();
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d;
}

export function errorKind(desc: string, httpStatus: number, maintenance: boolean) {
  if (maintenance || httpStatus === 429 || httpStatus >= 500) return 'unavailable' as const;
  if (
    /provedor|(another|other|different)\s+(provider|registrar)|(cpf|cnpj|document).{0,80}(provider|registrar)/i.test(
      desc,
    )
  )
    return 'conflict' as const;
  if (
    /domain.{0,40}(already )?(exists|taken|registered|not free|not available)|already (exists|registered|taken)|not free/i.test(
      desc,
    )
  )
    return 'taken' as const;
  if (/invalid|validation|not valid|incorrect|required|must be|format|cpf|cnpj/i.test(desc))
    return 'invalid' as const;
  return 'other' as const;
}

function toDomain(d: unknown): RegistrarDomain {
  const r = (d ?? {}) as Json;
  if (r.id === undefined || r.id === null || r.id === '')
    throw new RegistrarError('openprovider answered without a domain id', 'other');
  return {
    ref: String(r.id),
    status: domainStatus(r.status),
    expiresAt: opDate(r.expiration_date) ?? opDate(r.registry_expiration_date),
  };
}

function refId(ref: string) {
  if (!/^\d{1,20}$/.test(ref)) throw new RegistrarError('invalid domain reference', 'invalid');
  return Number(ref);
}

const cut = (s: string | undefined, n: number) => (s ?? '').trim().slice(0, n);

export function openprovider(o: OpenproviderOptions): Registrar {
  const base = (o.url || DEFAULT_URL).replace(/\/+$/, '');
  const doFetch = o.fetchImpl ?? fetch;
  let token: Promise<string> | null = null;

  // Openprovider's desc never should carry our secrets, but a message ends up in logs and rows
  const scrub = (msg: string, tok?: string) => {
    let m = msg;
    for (const s of [o.password, tok]) if (s && s.length >= 4) m = m.split(s).join('[redacted]');
    return m.slice(0, 300);
  };

  async function send(
    method: string,
    path: string,
    body: unknown,
    bearer: string | null,
  ): Promise<{ status: number; env: Json }> {
    const headers: Record<string, string> = { accept: 'application/json' };
    if (bearer) headers.authorization = `Bearer ${bearer}`;
    if (body !== undefined) headers['content-type'] = 'application/json';
    let res: Response;
    try {
      res = await doFetch(`${base}${path}`, {
        method,
        headers,
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch (err) {
      throw new RegistrarError(
        `openprovider unreachable: ${(err as Error)?.name ?? 'error'}`,
        'unavailable',
      );
    }
    const raw = await res.text().catch(() => '');
    let env: Json = {};
    try {
      env = raw ? ((JSON.parse(raw) as Json) ?? {}) : {};
    } catch {
      if (res.ok || res.status >= 500)
        throw new RegistrarError(
          `openprovider sent a non-JSON answer (${res.status})`,
          'unavailable',
        );
    }
    return { status: res.status, env: typeof env === 'object' ? env : {} };
  }

  function fail(status: number, env: Json, tok?: string): never {
    const desc = String(env.desc ?? '').slice(0, 500) || `HTTP ${status}`;
    const kind = errorKind(desc, status, env.maintenance === true);
    const code = env.code !== undefined ? ` (code ${String(env.code).slice(0, 12)})` : '';
    throw new RegistrarError(scrub(`openprovider: ${desc}${code}`, tok), kind);
  }

  function login(): Promise<string> {
    token ??= (async () => {
      const { status, env } = await send(
        'POST',
        '/v1/auth/login',
        { username: o.username, password: o.password, ip: '0.0.0.0' },
        null,
      );
      const t = (env.data as Json | undefined)?.token;
      if (status >= 400 || env.code !== 0 || typeof t !== 'string' || !t) {
        // bad credentials are an operator problem: queued orders wait instead of failing
        const desc = String(env.desc ?? `HTTP ${status}`).slice(0, 200);
        throw new RegistrarError(scrub(`openprovider login failed: ${desc}`), 'unavailable');
      }
      return t;
    })();
    const p = token;
    p.catch(() => {
      if (token === p) token = null;
    });
    return p;
  }

  async function call(method: string, path: string, body?: unknown): Promise<unknown> {
    for (let attempt = 0; ; attempt++) {
      const tok = await login();
      const { status, env } = await send(method, path, body, tok);
      if (status === 401 && attempt === 0) {
        if (token) token = null;
        continue;
      }
      if (status >= 400 || env.code !== 0) fail(status, env, tok);
      return env.data;
    }
  }

  async function get(ref: string) {
    return toDomain(await call('GET', `/v1/domains/${refId(ref)}`));
  }

  return {
    async check(hosts) {
      const out = new Map<string, Availability>();
      const valid: string[] = [];
      for (const h of hosts.slice(0, 100)) {
        const host = h.trim().toLowerCase();
        if (out.has(host)) continue;
        out.set(host, { available: null });
        if (HOST.test(host)) valid.push(host);
      }
      for (let i = 0; i < valid.length; i += CHECK_BATCH) {
        const batch = valid.slice(i, i + CHECK_BATCH);
        const data = (await call('POST', '/v1/domains/check', {
          domains: batch.map(splitHost),
          with_price: true,
        })) as Json | undefined;
        const results = Array.isArray(data?.results) ? (data.results as Json[]) : [];
        for (const r of results) {
          const host = String(r.domain ?? '').toLowerCase();
          if (!out.has(host)) continue;
          const available = r.status === 'free' ? true : r.status === 'active' ? false : null;
          const reseller = (r.price as Json | undefined)?.reseller as Json | undefined;
          const price =
            typeof reseller?.price === 'number' &&
            Number.isFinite(reseller.price) &&
            typeof reseller.currency === 'string'
              ? { cents: Math.round(reseller.price * 100), currency: reseller.currency }
              : null;
          out.set(host, price ? { available, price } : { available });
        }
      }
      return out;
    },

    async find(host) {
      const { name, extension } = splitHost(host);
      const q = new URLSearchParams({
        domain_name_pattern: name,
        extension,
        limit: '10',
      });
      const data = (await call('GET', `/v1/domains?${q}`)) as Json | undefined;
      const results = Array.isArray(data?.results) ? (data.results as Json[]) : [];
      const matches = results.filter((r) => {
        const d = (r.domain ?? {}) as Json;
        return (
          String(d.name ?? '').toLowerCase() === name &&
          String(d.extension ?? '').toLowerCase() === extension
        );
      });
      if (!matches.length) return null;
      const domains = matches.map(toDomain);
      return domains.find((d) => d.status !== 'failed') ?? domains[0]!;
    },

    async createHolder(h: HolderInput) {
      const full = cut(h.name, 200).split(/\s+/).filter(Boolean);
      const first = full[0] ?? '';
      const last = full.slice(1).join(' ') || first;
      const phone = h.phone.replace(/\D/g, '').slice(0, 11);
      const suffix = [cut(h.address.complement, 100), cut(h.address.district, 100)]
        .filter(Boolean)
        .join(' - ');
      const cep = h.address.postalCode.replace(/\D/g, '').slice(0, 8);
      const body: Json = {
        name: { first_name: first.slice(0, 100), last_name: last.slice(0, 100) },
        address: {
          street: cut(h.address.street, 200),
          number: cut(h.address.number, 20),
          ...(suffix ? { suffix } : {}),
          zipcode: `${cep.slice(0, 5)}-${cep.slice(5)}`,
          city: cut(h.address.city, 100),
          state: cut(h.address.state, 2).toUpperCase(),
          country: 'BR',
        },
        phone: {
          country_code: '+55',
          area_code: phone.slice(0, 2),
          subscriber_number: phone.slice(2),
        },
        email: cut(h.email, 254),
        ...(h.kind === 'cnpj'
          ? {
              company_name: cut(h.name, 200),
              additional_data: { company_registration_number: maskCnpj(h.document) },
            }
          : { additional_data: { social_security_number: maskCpf(h.document) } }),
      };
      const data = (await call('POST', '/v1/customers', body)) as Json | undefined;
      const handle = data?.handle;
      if (typeof handle !== 'string' || !handle)
        throw new RegistrarError('openprovider answered without a customer handle', 'other');
      return handle;
    },

    async parkZone(host, ipv4, ipv6) {
      const domain = splitHost(host);
      const fqdn = `${domain.name}.${domain.extension}`;
      try {
        await call('GET', `/v1/dns/zones/${encodeURIComponent(fqdn)}`);
        return;
      } catch (e) {
        if (e instanceof RegistrarError && e.kind === 'unavailable') throw e;
      }
      const records = [
        { type: 'A', name: '', value: ipv4, ttl: 900 },
        { type: 'A', name: 'www', value: ipv4, ttl: 900 },
        ...(ipv6
          ? [
              { type: 'AAAA', name: '', value: ipv6, ttl: 900 },
              { type: 'AAAA', name: 'www', value: ipv6, ttl: 900 },
            ]
          : []),
      ];
      try {
        await call('POST', '/v1/dns/zones', { domain, type: 'master', records });
      } catch (e) {
        // created by a previous attempt the GET didn't see
        if (e instanceof RegistrarError && /exist/i.test(e.message)) return;
        throw e;
      }
    },

    async register({ host, holderHandle }) {
      const data = await call('POST', '/v1/domains', {
        domain: splitHost(host),
        period: 1,
        unit: 'y',
        owner_handle: holderHandle,
        admin_handle: o.contactHandle,
        tech_handle: o.contactHandle,
        billing_handle: o.contactHandle,
        name_servers: PARKING_NS.map((name, i) => ({ name, seq_nr: i + 1 })),
        autorenew: 'off',
      });
      return toDomain(data);
    },

    get,

    async renew(ref, host) {
      const id = refId(ref);
      await call('POST', `/v1/domains/${id}/renew`, { id, domain: splitHost(host), period: 1 });
      return get(ref);
    },

    async setNameservers(ref, host, nameServers) {
      const id = refId(ref);
      const ns = nameServers.map((n) => n.trim().toLowerCase().replace(/\.$/, ''));
      if (ns.length < 2 || ns.length > 13 || ns.some((n) => !HOST.test(n)))
        throw new RegistrarError('invalid nameservers', 'invalid');
      await call('PUT', `/v1/domains/${id}`, {
        id,
        domain: splitHost(host),
        name_servers: ns.map((name, i) => ({ name, seq_nr: i + 1 })),
      });
    },
  };
}
