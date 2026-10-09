import type { DnsHost, DnsRecord, Zone } from './providers.ts';

// Cloudflare's v4 API (ADR 0038): one account holds every zone Venduá hosts. Records are DNS-only
// so traffic reaches the edge directly and Traefik issues the certificate.

export interface CloudflareOptions {
  token: string;
  accountId: string;
  fetchImpl?: typeof fetch;
}

const API = 'https://api.cloudflare.com/client/v4';
const TIMEOUT_MS = 20_000;
const PER_PAGE = 500;
const MAX_PAGES = 20;
const ID = /^[A-Za-z0-9_-]{1,64}$/;

type Json = Record<string, unknown>;

interface CfRecord {
  id: string;
  type: string;
  name: string;
  content: string;
  priority?: number;
}

class NotFound extends Error {
  constructor() {
    super('cloudflare: not found');
  }
}

const fqdnOf = (name: string, host: string) => {
  const n = name.trim().toLowerCase().replace(/\.$/, '');
  if (n === '@' || n === '' || n === host) return host;
  return n.endsWith(`.${host}`) ? n : `${n}.${host}`;
};

function content(type: string, value: string) {
  const v = value.trim();
  if (type === 'TXT')
    return v.length >= 2 && v.startsWith('"') && v.endsWith('"') ? v.slice(1, -1) : v;
  if (type === 'CNAME' || type === 'MX' || type === 'AAAA')
    return v.toLowerCase().replace(/\.$/, '');
  return v;
}

const key = (type: string, fqdn: string, value: string, priority: number | undefined) =>
  [type, fqdn.toLowerCase(), content(type, value), type === 'MX' ? (priority ?? 0) : ''].join('|');

function toZone(r: unknown): Zone {
  const z = (r ?? {}) as Json;
  if (typeof z.id !== 'string' || !z.id) throw new Error('cloudflare: zone without an id');
  return {
    id: z.id,
    nameServers: Array.isArray(z.name_servers)
      ? z.name_servers.filter((n): n is string => typeof n === 'string').map((n) => n.toLowerCase())
      : [],
    status: typeof z.status === 'string' ? z.status : 'pending',
  };
}

