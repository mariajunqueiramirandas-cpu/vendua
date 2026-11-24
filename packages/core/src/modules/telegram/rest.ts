// Telegram Bot API HTTP client: webhook-only, no polling loop and no new process (ADR 0047).
// Rate limits (429 retry_after) are tracked per chat bucket and globally; short waits sleep
// inline while longer ones throw TelegramError(429) so the scheduler reschedules the pass.

// TELEGRAM_API_URL points a dev stack at a local fake; production talks to api.telegram.org
export const TELEGRAM_API = process.env.TELEGRAM_API_URL || 'https://api.telegram.org';
const TIMEOUT_MS = 10_000;
/** a chat bucket that resets sooner than this is waited out inline */
const MAX_INLINE_WAIT_MS = 2_500;

export type TelegramFetch = (url: string, init: RequestInit) => Promise<Response>;

export class TelegramError extends Error {
  constructor(
    /** HTTP status; 0 = network error or timeout */
    public status: number,
    /** Telegram JSON error_code (400, 401, 403, 404, 429…) */
    public errorCode: number | null,
    public description: string,
    public retryAfterMs: number | null = null,
  ) {
    super(description);
  }
  get rateLimited(): boolean {
    return this.status === 429 || this.errorCode === 429;
  }
  get unauthorized(): boolean {
    return this.status === 401 || this.errorCode === 401;
  }
  get transient(): boolean {
    return this.status === 0 || this.status >= 500;
  }
  /** The user blocked the bot, deactivated their account, or never started a DM. */
  get blocked(): boolean {
    return (
      this.errorCode === 403 ||
      (this.errorCode === 400 && /chat not found|user is deactivated/i.test(this.description))
    );
  }
  /** Telegram rejects no-op edits with 400; treat them as already in sync. */
  get notModified(): boolean {
    return this.errorCode === 400 && /message is not modified/i.test(this.description);
  }
  /** The user deleted the card (or message_id is no longer editable): post a fresh one. */
  get messageGone(): boolean {
    return (
      this.errorCode === 400 &&
      /message to edit not found|message_id_invalid|message can't be edited/i.test(this.description)
    );
  }
}

export interface TelegramClient {
  call<T = unknown>(
    method: string,
    params?: Record<string, unknown>,
    chatBucket?: string,
  ): Promise<T>;
  callForm<T = unknown>(method: string, form: FormData): Promise<T>;
  /** Resolves getFile and downloads bytes with a strict size cap (default 10 MB). */
  downloadFile(fileId: string, maxBytes?: number): Promise<{ bytes: Uint8Array; filePath: string }>;
  /** Fire-and-forget typing indicator for a DM chat. */
  sendTyping(chatId: string): Promise<void>;
}

// shared by every client in the process: one bot, one set of chat buckets
const resetAt = new Map<string, number>();
let globalResetAt = 0;

/** Test hook. */
export function resetRateLimits(): void {
  resetAt.clear();
  globalResetAt = 0;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

interface ApiEnvelope<T> {
  ok?: boolean;
  result?: T;
  error_code?: number;
  description?: string;
  parameters?: { retry_after?: number };
}

export function telegramClient(token: string, fetchImpl: TelegramFetch = fetch): TelegramClient {
  async function exec<T>(method: string, init: RequestInit, chatBucket?: string): Promise<T> {
    const key = chatBucket ? `chat:${chatBucket}` : `m:${method}`;
    const until = Math.max(resetAt.get(key) ?? 0, globalResetAt);
    const wait = until - Date.now();
    if (wait > MAX_INLINE_WAIT_MS) {
      throw new TelegramError(429, 429, 'rate limited (bucket exhausted)', wait);
    }
    if (wait > 0) await sleep(wait);

    let res: Response;
    try {
      res = await fetchImpl(`${TELEGRAM_API}/bot${token}/${method}`, {
        ...init,
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch (e) {
      throw new TelegramError(0, null, e instanceof Error ? e.message : String(e));
    }

    const text = await res.text().catch(() => '');
    let json: ApiEnvelope<T> | null = null;
    if (text) {
      try {
        json = JSON.parse(text) as ApiEnvelope<T>;
      } catch {
        json = null;
      }
    }

    if (res.ok && json?.ok === true) return json.result as T;

    const code = typeof json?.error_code === 'number' ? json.error_code : res.status || null;
    const desc =
      typeof json?.description === 'string' && json.description.trim()
        ? json.description
        : `telegram respondeu ${res.status}`;
    if (res.status === 429 || code === 429) {
      const retrySec =
        typeof json?.parameters?.retry_after === 'number'
          ? json.parameters.retry_after
          : Number(res.headers.get('retry-after'));
      const ms = Math.ceil((Number.isFinite(retrySec) && retrySec > 0 ? retrySec : 5) * 1000);
      if (chatBucket) resetAt.set(key, Date.now() + ms);
      else globalResetAt = Date.now() + ms;
      throw new TelegramError(429, 429, desc, ms);
    }
    throw new TelegramError(res.status, code, desc);
  }

  const client: TelegramClient = {
    call<T>(method: string, params?: Record<string, unknown>, chatBucket?: string): Promise<T> {
      const bucket =
        chatBucket ??
        (params?.chat_id !== undefined && params?.chat_id !== null
          ? String(params.chat_id)
          : undefined);
      return exec<T>(
        method,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(params ?? {}),
        },
        bucket,
      );
    },
    callForm<T>(method: string, form: FormData): Promise<T> {
      return exec<T>(method, { method: 'POST', body: form });
    },
    async downloadFile(fileId: string, maxBytes = 10 * 1024 * 1024) {
      const info = await client.call<{ file_path?: string; file_size?: number }>('getFile', {
        file_id: fileId,
      });
      if (!info.file_path) throw new TelegramError(404, 404, 'arquivo indisponível no Telegram');
      if (typeof info.file_size === 'number' && info.file_size > maxBytes) {
        throw new TelegramError(413, 413, 'áudio grande demais (máx. 10 MB)');
      }
      let res: Response;
      try {
        res = await fetchImpl(`${TELEGRAM_API}/file/bot${token}/${info.file_path}`, {
          method: 'GET',
          signal: AbortSignal.timeout(TIMEOUT_MS),
        });
      } catch (e) {
        throw new TelegramError(0, null, e instanceof Error ? e.message : String(e));
      }
      if (!res.ok)
        throw new TelegramError(res.status, res.status, `download falhou (${res.status})`);
      const buf = new Uint8Array(await res.arrayBuffer());
      if (buf.byteLength > maxBytes) {
        throw new TelegramError(413, 413, 'áudio grande demais (máx. 10 MB)');
      }
      return { bytes: buf, filePath: info.file_path };
    },
    async sendTyping(chatId: string): Promise<void> {
      await client
        .call('sendChatAction', { chat_id: chatId, action: 'typing' }, chatId)
        .catch(() => {});
    },
  };
  return client;
}
