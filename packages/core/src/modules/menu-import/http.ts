// The menu import's only outbound HTTP (docs/menu-import.md §4.5). Every request goes to a host
// the adapter declared, on a URL the adapter built; redirects are followed by hand and
// re-checked. A block is reported, never worked around: no cookies, no browser emulation.

export type FailCode = 'NOT_FOUND' | 'BLOCKED' | 'UNREADABLE' | 'TOO_LARGE' | 'TIMEOUT';

/** Why an import stopped; `code` lands on the row, the message only in logs. */
export class ImportFailure extends Error {
  constructor(
    public code: FailCode,
    message: string,
  ) {
    super(message);
  }
}

export const USER_AGENT = 'Vendua-Import/1.0 (+https://vendua.com.br; importa o cardapio da loja)';

export const LIMITS = {
  requestMs: 10_000,
  importMs: 60_000,
  jsonBytes: 5 * 1024 * 1024,
  imageBytes: 8 * 1024 * 1024,
  requests: 300,
  hostGapMs: 250,
  redirects: 3,
};

type Fetch = (input: string, init: RequestInit) => Promise<Response>;

export interface ImportHttp {
  /** GET a JSON document from an allowlisted host. */
  json(url: string, headers?: Record<string, string>): Promise<unknown>;
  /** requests spent so far */
  readonly used: number;
}

export interface HttpOptions {
  hosts: string[];
  fetch?: Fetch;
  /** overall deadline (epoch ms); defaults to now + LIMITS.importMs */
  deadline?: number;
  maxRequests?: number;
}

// one schedule per host for the whole process, so concurrent imports pace together
const nextSlot = new Map<string, number>();

async function paced(host: string): Promise<void> {
  const now = Date.now();
  const at = Math.max(now, nextSlot.get(host) ?? 0);
  nextSlot.set(host, at + LIMITS.hostGapMs);
  if (nextSlot.size > 500) for (const [h, t] of nextSlot) if (t < now) nextSlot.delete(h);
  if (at > now) await new Promise((r) => setTimeout(r, at - now));
}

/** An entry is a host, or a host and a path prefix ("storage.googleapis.com/bucket/") for a
 *  host many tenants share. */
const covers = (entry: string, u: URL) => {
  const slash = entry.indexOf('/');
  if (slash < 0) return entry === u.hostname;
  return entry.slice(0, slash) === u.hostname && u.pathname.startsWith(entry.slice(slash));
};

function allowed(raw: string, hosts: string[]): URL {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    throw new ImportFailure('UNREADABLE', 'adapter built an invalid url');
  }
  if (
    u.protocol !== 'https:' ||
    u.username ||
    u.password ||
    u.port ||
    !hosts.some((h) => covers(h, u))
  )
    throw new ImportFailure('BLOCKED', `host not allowlisted: ${u.hostname}`);
  return u;
}

/** Status → failure; null when the response is usable. */
function failureFor(status: number): ImportFailure | null {
  if (status >= 200 && status < 300) return null;
  if (status === 404 || status === 410) return new ImportFailure('NOT_FOUND', `http ${status}`);
  if (status === 401 || status === 403 || status === 429 || status === 503)
    return new ImportFailure('BLOCKED', `http ${status}`);
  return new ImportFailure('UNREADABLE', `http ${status}`);
}

async function readCapped(res: Response, max: number): Promise<Uint8Array> {
  const declared = Number(res.headers.get('content-length') ?? '');
  if (Number.isFinite(declared) && declared > max) {
    await res.body?.cancel();
    throw new ImportFailure('TOO_LARGE', `response declares ${declared} bytes`);
  }
  if (!res.body) return new Uint8Array();
  const reader = res.body.getReader();
  const parts: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read().catch((e: Error) => {
      throw e?.name === 'TimeoutError' || e?.name === 'AbortError'
        ? new ImportFailure('TIMEOUT', 'timed out reading the body')
        : new ImportFailure('UNREADABLE', 'body read failed');
    });
    if (done) break;
    size += value.byteLength;
    if (size > max) {
      await reader.cancel();
      throw new ImportFailure('TOO_LARGE', `response over ${max} bytes`);
    }
    parts.push(value);
  }
  const out = new Uint8Array(size);
  let off = 0;
  for (const p of parts) {
    out.set(p, off);
    off += p.byteLength;
  }
  return out;
}

const CHALLENGE =
  /cf-chl|challenge-platform|just a moment|attention required|sorry, you have been blocked/i;