export function cloudflare(o: CloudflareOptions): DnsHost {
  const doFetch = o.fetchImpl ?? fetch;

  async function call(
    method: string,
    path: string,
    body?: unknown,
  ): Promise<{ result: unknown; info: Json | undefined }> {
    let res: Response;
    try {
      res = await doFetch(`${API}${path}`, {
        method,
        headers: {
          accept: 'application/json',
          authorization: `Bearer ${o.token}`,
          ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
        },
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch (err) {
      throw new Error(`cloudflare unreachable: ${(err as Error)?.name ?? 'error'}`);
    }
    const raw = await res.text().catch(() => '');
    let env: Json = {};
    try {
      env = raw ? ((JSON.parse(raw) as Json) ?? {}) : {};
    } catch {
      /* non-JSON: reported below by status */
    }
    const errors = Array.isArray(env.errors)
      ? (env.errors as { code?: unknown; message?: unknown }[])
      : [];
    // 7003: "could not route", what an unknown or malformed zone id answers
    if (res.status === 404 || errors.some((e) => e.code === 7003)) throw new NotFound();
    if (!res.ok || env.success !== true) {
      const msg =
        errors
          .map(
            (e) =>
              `${String(e.message ?? '').slice(0, 200)}${e.code !== undefined ? ` (${String(e.code)})` : ''}`,
          )
          .filter(Boolean)
          .join('; ') || `HTTP ${res.status}`;
      throw new Error(`cloudflare: ${msg}`.split(o.token).join('[redacted]').slice(0, 400));
    }
    return { result: env.result, info: env.result_info as Json | undefined };
  }

  async function findZone(host: string): Promise<Zone | null> {
    const q = new URLSearchParams({ name: host, 'account.id': o.accountId });
    const { result } = await call('GET', `/zones?${q}`);
    const first = Array.isArray(result) ? result[0] : undefined;
    return first ? toZone(first) : null;
  }

  async function listRecords(zoneId: string): Promise<CfRecord[]> {
    const out: CfRecord[] = [];
    for (let page = 1; page <= MAX_PAGES; page++) {
      const { result, info } = await call(
        'GET',
        `/zones/${zoneId}/dns_records?per_page=${PER_PAGE}&page=${page}`,
      );
      for (const r of Array.isArray(result) ? (result as Json[]) : [])
        if (typeof r.id === 'string' && typeof r.type === 'string')
          out.push({
            id: r.id,
            type: r.type,
            name: String(r.name ?? ''),
            content: String(r.content ?? ''),
            ...(typeof r.priority === 'number' ? { priority: r.priority } : {}),
          });
      const pages = typeof info?.total_pages === 'number' ? info.total_pages : 1;
      if (page >= pages) break;
    }
    return out;
  }

  const zoneId = (id: string) => {
    if (!ID.test(id)) throw new Error('cloudflare: invalid zone id');
    return id;
  };

  return {
    async ensureZone(host) {
      const name = host.trim().toLowerCase();
      const existing = await findZone(name);
      if (existing) return existing;
      try {
        const { result } = await call('POST', '/zones', {
          name,
          account: { id: o.accountId },
          type: 'full',
          jump_start: false,
        });
        return toZone(result);
      } catch (e) {
        // 1061: created by a concurrent attempt
        if (e instanceof Error && /\(1061\)/.test(e.message)) {
          const again = await findZone(name);
          if (again) return again;
        }
        throw e;
      }
    },

    findZone: (host) => findZone(host.trim().toLowerCase()),

    async zone(id) {
      if (!ID.test(id)) return null;
      try {
        return toZone((await call('GET', `/zones/${id}`)).result);
      } catch (e) {
        if (e instanceof NotFound) return null;
        throw e;
      }
    },

    async syncRecords(id, host, edge, records) {
      const zid = zoneId(id);
      const h = host.trim().toLowerCase();
      const desired: (DnsRecord & { fqdn: string })[] = [];
      for (const name of ['@', 'www']) {
        desired.push({ type: 'A', name, value: edge.ipv4, fqdn: fqdnOf(name, h) });
        if (edge.ipv6)
          desired.push({ type: 'AAAA', name, value: edge.ipv6, fqdn: fqdnOf(name, h) });
      }
      for (const r of records.slice(0, 200)) desired.push({ ...r, fqdn: fqdnOf(r.name, h) });

      const want = new Map<string, DnsRecord & { fqdn: string }>();
      for (const d of desired) want.set(key(d.type, d.fqdn, d.value, d.priority), d);

      const kept = new Set<string>();
      const extras: CfRecord[] = [];
      for (const r of await listRecords(zid)) {
        if (r.type === 'NS' || r.type === 'SOA') continue;
        const k = key(r.type, r.name, r.content, r.priority);
        if (want.has(k) && !kept.has(k)) kept.add(k);
        else extras.push(r);
      }
      // deletes first: a CNAME can't share a name with any other record
      for (const r of extras) {
        try {
          await call('DELETE', `/zones/${zid}/dns_records/${encodeURIComponent(r.id)}`);
        } catch (e) {
          if (!(e instanceof NotFound)) throw e;
        }
      }
      for (const [k, d] of want) {
        if (kept.has(k)) continue;
        const value =
          d.type === 'CNAME' || d.type === 'MX' ? d.value.trim().replace(/\.$/, '') : d.value;
        await call('POST', `/zones/${zid}/dns_records`, {
          type: d.type,
          name: d.fqdn,
          content: value,
          ttl: 1,
          ...(d.type === 'A' || d.type === 'AAAA' || d.type === 'CNAME' ? { proxied: false } : {}),
          ...(d.type === 'MX' ? { priority: d.priority ?? 0 } : {}),
        });
      }
    },

    async deleteZone(id) {
      if (!ID.test(id)) return;
      try {
        await call('DELETE', `/zones/${id}`);
      } catch (e) {
        if (!(e instanceof NotFound)) throw e;
      }
    },
  };
}
