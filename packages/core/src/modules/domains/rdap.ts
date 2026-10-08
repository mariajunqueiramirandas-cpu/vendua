import type { Rdap, RdapInfo } from './providers.ts';

// registro.br's public RDAP: 404 for a free name, events and nameservers for a registered one.

const BASE = 'https://rdap.registro.br/domain/';
const TIMEOUT_MS = 8_000;
const MAX_BODY = 256 * 1024;
const HOST = /^(?=.{1,253}$)[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9-]{1,63})+$/;

type Json = Record<string, unknown>;

/** The body as JSON, or null when it's larger than `max` bytes or not JSON. */
export async function readJsonCapped(res: Response, max: number): Promise<unknown> {
  if (Number(res.headers.get('content-length')) > max || !res.body) {
    await res.body?.cancel().catch(() => {});
    return null;
  }
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > max) {
      await reader.cancel().catch(() => {});
      return null;
    }
    chunks.push(value);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;
  } catch {
    return null;
  }
}

export function parseRdap(body: unknown): RdapInfo | null {
  if (!body || typeof body !== 'object') return null;
  const j = body as Json;
  const events = Array.isArray(j.events) ? (j.events as Json[]) : [];
  const exp = events.find((e) => e?.eventAction === 'expiration')?.eventDate;
  const expiresAt = typeof exp === 'string' ? new Date(exp) : null;
  const nameServers = (Array.isArray(j.nameservers) ? (j.nameservers as Json[]) : [])
    .map((n) => n?.ldhName)
    .filter((n): n is string => typeof n === 'string' && n.length > 0)
    .map((n) => n.toLowerCase().replace(/\.$/, ''))
    .slice(0, 20);
  return {
    registered: true,
    expiresAt: expiresAt && !Number.isNaN(expiresAt.getTime()) ? expiresAt : null,
    nameServers,
    signed: (j.secureDNS as Json | undefined)?.delegationSigned === true,
  };
}

export function registroBrRdap(o: { fetchImpl?: typeof fetch } = {}): Rdap {
  const doFetch = o.fetchImpl ?? fetch;
  return async (host) => {
    const h = host.trim().toLowerCase().replace(/\.$/, '');
    if (!HOST.test(h) || !h.endsWith('.br')) return null;
    try {
      const res = await doFetch(`${BASE}${h}`, {
        headers: { accept: 'application/rdap+json, application/json' },
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      if (res.status === 404) {
        await res.body?.cancel().catch(() => {});
        return { registered: false, expiresAt: null, nameServers: [], signed: false };
      }
      if (res.status !== 200) {
        await res.body?.cancel().catch(() => {});
        return null;
      }
      return parseRdap(await readJsonCapped(res, MAX_BODY));
    } catch {
      return null;
    }
  };
}