interface Got {
  res: Response;
  url: URL;
}

/** One GET with manual, re-checked redirects; the caller reads the body. */
async function get(
  raw: string,
  hosts: string[],
  opts: { fetch: Fetch; deadline: number; headers: Record<string, string>; accept: string },
  spend: () => void,
): Promise<Got> {
  let url = allowed(raw, hosts);
  for (let hop = 0; ; hop++) {
    const left = opts.deadline - Date.now();
    if (left <= 0) throw new ImportFailure('TIMEOUT', 'import deadline passed');
    spend();
    await paced(url.hostname);
    let res: Response;
    try {
      res = await opts.fetch(url.href, {
        method: 'GET',
        redirect: 'manual',
        headers: { 'user-agent': USER_AGENT, accept: opts.accept, ...opts.headers },
        signal: AbortSignal.timeout(Math.min(LIMITS.requestMs, left)),
      });
    } catch (e) {
      const name = (e as Error)?.name;
      if (name === 'TimeoutError' || name === 'AbortError')
        throw new ImportFailure('TIMEOUT', `timed out: ${url.hostname}`);
      throw new ImportFailure('UNREADABLE', `network error: ${url.hostname}`);
    }
    if (res.status >= 300 && res.status < 400 && res.headers.get('location')) {
      await res.body?.cancel();
      if (hop >= LIMITS.redirects) throw new ImportFailure('UNREADABLE', 'too many redirects');
      url = allowed(new URL(res.headers.get('location')!, url).href, hosts);
      continue;
    }
    return { res, url };
  }
}

export function createImportHttp(opts: HttpOptions): ImportHttp {
  const doFetch: Fetch = opts.fetch ?? ((input, init) => fetch(input, init));
  const deadline = opts.deadline ?? Date.now() + LIMITS.importMs;
  const max = opts.maxRequests ?? LIMITS.requests;
  let used = 0;
  const spend = () => {
    if (++used > max) throw new ImportFailure('TOO_LARGE', `over ${max} requests`);
  };
  return {
    get used() {
      return used;
    },
    async json(raw, headers = {}) {
      const { res } = await get(
        raw,
        opts.hosts,
        { fetch: doFetch, deadline, headers, accept: 'application/json' },
        spend,
      );
      const fail = failureFor(res.status);
      const bytes = await readCapped(res, LIMITS.jsonBytes).catch((e) => {
        if (fail) throw fail;
        throw e;
      });
      const body = new TextDecoder().decode(bytes);
      if (fail) throw CHALLENGE.test(body) ? new ImportFailure('BLOCKED', fail.message) : fail;
      try {
        return JSON.parse(body);
      } catch {
        throw CHALLENGE.test(body)
          ? new ImportFailure('BLOCKED', 'challenge page')
          : new ImportFailure('UNREADABLE', 'not json');
      }
    },
  };
}

export type ImageType = 'image/jpeg' | 'image/png' | 'image/webp';

/** Sniffs the bytes — a CDN's content-type is a hint, not proof. */
export function sniffImage(b: Uint8Array): ImageType | null {
  if (b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg';
  if (b.length > 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47)
    return 'image/png';
  if (
    b.length > 12 &&
    String.fromCharCode(...b.subarray(0, 4)) === 'RIFF' &&
    String.fromCharCode(...b.subarray(8, 12)) === 'WEBP'
  )
    return 'image/webp';
  return null;
}

/** Downloads one photo from the adapter's image hosts: ≤ 8 MB, JPEG/PNG/WebP only. */
export async function fetchImage(
  raw: string,
  hosts: string[],
  opts: { fetch?: Fetch; timeoutMs?: number } = {},
): Promise<{ bytes: Uint8Array; type: ImageType }> {
  const { res } = await get(
    raw,
    hosts,
    {
      fetch: opts.fetch ?? ((input, init) => fetch(input, init)),
      deadline: Date.now() + (opts.timeoutMs ?? LIMITS.requestMs * 2),
      headers: {},
      accept: 'image/webp,image/png,image/jpeg',
    },
    () => {},
  );
  const fail = failureFor(res.status);
  if (fail) {
    await res.body?.cancel();
    throw fail;
  }
  const bytes = await readCapped(res, LIMITS.imageBytes);
  const type = sniffImage(bytes);
  if (!type) throw new ImportFailure('UNREADABLE', 'not a jpeg, png or webp');
  return { bytes, type };
}
