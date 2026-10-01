// Discord's REST API with a bot token: the bot never opens a gateway connection (ADR 0023).
// Rate limits come from the response headers; a route that is exhausted waits a moment or
// reports how long to back off, and the caller (the delivery job) reschedules itself.

// DISCORD_API_URL points a dev stack at a local fake; production talks to Discord
export const DISCORD_API = process.env.DISCORD_API_URL || 'https://discord.com/api/v10';
const USER_AGENT = 'DiscordBot (https://vendua.com.br, 1)';
const TIMEOUT_MS = 10_000;
/** a route that resets sooner than this is waited out inline */
const MAX_INLINE_WAIT_MS = 2_500;

export type DiscordFetch = (url: string, init: RequestInit) => Promise<Response>;

export class DiscordError extends Error {
  constructor(
    /** HTTP status; 0 = network error or timeout */
    public status: number,
    /** Discord's JSON error code (10003 unknown channel, 10008 unknown message, 50001…) */
    public code: number | null,
    message: string,
    public retryAfterMs: number | null = null,
  ) {
    super(message);
  }
  get rateLimited(): boolean {
    return this.status === 429;
  }
  get transient(): boolean {
    return this.status === 0 || this.status >= 500;
  }
}

export interface DiscordClient {
  request<T = unknown>(method: string, path: string, body?: unknown): Promise<T>;
}

// shared by every client in the process: one bot, one set of buckets
const resetAt = new Map<string, number>();
let globalResetAt = 0;

/** Discord buckets per major parameter (channel, guild, webhook); message ids don't split them. */
export function routeKey(method: string, path: string): string {
  return `${method} ${path.replace(/\/messages\/\d+/, '/messages/:id').replace(/\/reactions\/.*/, '/reactions')}`;
}

/** Test hook. */
export function resetRateLimits(): void {
  resetAt.clear();
  globalResetAt = 0;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function discordClient(token: string, fetchImpl: DiscordFetch = fetch): DiscordClient {
  return {
    async request<T>(method: string, path: string, body?: unknown): Promise<T> {
      const key = routeKey(method, path);
      const until = Math.max(resetAt.get(key) ?? 0, globalResetAt);
      const wait = until - Date.now();
      if (wait > MAX_INLINE_WAIT_MS) {
        throw new DiscordError(429, null, 'rate limited (bucket exhausted)', wait);
      }
      if (wait > 0) await sleep(wait);

      let res: Response;
      try {
        res = await fetchImpl(`${DISCORD_API}${path}`, {
          method,
          headers: {
            authorization: `Bot ${token}`,
            'user-agent': USER_AGENT,
            ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
          },
          ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
          signal: AbortSignal.timeout(TIMEOUT_MS),
        });
      } catch (e) {
        throw new DiscordError(0, null, e instanceof Error ? e.message : String(e));
      }

      const remaining = res.headers.get('x-ratelimit-remaining');
      const resetAfter = Number(res.headers.get('x-ratelimit-reset-after'));
      if (remaining === '0' && Number.isFinite(resetAfter)) {
        resetAt.set(key, Date.now() + resetAfter * 1000);
      }

      const text = await res.text().catch(() => '');
      let json: unknown = null;
      if (text) {
        try {
          json = JSON.parse(text);
        } catch {
          json = null;
        }
      }
      if (res.ok) return json as T;

      const err = (json ?? {}) as {
        code?: unknown;
        message?: unknown;
        retry_after?: unknown;
        global?: unknown;
      };
      const codeN = typeof err.code === 'number' ? err.code : null;
      const message =
        typeof err.message === 'string' ? err.message : `discord respondeu ${res.status}`;
      if (res.status === 429) {
        const header = Number(res.headers.get('retry-after'));
        const seconds = typeof err.retry_after === 'number' ? err.retry_after : header;
        const ms = Math.ceil((Number.isFinite(seconds) ? seconds : 5) * 1000);
        if (err.global === true) globalResetAt = Date.now() + ms;
        else resetAt.set(key, Date.now() + ms);
        throw new DiscordError(429, codeN, message, ms);
      }
      throw new DiscordError(res.status, codeN, detailOf(message, json));
    },
  };
}

/** 50035 carries the failing field paths — keep the first one, it's the useful part. */
function detailOf(message: string, json: unknown): string {
  const errors = (json as { errors?: unknown } | null)?.errors;
  if (!errors || typeof errors !== 'object') return message;
  const first = (function walk(o: unknown, path: string[]): string | null {
    if (!o || typeof o !== 'object') return null;
    const e = (o as { _errors?: { message?: string }[] })._errors;
    if (Array.isArray(e) && e[0]?.message) return `${path.join('.')}: ${e[0].message}`;
    for (const [k, v] of Object.entries(o)) {
      const hit = walk(v, [...path, k]);
      if (hit) return hit;
    }
    return null;
  })(errors, []);
  return first ? `${message} (${first})` : message;
}
